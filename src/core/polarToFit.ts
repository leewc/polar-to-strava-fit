import { Encoder, Profile, Utils } from '@garmin/fitsdk'
import { lookupSport, type LookupResult } from './sportMap'
import { fitLocalTimestamp, polarLocalToUtcDate } from './time'
import type { PolarExercise, PolarSample, PolarSession, PolarWayPoint } from './types'

/**
 * Local alias around the fitsdk's `writeMesg` whose declared type
 * (`Encodable<Mesg>`) is too strict — it doesn't include the actual data
 * fields the encoder accepts at runtime (timestamp, distance, sport, etc).
 * Cast at this single boundary instead of sprinkling `as any` per call.
 */
type WriteMesg = (mesg: Record<string, unknown>) => void

/**
 * Convert a parsed Polar bulk-export training session to a FIT Activity file.
 *
 * Pure: no I/O, no globals, deterministic for a given input. Runs identically
 * in Node and the browser.
 *
 * Produces the canonical 8-message Activity layout (file_id → device_info →
 * event(start) → record* → event(stop) → lap → session → activity), suitable
 * for direct upload to Strava.
 */
export function polarToFit(session: PolarSession): Uint8Array {
  const ex = pickPrimaryExercise(session)
  const tzOffsetMin = session.timezoneOffsetMinutes
  const startUtc = polarLocalToUtcDate(session.startTime, tzOffsetMin)
  const stopUtc = polarLocalToUtcDate(session.stopTime, tzOffsetMin)

  // FIT timestamps are seconds since FIT epoch (1989-12-31). Utils.convertDateToDateTime handles this.
  const startTs = Utils.convertDateToDateTime(startUtc)
  const stopTs = Utils.convertDateToDateTime(stopUtc)

  const sportLookup = lookupSport(session.name)
  const sportEnum = numberToSportEnum(sportLookup.sport)
  const subSportEnum =
    sportLookup.subSport !== undefined
      ? numberToSubSportEnum(sportLookup.subSport)
      : 'generic'

  const totalElapsedSec = session.durationMillis / 1000
  const records = buildRecords(ex, startUtc)

  const encoder = new Encoder()
  const writeMesg = encoder.writeMesg.bind(encoder) as unknown as WriteMesg

  // 1. file_id — must be first.
  writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 'activity',
    manufacturer: 'polarElectro',
    product: 0,
    timeCreated: startTs,
    serialNumber: deriveSerial(session.identifier.id),
  })

  // 2. device_info (creator). Best practice; Strava's UI surfaces this as the source.
  writeMesg({
    mesgNum: Profile.MesgNum.DEVICE_INFO,
    timestamp: startTs,
    deviceIndex: 'creator',
    manufacturer: 'polarElectro',
    product: 0,
    serialNumber: deriveSerial(session.identifier.id),
    productName: session.product?.modelName ?? 'Polar',
  })

  // 3. event timer start
  writeMesg({
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: startTs,
    event: 'timer',
    eventType: 'start',
  })

  // 4. record stream — at least one required by FIT and Strava.
  for (const rec of records) {
    writeMesg({ mesgNum: Profile.MesgNum.RECORD, ...rec })
  }

  // 5. event timer stop
  writeMesg({
    mesgNum: Profile.MesgNum.EVENT,
    timestamp: stopTs,
    event: 'timer',
    eventType: 'stop',
  })

  // 6. lap — Polar's bulk export emits no lap markers, so we synthesize one
  //    full-session lap. Pre-populate aggregates the source already gives us.
  writeMesg({
    mesgNum: Profile.MesgNum.LAP,
    messageIndex: 0,
    timestamp: stopTs,
    startTime: startTs,
    totalElapsedTime: totalElapsedSec,
    totalTimerTime: totalElapsedSec,
    sport: sportEnum,
    subSport: subSportEnum,
    ...(session.distanceMeters !== undefined && { totalDistance: session.distanceMeters }),
    ...(session.calories !== undefined && { totalCalories: session.calories }),
    ...(session.hrAvg !== undefined && { avgHeartRate: session.hrAvg }),
    ...(session.hrMax !== undefined && { maxHeartRate: session.hrMax }),
  })

  // 7. session — keystone summary. Strava reads sport/subSport from here.
  writeMesg({
    mesgNum: Profile.MesgNum.SESSION,
    messageIndex: 0,
    timestamp: stopTs,
    startTime: startTs,
    totalElapsedTime: totalElapsedSec,
    totalTimerTime: totalElapsedSec,
    sport: sportEnum,
    subSport: subSportEnum,
    firstLapIndex: 0,
    numLaps: 1,
    ...(session.distanceMeters !== undefined && { totalDistance: session.distanceMeters }),
    ...(session.calories !== undefined && { totalCalories: session.calories }),
    ...(session.hrAvg !== undefined && { avgHeartRate: session.hrAvg }),
    ...(session.hrMax !== undefined && { maxHeartRate: session.hrMax }),
  })

  // 8. activity — terminal aggregate.
  writeMesg({
    mesgNum: Profile.MesgNum.ACTIVITY,
    timestamp: stopTs,
    numSessions: 1,
    totalTimerTime: totalElapsedSec,
    localTimestamp: fitLocalTimestamp(stopUtc, tzOffsetMin) - FIT_EPOCH_OFFSET_S,
    event: 'activity',
    eventType: 'stop',
  })

  return encoder.close()
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** FIT epoch (1989-12-31T00:00:00Z) as seconds-since-Unix-epoch. */
const FIT_EPOCH_OFFSET_S = 631_065_600

/** A trackpoint payload, ready for `writeMesg({ mesgNum: RECORD, ...rec })`. */
interface RecordPayload {
  timestamp: number
  positionLat?: number
  positionLong?: number
  distance?: number
  speed?: number
  enhancedSpeed?: number
  heartRate?: number
  altitude?: number
  enhancedAltitude?: number
  cadence?: number
  power?: number
}

/**
 * The bulk export always has at least one exercise and the converter targets
 * the first one — every session in the user's dataset has exactly one. If a
 * future export ever has multiple, we'd revisit and emit multiple sessions.
 */
function pickPrimaryExercise(session: PolarSession): PolarExercise {
  const ex = session.exercises[0]
  if (!ex) {
    throw new Error(`polarToFit: session ${session.identifier.id} has no exercises`)
  }
  return ex
}

/**
 * Build the trackpoint stream by walking the session's 1Hz sample arrays in
 * lockstep with the GPS waypoints. Each iteration emits one RECORD with
 * whichever fields are populated for that second.
 */
function buildRecords(ex: PolarExercise, startUtc: Date): RecordPayload[] {
  const samples = indexSamples(ex.samples?.samples ?? [])
  const waypoints = ex.routes?.route?.wayPoints ?? []
  const startSec = Math.round(startUtc.getTime() / 1000)
  const startFitTs = startSec - FIT_EPOCH_OFFSET_S

  // Length is the longest available stream — record granularity is 1Hz so we
  // emit one record per second of data. Indoor sessions (no GPS) iterate over
  // sample length; sessions with no samples fall back to waypoint length.
  const sampleLen = Math.max(
    samples.heartRate?.length ?? 0,
    samples.distance?.length ?? 0,
    samples.speed?.length ?? 0,
    samples.altitude?.length ?? 0,
    samples.cadence?.length ?? 0,
    samples.power?.length ?? 0,
  )
  const wpLen = waypoints.length
  const total = Math.max(sampleLen, wpLen)
  if (total === 0) {
    // No data at all; emit a single record at start so the FIT is still valid.
    return [{ timestamp: startFitTs }]
  }

  const out: RecordPayload[] = []
  let wpCursor = 0
  for (let i = 0; i < total; i++) {
    const tsSec = startFitTs + i
    const rec: RecordPayload = { timestamp: tsSec }

    const hr = sampleAt(samples.heartRate, i)
    if (hr !== null) rec.heartRate = Math.round(hr)
    const dist = sampleAt(samples.distance, i)
    if (dist !== null) rec.distance = dist
    const speed = sampleAt(samples.speed, i)
    // Polar SPEED is km/h; FIT enhancedSpeed is m/s. Confirmed empirically
    // against (distanceMeters / durationMillis*1000): the SPEED-stream avg
    // matches that derived avg only after /3.6. Without this divide, Strava
    // flags Running activities as "may be in a vehicle" because per-record
    // m/s values land in 25–40 m/s (90–145 km/h) territory.
    if (speed !== null) rec.enhancedSpeed = speed / 3.6
    const alt = sampleAt(samples.altitude, i)
    if (alt !== null) rec.enhancedAltitude = alt
    const cad = sampleAt(samples.cadence, i)
    if (cad !== null) rec.cadence = Math.round(cad)
    const pow = sampleAt(samples.power, i)
    if (pow !== null) rec.power = Math.round(pow)

    // Match a waypoint by elapsedMillis nearest to (i+1)*1000.
    // Polar's first waypoint is typically at elapsedMillis=1001, so the
    // sample at index i corresponds to waypoint with elapsedMillis ≈ (i+1)*1000.
    const targetElapsed = (i + 1) * 1000
    while (
      wpCursor + 1 < wpLen &&
      Math.abs(waypoints[wpCursor + 1].elapsedMillis - targetElapsed) <
        Math.abs(waypoints[wpCursor].elapsedMillis - targetElapsed)
    ) {
      wpCursor++
    }
    if (wpCursor < wpLen) {
      const wp = waypoints[wpCursor]
      // Only attach if reasonably close (within 2s) — guards against the cursor
      // running past the available waypoints when sampleLen > wpLen.
      if (Math.abs(wp.elapsedMillis - targetElapsed) <= 2000) {
        rec.positionLat = degreesToSemicircles(wp.latitude)
        rec.positionLong = degreesToSemicircles(wp.longitude)
        if (wp.altitude !== undefined && rec.enhancedAltitude === undefined) {
          rec.enhancedAltitude = wp.altitude
        }
      }
    }

    out.push(rec)
  }
  return out
}

interface IndexedSamples {
  heartRate?: (number | null)[]
  distance?: (number | null)[]
  speed?: (number | null)[]
  altitude?: (number | null)[]
  cadence?: (number | null)[]
  power?: (number | null)[]
}

function indexSamples(arr: PolarSample[]): IndexedSamples {
  const out: IndexedSamples = {}
  for (const s of arr) {
    switch (s.type) {
      case 'HEART_RATE':
        out.heartRate = s.values
        break
      case 'DISTANCE':
        out.distance = s.values
        break
      case 'SPEED':
        out.speed = s.values
        break
      case 'ALTITUDE':
        out.altitude = s.values
        break
      case 'CADENCE':
        out.cadence = s.values
        break
      case 'POWER':
        out.power = s.values
        break
      // Other stream types (e.g. STRIDE_LENGTH, RR_INTERVAL) intentionally dropped.
    }
  }
  return out
}

function sampleAt(arr: (number | null)[] | undefined, i: number): number | null {
  if (!arr || i >= arr.length) return null
  return arr[i] ?? null
}

/**
 * Convert decimal degrees to FIT semicircles (signed int32, full circle = 2^32).
 * A full 360° rotation maps to 2^32 semicircles, so 1° = 2^31 / 180 semicircles.
 */
function degreesToSemicircles(deg: number): number {
  return Math.round((deg * 2 ** 31) / 180)
}

/**
 * Stable serial number derived from the Polar identifier — keeps re-runs
 * deterministic and lets users distinguish multiple FIT files in their device
 * list. FIT serial_number is uint32, so we hash to that range.
 */
function deriveSerial(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * Convert a numeric Profile.Sport enum value back to its camelCase string
 * (the form the Encoder expects). The Profile.types.sport table is keyed
 * by numeric value with string values, so this is a direct lookup.
 */
function numberToSportEnum(n: number): string {
  const name = (Profile.types.sport as Record<number, string>)[n]
  if (!name) {
    throw new Error(`polarToFit: unknown FIT sport enum value ${n}`)
  }
  return name
}

function numberToSubSportEnum(n: number): string {
  const name = (Profile.types.subSport as Record<number, string>)[n]
  if (!name) {
    throw new Error(`polarToFit: unknown FIT sub_sport enum value ${n}`)
  }
  return name
}

// re-export helpers when consumers need to test internals
export const __test__ = {
  degreesToSemicircles,
  deriveSerial,
  numberToSportEnum,
  numberToSubSportEnum,
} as const

// keep imports in module-load deps even when unused by callers
export type { LookupResult, PolarWayPoint }
