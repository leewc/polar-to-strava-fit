/**
 * Aggregate stats over a batch of converted Polar sessions.
 *
 * Pure: no DOM, no I/O. Mirrors Strava's "Best Efforts" widget for runs plus
 * a simple totals block (activity count, distance, time, elevation).
 *
 * Best-effort algorithm: for each Running session, walk the cumulative
 * DISTANCE sample stream (Polar emits it at 1Hz, in metres) and find the
 * minimum-duration sliding window whose distance delta meets each target.
 * Track the fastest such window across all sessions per target distance.
 *
 * Sessions whose total distance is shorter than a target are skipped for
 * that target. Targets that no session reaches keep `bestSeconds = null`.
 *
 * Totals: count every activity (running + indoor), sum `distanceMeters` and
 * `durationMillis/1000`. Elevation gain is the sum of (max - min) altitude
 * per session that has an ALTITUDE sample stream; `null` when no session
 * has altitude data.
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

/** Top-level report returned by `computeStats`. */
export interface StatsReport {
  bestEfforts: BestEffort[]
  totals: StatsTotals
}

/**
 * Best-effort target distances + their human labels. Order matters: the UI
 * renders them top-to-bottom in this order. Mirrors Strava's widget.
 */
const BEST_EFFORT_TARGETS: ReadonlyArray<{ distanceMeters: number; label: string }> = [
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
]

/**
 * Numeric value of FIT `sport.running`. The sportMap module already resolves
 * Polar Flow labels to this numeric via `@garmin/fitsdk`'s Profile table, so
 * we filter Running-family sessions by comparing the lookup result.
 *
 * Centralised constant from the SDK rather than hard-coding 1 — same pattern
 * the sportMap uses to stay tolerant of future SDK renumberings.
 */
import { Profile } from '@garmin/fitsdk'
const RUNNING_SPORT_NUMERIC: number = (() => {
  for (const [k, v] of Object.entries(Profile.types.sport)) {
    if (v === 'running') return Number(k)
  }
  // Should never happen — `running` is in the FIT base profile.
  throw new Error('stats: FIT Profile does not expose `running` sport enum')
})()

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
  // ─── Best efforts (Running only) ─────────────────────────────────────────
  // Initialise every target with bestSeconds = null; we'll lower it as we
  // walk each Running session.
  const best: BestEffort[] = BEST_EFFORT_TARGETS.map((t) => ({
    distanceMeters: t.distanceMeters,
    label: t.label,
    bestSeconds: null,
    sourceFileName: null,
  }))

  for (const { session, fileName } of items) {
    if (!isRunningSession(session)) continue
    const distanceStream = pickDistanceStream(session)
    if (!distanceStream || distanceStream.length < 2) continue

    for (const slot of best) {
      const target = slot.distanceMeters
      const seconds = minWindowSeconds(distanceStream, target)
      if (seconds === null) continue
      if (slot.bestSeconds === null || seconds < slot.bestSeconds) {
        slot.bestSeconds = seconds
        slot.sourceFileName = fileName
      }
    }
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
    bestEfforts: best,
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
 * True for sessions whose Polar Flow label maps to FIT sport `running`. Uses
 * the same lookup the converter uses so Trail/Treadmill/Track running etc.
 * are all included.
 */
function isRunningSession(session: PolarSession): boolean {
  const lookup = lookupSport(session.name)
  return !lookup.isFallback && lookup.sport === RUNNING_SPORT_NUMERIC
}

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
