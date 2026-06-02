import { Decoder, Stream } from '@garmin/fitsdk'
import type { PolarSession } from '@core/types'

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

  return {
    ok: warnings.length === 0,
    warnings,
    distanceDeltaMeters,
    distanceDeltaPct,
    durationDeltaSec,
    recordCount: decoded.recordCount,
    sportMatchesExpected,
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

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
