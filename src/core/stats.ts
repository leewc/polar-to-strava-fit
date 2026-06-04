/**
 * Aggregate stats over a batch of converted Polar sessions.
 *
 * Pure: no DOM, no I/O. Mirrors Strava's "Best Efforts" widget across four
 * sport families (running, cycling, swimming, walking) plus a simple totals
 * block (activity count, distance, time, elevation).
 *
 * Best-effort algorithm: for each session whose decoded FIT sport falls into
 * one of the supported families, walk the cumulative DISTANCE sample stream
 * (Polar emits it at 1Hz, in metres) and find the minimum-duration sliding
 * window whose distance delta meets each family-specific reference target.
 * Track the fastest such window across all sessions per (family, distance).
 *
 * Sessions whose total distance is shorter than a target are skipped for
 * that target. Targets that no session reaches keep `bestSeconds = null`.
 *
 * Totals: count every activity (running + cycling + swimming + walking +
 * indoor + everything else), sum `distanceMeters` and `durationMillis/1000`.
 * Elevation gain is the sum of (max - min) altitude per session that has an
 * ALTITUDE sample stream; `null` when no session has altitude data.
 */

import { lookupSport } from './sportMap'
import type { PolarSample, PolarSession } from './types'

/** A single best-effort row (e.g. "1K", "Half-Marathon"). */
export interface BestEffort {
  /** Target distance in metres. */
  distanceMeters: number
  /** Display label, e.g. "1K", "1 mile". */
  label: string
  /**
   * Best (minimum) duration seen across all eligible sessions, in seconds.
   * `null` when no session reached `distanceMeters`.
   */
  bestSeconds: number | null
  /** ZIP entry name of the session that produced `bestSeconds`; null if N/A. */
  sourceFileName: string | null
}

/** Plain totals block — sums across the whole converted batch. */
export interface StatsTotals {
  activityCount: number
  totalDistanceMeters: number
  totalDurationSec: number
  /** Sum of (max - min) altitude per session. `null` when no session has altitude. */
  totalElevationGainMeters: number | null
}

/** Sport families with reference Best Effort distances. */
export type SportFamily = 'running' | 'cycling' | 'swimming' | 'walking'

/**
 * Reference distance tables per sport family. Order matters: the UI renders
 * them top-to-bottom in this order.
 *
 * Distances:
 *   - running: matches Strava's running widget (400m → Half-Marathon)
 *   - cycling: 5K → century (160.934 km)
 *   - swimming: 100m → 1500m
 *   - walking: 1K, 5K, 10K
 */
export const SPORT_FAMILIES: Readonly<
  Record<SportFamily, ReadonlyArray<{ distanceMeters: number; label: string }>>
> = {
  running: [
    { distanceMeters: 400, label: '400m' },
    { distanceMeters: 805, label: '1/2 mile' },
    { distanceMeters: 1000, label: '1K' },
    { distanceMeters: 1609, label: '1 mile' },
    { distanceMeters: 3219, label: '2 mile' },
    { distanceMeters: 5000, label: '5K' },
    { distanceMeters: 10000, label: '10K' },
    { distanceMeters: 15000, label: '15K' },
    { distanceMeters: 16093, label: '10 mile' },
    { distanceMeters: 20000, label: '20K' },
    { distanceMeters: 21097, label: 'Half-Marathon' },
  ],
  cycling: [
    { distanceMeters: 5000, label: '5K' },
    { distanceMeters: 10000, label: '10K' },
    { distanceMeters: 20000, label: '20K' },
    { distanceMeters: 40000, label: '40K' },
    { distanceMeters: 80467, label: '50 mile' },
    { distanceMeters: 100000, label: '100K' },
    { distanceMeters: 160934, label: 'Century' },
  ],
  swimming: [
    { distanceMeters: 100, label: '100m' },
    { distanceMeters: 200, label: '200m' },
    { distanceMeters: 500, label: '500m' },
    { distanceMeters: 1000, label: '1K' },
    { distanceMeters: 1500, label: '1500m' },
  ],
  walking: [
    { distanceMeters: 1000, label: '1K' },
    { distanceMeters: 5000, label: '5K' },
    { distanceMeters: 10000, label: '10K' },
  ],
}

/** Top-level report returned by `computeStats`. Only populated families are
 *  present in the `bestEfforts` record — empty families are omitted entirely. */
export interface StatsReport {
  bestEfforts: Partial<Record<SportFamily, BestEffort[]>>
  totals: StatsTotals
}

/* -------------------------------------------------------------------------- *
 *  Sport-family resolution.
 *
 *  We resolve the family from the *decoded FIT sport name* (a camelCase
 *  string like 'running', 'cycling', 'swimming', 'walking', 'hiking') so all
 *  Polar sub-sports that map into the same FIT sport (e.g. Trail running,
 *  Treadmill running, Track running → all sport=running) get bucketed
 *  uniformly. Hiking joins the walking family for Best-Effort purposes.
 * -------------------------------------------------------------------------- */

import { Profile } from '@garmin/fitsdk'

/** Decoded FIT sport name (e.g. 'running') → sport family used for stats.
 *  Returns `undefined` for sports without a Best Efforts table (every other
 *  family falls through and contributes only to totals). */
export function sportFamilyFromSport(decodedSport: string | undefined): SportFamily | undefined {
  switch (decodedSport) {
    case 'running':
      return 'running'
    case 'cycling':
      return 'cycling'
    case 'swimming':
      return 'swimming'
    case 'walking':
    case 'hiking':
      return 'walking'
    default:
      return undefined
  }
}

/** Resolve a session's family by running the same sportMap lookup the
 *  converter uses, then translating the numeric sport into its decoded name
 *  via the SDK's Profile table. */
function resolveSportFamily(session: PolarSession): SportFamily | undefined {
  const lookup = lookupSport(session.name)
  if (lookup.isFallback) return undefined
  const decodedName = (Profile.types.sport as Record<number, string>)[lookup.sport]
  return sportFamilyFromSport(decodedName)
}

/**
 * Compute the stats report for a batch of converted sessions. Pure.
 *
 * `bytes` and `fileName` are passed in alongside `session` because the report
 * tracks which source file produced each best effort — handy for the UI to
 * link back, and avoids the caller having to re-derive the filename later.
 * `bytes` itself is unused today; kept in the signature so future stats
 * (e.g. record counts decoded from FIT) don't break callers.
 */
export function computeStats(
  items: ReadonlyArray<{
    session: PolarSession
    bytes: Uint8Array
    fileName: string
  }>,
): StatsReport {
  // ─── Best efforts (bucket by family, run sliding window per family) ──────
  // Group eligible sessions by family. Families with zero sessions never
  // appear in the returned record.
  const byFamily: Partial<Record<SportFamily, Array<{ session: PolarSession; fileName: string }>>> =
    {}
  for (const { session, fileName } of items) {
    const family = resolveSportFamily(session)
    if (!family) continue
    if (!byFamily[family]) byFamily[family] = []
    byFamily[family]!.push({ session, fileName })
  }

  const bestEfforts: Partial<Record<SportFamily, BestEffort[]>> = {}
  for (const family of Object.keys(byFamily) as SportFamily[]) {
    const sessions = byFamily[family]!
    const targets = SPORT_FAMILIES[family]
    const slots: BestEffort[] = targets.map((t) => ({
      distanceMeters: t.distanceMeters,
      label: t.label,
      bestSeconds: null,
      sourceFileName: null,
    }))
    for (const { session, fileName } of sessions) {
      const distanceStream = pickDistanceStream(session)
      if (!distanceStream || distanceStream.length < 2) continue
      for (const slot of slots) {
        const seconds = minWindowSeconds(distanceStream, slot.distanceMeters)
        if (seconds === null) continue
        if (slot.bestSeconds === null || seconds < slot.bestSeconds) {
          slot.bestSeconds = seconds
          slot.sourceFileName = fileName
        }
      }
    }
    bestEfforts[family] = slots
  }

  // ─── Totals (every activity) ─────────────────────────────────────────────
  let activityCount = 0
  let totalDistanceMeters = 0
  let totalDurationSec = 0
  let elevationGain = 0
  let elevationCounted = false

  for (const { session } of items) {
    activityCount++
    if (typeof session.distanceMeters === 'number' && Number.isFinite(session.distanceMeters)) {
      totalDistanceMeters += session.distanceMeters
    }
    if (typeof session.durationMillis === 'number' && Number.isFinite(session.durationMillis)) {
      totalDurationSec += session.durationMillis / 1000
    }
    const altGain = altitudeGain(session)
    if (altGain !== null) {
      elevationGain += altGain
      elevationCounted = true
    }
  }

  return {
    bestEfforts,
    totals: {
      activityCount,
      totalDistanceMeters,
      totalDurationSec,
      totalElevationGainMeters: elevationCounted ? elevationGain : null,
    },
  }
}

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * Find the cumulative DISTANCE stream from the session's first exercise.
 * Returns the raw values array (numbers + nulls) or `undefined` when missing.
 */
function pickDistanceStream(session: PolarSession): (number | null)[] | undefined {
  const ex = session.exercises[0]
  if (!ex?.samples?.samples) return undefined
  const stream = ex.samples.samples.find((s: PolarSample) => s.type === 'DISTANCE')
  return stream?.values
}

/**
 * Minimum duration (seconds) of any sliding window in the cumulative
 * `distance` stream whose end-distance minus start-distance is >= `target`.
 *
 * Two-pointer linear scan: for each `end` index, advance `start` while the
 * window still meets the target. Records the smallest `end - start` seen.
 *
 * Returns `null` when no window reaches `target` (i.e. the session's total
 * distance is shorter than `target`, or every span is non-monotonic from
 * sensor dropouts).
 *
 * 1Hz sampling means index = seconds, so the window count is the duration.
 */
function minWindowSeconds(
  distance: ReadonlyArray<number | null>,
  target: number,
): number | null {
  // Pre-extract a "carry-forward" view: replace null/NaN with the previous
  // valid value (or 0 at the start). Keeps the cumulative monotone when the
  // GPS drops out for a few seconds without skewing distance comparisons.
  const carried: number[] = []
  let last = 0
  for (let i = 0; i < distance.length; i++) {
    const v = distance[i]
    if (typeof v === 'number' && Number.isFinite(v)) {
      last = v
      carried.push(v)
    } else {
      carried.push(last)
    }
  }

  let best: number | null = null
  let start = 0
  for (let end = 0; end < carried.length; end++) {
    // Advance start as far as the window still satisfies target.
    while (start < end && carried[end] - carried[start + 1] >= target) {
      start++
    }
    if (carried[end] - carried[start] >= target) {
      const seconds = end - start
      if (best === null || seconds < best) best = seconds
    }
  }
  return best
}

/**
 * Per-session altitude "gain" approximation: max - min of the ALTITUDE
 * sample stream. Returns `null` when the session has no altitude data.
 *
 * This is a deliberately simple proxy for "elevation gain" — the real
 * metric (sum of positive deltas) would require smoothing the noisy raw
 * stream. For dashboard totals, max - min summed across sessions is a
 * reasonable headline number.
 */
function altitudeGain(session: PolarSession): number | null {
  const ex = session.exercises[0]
  if (!ex?.samples?.samples) return null
  const stream = ex.samples.samples.find((s: PolarSample) => s.type === 'ALTITUDE')
  if (!stream?.values?.length) return null
  let lo = Infinity
  let hi = -Infinity
  let sawValue = false
  for (const v of stream.values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sawValue = true
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!sawValue) return null
  return hi - lo
}
