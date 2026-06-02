/**
 * TypeScript shapes for Polar bulk-export `training-session-*.json`.
 *
 * Mirrors the literal JSON structure as it appears in
 * `polar-user-data-export_*.zip`. Optional fields use `?` because Polar
 * omits keys for missing data (e.g. indoor sessions have no GPS, small
 * 2022 sessions have no DISTANCE/SPEED streams).
 *
 * NOTE: Polar emits the literal token `NaN` (invalid JSON) inside sample
 * value arrays — sensor dropouts. Callers MUST preprocess source text
 * (`text.replace(/\bNaN\b/g, 'null')`) before `JSON.parse`. After that,
 * `null` is the in-memory representation of a sensor dropout, hence
 * `(number | null)[]` for sample values.
 */

/** A single recorded data stream (HEART_RATE, DISTANCE, SPEED, ...). */
export interface PolarSample {
  /** Stream identifier — e.g. "HEART_RATE", "DISTANCE", "SPEED". */
  type: string
  /** Sampling interval in milliseconds (Polar uses 1000ms = 1Hz). */
  intervalMillis: number
  /** Per-sample values; `null` represents a sensor dropout (originally `NaN`). */
  values: (number | null)[]
}

/** A single GPS waypoint along the session route. */
export interface PolarWayPoint {
  latitude: number
  longitude: number
  /** Milliseconds since the route's `startTime`. */
  elapsedMillis: number
  /** Not present in this user's dataset, but possible in other Polar exports. */
  altitude?: number
}

/** Aggregate min/avg/max for a stream over the exercise. */
export interface PolarStatistics {
  statistics: Array<{
    type: string
    min?: number
    avg?: number
    max?: number
  }>
}

/**
 * A "lap" record. Polar's bulk export emits `laps: {}` for every session
 * in the user's dataset, so we type this permissively — the converter
 * synthesizes a single full-session lap regardless of contents.
 */
export interface PolarLap {
  [key: string]: unknown
}

/** A single exercise within a session. Most sessions have exactly one. */
export interface PolarExercise {
  identifier: { id: string }
  startTime: string
  stopTime: string
  durationMillis: number
  distanceMeters?: number
  timezoneOffsetMinutes?: number
  latitude?: number
  longitude?: number
  sport: { id: string }
  /** May be `{}` (no laps recorded) or `{ laps: [...] }`. */
  laps?: { laps?: PolarLap[] } | Record<string, never>
  statistics?: PolarStatistics
  samples?: { samples: PolarSample[] }
  routes?: {
    route: {
      wayPoints: PolarWayPoint[]
      startTime: string
    }
  }
}

/**
 * Top-level training session — one per `training-session-*.json` file in
 * the bulk export.
 */
export interface PolarSession {
  identifier: { id: string }
  /** Polar Flow display label, e.g. "Running", "Other indoor". Key for FIT sport mapping. */
  name: string
  /** Local civil time, e.g. "2025-08-16T17:12:22" (no offset suffix). */
  startTime: string
  stopTime: string
  durationMillis: number
  distanceMeters?: number
  /** Offset from local civil time to UTC, in minutes (e.g. -420 for PDT). */
  timezoneOffsetMinutes: number
  hrAvg?: number
  hrMax?: number
  calories?: number
  /** Top-level start coordinate; present only when the session has GPS. */
  latitude?: number
  longitude?: number
  sport: { id: string }
  application?: { name?: string }
  product?: { modelName?: string }
  exercises: PolarExercise[]
}
