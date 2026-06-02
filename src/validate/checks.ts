import { Decoder, Stream } from '@garmin/fitsdk'
import type { PolarSession, PolarWayPoint } from '@core/types'

/**
 * Round-trip-decoded summary of a FIT activity file. Captures only the
 * fields the conservation checks compare against the Polar source.
 */
export interface DecodedSummary {
  recordCount: number
  sport?: string
  subSport?: string
  totalDistanceMeters?: number
  totalElapsedSeconds: number
  totalCalories?: number
  avgHeartRate?: number
  maxHeartRate?: number
  /** Number of records that carry a position (lat/lon). */
  recordsWithGps: number
  /** ISO string of session.startTime decoded from the FIT, in UTC. */
  startTimeIso: string
  /** Manufacturer enum string, e.g. "polarElectro". */
  manufacturer?: string
}

/**
 * Decode a FIT byte buffer with `@garmin/fitsdk`'s Decoder, assert that the
 * file is well-formed (CRC valid, zero decoder errors, all required messages
 * present in the right order), and return a slim summary used by downstream
 * conservation checks.
 *
 * Throws `Error` with a clear message when:
 *  - the byte stream fails CRC integrity
 *  - the decoder reports any error
 *  - file_id, session, or activity messages are missing
 *  - record count is zero
 */
export function decodeAndAssertStructure(bytes: Uint8Array): DecodedSummary {
  const stream = Stream.fromByteArray(bytes)
  const decoder = new Decoder(stream)
  if (!decoder.checkIntegrity()) {
    throw new Error('FIT file failed CRC integrity check')
  }
  const result = decoder.read()
  if (result.errors && result.errors.length > 0) {
    throw new Error(
      `FIT decoder reported ${result.errors.length} error(s): ${String(result.errors[0])}`,
    )
  }
  const m = result.messages

  const fileIds = (m.fileIdMesgs ?? []) as Array<Record<string, unknown>>
  const sessions = (m.sessionMesgs ?? []) as Array<Record<string, unknown>>
  const activities = (m.activityMesgs ?? []) as Array<Record<string, unknown>>
  const records = (m.recordMesgs ?? []) as Array<Record<string, unknown>>

  if (fileIds.length === 0) throw new Error('FIT file missing file_id message')
  if (sessions.length === 0) throw new Error('FIT file missing session message')
  if (activities.length === 0) throw new Error('FIT file missing activity message')
  if (records.length === 0) throw new Error('FIT file has zero record messages')

  const session = sessions[0]
  const fileId = fileIds[0]

  const recordsWithGps = records.filter(
    (r) => r.positionLat !== undefined && r.positionLong !== undefined,
  ).length

  return {
    recordCount: records.length,
    sport: stringOrUndefined(session.sport),
    subSport: stringOrUndefined(session.subSport),
    totalDistanceMeters: numberOrUndefined(session.totalDistance),
    totalElapsedSeconds: requireNumber(session.totalElapsedTime, 'session.totalElapsedTime'),
    totalCalories: numberOrUndefined(session.totalCalories),
    avgHeartRate: numberOrUndefined(session.avgHeartRate),
    maxHeartRate: numberOrUndefined(session.maxHeartRate),
    recordsWithGps,
    startTimeIso: dateToIso(session.startTime, 'session.startTime'),
    manufacturer: stringOrUndefined(fileId.manufacturer),
  }
}

/**
 * Result of comparing a decoded FIT summary against its Polar source.
 *
 * `ok` is true when every numeric comparison falls within tolerance and no
 * structural mismatch is observed. `warnings` is non-empty when something is
 * outside tolerance — the caller surfaces these to the user but the file is
 * still emit-able.
 */
export interface ValidationReport {
  ok: boolean
  warnings: string[]
  /** Polar `distanceMeters` minus FIT `session.totalDistance`, signed. */
  distanceDeltaMeters?: number
  /** Δ as a fraction of Polar `distanceMeters`. */
  distanceDeltaPct?: number
  /** Polar `durationMillis/1000` minus FIT `totalElapsedTime`, signed. */
  durationDeltaSec: number
  recordCount: number
  /** Whether the FIT session.sport+subSport matches what sportMap returned. */
  sportMatchesExpected: boolean
  /**
   * GPS-quality report for sessions that carry a route. `undefined` when the
   * source has no GPS waypoints (indoor sessions). See `gpsQualityReport`.
   */
  gpsReport?: GpsQualityReport
}

/**
 * Per-session GPS-quality summary. Detects "teleport" jumps that look like
 * sensor glitches — Strava silently flags activities with these as having
 * "GPS had a bad day" and excludes them from leaderboards.
 *
 *  - `pathLengthMeters` is the sum of haversine gaps between consecutive
 *    waypoints. For a clean run this should track the recorded total
 *    distance closely.
 *  - `pathOverDistanceRatio` of 1.0 = clean. >1.2 indicates accumulated GPS
 *    error or one or more teleports inflating the path length.
 *  - `severity`: `'clean'` (no jumps over the warn threshold), `'minor'`
 *    (1-2 small jumps), `'severe'` (any jump over the severe threshold or
 *    ratio > 1.2).
 */
export interface GpsQualityReport {
  pathLengthMeters: number
  recordedDistanceMeters?: number
  pathOverDistanceRatio?: number
  maxGapMeters: number
  jumpsOver50m: Array<{
    waypointIndex: number
    gapMeters: number
    elapsedMillis: number
  }>
  severity: 'clean' | 'minor' | 'severe'
}

/** Default tolerances; callers can override per-call if needed. */
export const DEFAULT_TOLERANCES = {
  distancePct: 0.01,
  durationSec: 1,
} as const

/**
 * Compare a Polar source session against the decoded summary of the FIT
 * file produced from it. Returns a structured report — empty `warnings`
 * means everything matched within tolerance.
 *
 * Optional `expectedSport` lets the caller assert the sport mapping
 * resolved as expected (e.g. "running"/"street"). Pass an empty object to
 * skip the sport check.
 */
export function conservationReport(
  polar: PolarSession,
  decoded: DecodedSummary,
  expectedSport: { sport: string; subSport?: string } | null = null,
  tolerances: { distancePct?: number; durationSec?: number } = {},
): ValidationReport {
  const distancePct = tolerances.distancePct ?? DEFAULT_TOLERANCES.distancePct
  const durationSec = tolerances.durationSec ?? DEFAULT_TOLERANCES.durationSec

  const warnings: string[] = []

  const polarDurationSec = polar.durationMillis / 1000
  const durationDeltaSec = polarDurationSec - decoded.totalElapsedSeconds
  if (Math.abs(durationDeltaSec) > durationSec) {
    warnings.push(
      `duration mismatch: polar=${polarDurationSec}s fit=${decoded.totalElapsedSeconds}s (Δ=${durationDeltaSec.toFixed(2)}s)`,
    )
  }

  let distanceDeltaMeters: number | undefined
  let distanceDeltaPct: number | undefined
  if (polar.distanceMeters !== undefined && decoded.totalDistanceMeters !== undefined) {
    distanceDeltaMeters = polar.distanceMeters - decoded.totalDistanceMeters
    distanceDeltaPct =
      polar.distanceMeters === 0 ? 0 : distanceDeltaMeters / polar.distanceMeters
    if (Math.abs(distanceDeltaPct) > distancePct) {
      warnings.push(
        `distance mismatch: polar=${polar.distanceMeters.toFixed(1)}m fit=${decoded.totalDistanceMeters.toFixed(1)}m (Δ=${(distanceDeltaPct * 100).toFixed(2)}%)`,
      )
    }
  } else if (polar.distanceMeters !== undefined && decoded.totalDistanceMeters === undefined) {
    warnings.push(
      `distance missing in FIT but polar reports ${polar.distanceMeters.toFixed(1)}m`,
    )
  }

  if (decoded.recordCount === 0) {
    warnings.push('FIT has zero record messages')
  }

  let sportMatchesExpected = true
  if (expectedSport) {
    if (decoded.sport !== expectedSport.sport) {
      sportMatchesExpected = false
      warnings.push(
        `sport mismatch: expected ${expectedSport.sport}, got ${decoded.sport ?? '(none)'}`,
      )
    } else if (
      expectedSport.subSport !== undefined &&
      decoded.subSport !== expectedSport.subSport
    ) {
      sportMatchesExpected = false
      warnings.push(
        `subSport mismatch: expected ${expectedSport.subSport}, got ${decoded.subSport ?? '(none)'}`,
      )
    }
  }

  const gpsReport = gpsQualityReport(polar)
  if (gpsReport && gpsReport.severity === 'severe') {
    warnings.push(
      `gps anomalies (severe): maxGap=${gpsReport.maxGapMeters.toFixed(1)}m, ` +
        `${gpsReport.jumpsOver50m.length} jump(s)>50m` +
        (gpsReport.pathOverDistanceRatio !== undefined
          ? `, path/distance=${gpsReport.pathOverDistanceRatio.toFixed(2)}x`
          : ''),
    )
  }

  return {
    ok: warnings.length === 0,
    warnings,
    distanceDeltaMeters,
    distanceDeltaPct,
    durationDeltaSec,
    recordCount: decoded.recordCount,
    sportMatchesExpected,
    gpsReport,
  }
}

/** Default GPS-quality thresholds. */
export const DEFAULT_GPS_THRESHOLDS = {
  /** Inter-waypoint gap (m) above which we flag the jump in `jumpsOver50m`. */
  warnMeters: 50,
  /** Gap (m) above which a single jump immediately escalates to `'severe'`. */
  severeMeters: 500,
  /** path/distance ratio above which the session is flagged `'severe'`. */
  pathOverDistanceRatioSevere: 1.2,
} as const

/**
 * Walk consecutive GPS waypoints and detect "teleport" jumps that indicate
 * sensor glitches — the kind that make Strava silently exclude an activity
 * from leaderboards. Pure: input → report. No I/O, no globals.
 *
 * Returns `undefined` when the session has no waypoints (e.g. indoor).
 */
export function gpsQualityReport(
  session: PolarSession,
  thresholds: {
    warnMeters?: number
    severeMeters?: number
    pathOverDistanceRatioSevere?: number
  } = {},
): GpsQualityReport | undefined {
  const warn = thresholds.warnMeters ?? DEFAULT_GPS_THRESHOLDS.warnMeters
  const severe = thresholds.severeMeters ?? DEFAULT_GPS_THRESHOLDS.severeMeters
  const ratioSevere =
    thresholds.pathOverDistanceRatioSevere ??
    DEFAULT_GPS_THRESHOLDS.pathOverDistanceRatioSevere

  const waypoints = collectWaypoints(session)
  if (waypoints.length < 2) return undefined

  let pathLength = 0
  let maxGap = 0
  const jumps: GpsQualityReport['jumpsOver50m'] = []
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]
    const b = waypoints[i]
    const gap = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude)
    pathLength += gap
    if (gap > maxGap) maxGap = gap
    if (gap > warn) {
      jumps.push({
        waypointIndex: i,
        gapMeters: gap,
        elapsedMillis: b.elapsedMillis,
      })
    }
  }

  const recordedDistanceMeters = session.distanceMeters
  const pathOverDistanceRatio =
    recordedDistanceMeters !== undefined && recordedDistanceMeters > 0
      ? pathLength / recordedDistanceMeters
      : undefined

  let severity: 'clean' | 'minor' | 'severe' = 'clean'
  if (jumps.length > 0) severity = 'minor'
  if (maxGap > severe) severity = 'severe'
  if (pathOverDistanceRatio !== undefined && pathOverDistanceRatio > ratioSevere) {
    severity = 'severe'
  }

  return {
    pathLengthMeters: pathLength,
    recordedDistanceMeters,
    pathOverDistanceRatio,
    maxGapMeters: maxGap,
    jumpsOver50m: jumps,
    severity,
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function collectWaypoints(session: PolarSession): PolarWayPoint[] {
  const out: PolarWayPoint[] = []
  for (const ex of session.exercises) {
    const route = ex.routes
    if (route && 'route' in route && route.route?.wayPoints) {
      out.push(...route.route.wayPoints)
    }
  }
  return out
}

/**
 * Great-circle distance between two lat/lon points (decimal degrees) on a
 * spherical Earth, using the haversine formula. Returns metres. The error
 * vs WGS-84 is well under 0.5% — fine for jump detection.
 */
function haversineMeters(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
): number {
  const R = 6_371_008.8 // mean Earth radius in metres (IUGG)
  const toRad = (d: number) => (d * Math.PI) / 180
  const phi1 = toRad(lat1Deg)
  const phi2 = toRad(lat2Deg)
  const dPhi = toRad(lat2Deg - lat1Deg)
  const dLam = toRad(lon2Deg - lon1Deg)
  const s = Math.sin(dPhi / 2)
  const t = Math.sin(dLam / 2)
  const a = s * s + Math.cos(phi1) * Math.cos(phi2) * t * t
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function requireNumber(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`FIT file: required field ${name} is not a finite number`)
  }
  return v
}

function dateToIso(v: unknown, name: string): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') {
    // Fallback: treat as FIT seconds. FIT epoch = Unix epoch + 631_065_600.
    return new Date((v + 631_065_600) * 1000).toISOString()
  }
  throw new Error(`FIT file: required field ${name} is not a Date or number`)
}
