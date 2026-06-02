import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Decoder, Stream, Profile } from '@garmin/fitsdk'
import { polarToFit, __test__ } from './polarToFit'
import { parsePolarJson } from './parsePolarJson'
import type { PolarSession } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../fixtures')

interface DecodedFit {
  fileIds: any[]
  events: any[]
  records: any[]
  laps: any[]
  sessions: any[]
  activities: any[]
  deviceInfos: any[]
}

function decode(bytes: Uint8Array): DecodedFit {
  const stream = Stream.fromByteArray(bytes)
  const decoder = new Decoder(stream)
  expect(decoder.checkIntegrity()).toBe(true)
  const result = decoder.read()
  // Errors array — should be empty for our well-formed output.
  expect(result.errors ?? []).toEqual([])
  const m = result.messages
  return {
    fileIds: m.fileIdMesgs ?? [],
    events: m.eventMesgs ?? [],
    records: m.recordMesgs ?? [],
    laps: m.lapMesgs ?? [],
    sessions: m.sessionMesgs ?? [],
    activities: m.activityMesgs ?? [],
    deviceInfos: m.deviceInfoMesgs ?? [],
  }
}

function loadSession(name: string): PolarSession {
  return parsePolarJson(readFileSync(resolve(FIXTURES, name), 'utf8'))
}

describe('polarToFit — fixture round-trips', () => {
  let runningLarge: PolarSession
  let runningRecent: PolarSession
  let indoorTiny: PolarSession

  beforeAll(() => {
    runningLarge = loadSession('running-large.json')
    runningRecent = loadSession('running-recent.json')
    indoorTiny = loadSession('indoor-tiny.json')
  })

  it.each([
    ['running-large', () => runningLarge],
    ['running-recent', () => runningRecent],
    ['indoor-tiny', () => indoorTiny],
  ])('produces a decodable FIT activity for %s', (_name, getSession) => {
    const session = getSession()
    const bytes = polarToFit(session)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBeGreaterThan(100)

    const dec = decode(bytes)
    expect(dec.fileIds.length).toBe(1)
    expect(dec.fileIds[0].type).toBe('activity')
    expect(dec.fileIds[0].manufacturer).toBe('polarElectro')
    expect(dec.events.length).toBeGreaterThanOrEqual(2) // start + stop
    expect(dec.records.length).toBeGreaterThan(0)
    expect(dec.laps.length).toBe(1)
    expect(dec.sessions.length).toBe(1)
    expect(dec.activities.length).toBe(1)
    expect(dec.deviceInfos.length).toBe(1)
  })

  it('Running session emits sport=running, subSport=street', () => {
    const dec = decode(polarToFit(runningLarge))
    expect(dec.sessions[0].sport).toBe('running')
    expect(dec.sessions[0].subSport).toBe('street')
  })

  it('Other indoor session emits sport=generic with no GPS records', () => {
    const dec = decode(polarToFit(indoorTiny))
    expect(dec.sessions[0].sport).toBe('generic')
    // Indoor: no record should carry positionLat/positionLong
    const withGps = dec.records.filter(
      (r) => r.positionLat !== undefined || r.positionLong !== undefined,
    )
    expect(withGps.length).toBe(0)
  })

  it('Running session records carry GPS and heart rate', () => {
    const dec = decode(polarToFit(runningRecent))
    const withGps = dec.records.filter(
      (r) => r.positionLat !== undefined && r.positionLong !== undefined,
    )
    expect(withGps.length).toBeGreaterThan(0)
    // The fixture is anonymized to lat≈0, lon≈-150 (semicircles will be small/large accordingly).
    // Just verify they fall within plausible int32 semicircle range.
    for (const r of withGps.slice(0, 10)) {
      expect(Number.isFinite(r.positionLat)).toBe(true)
      expect(Number.isFinite(r.positionLong)).toBe(true)
      expect(r.positionLat).toBeGreaterThanOrEqual(-(2 ** 31))
      expect(r.positionLat).toBeLessThan(2 ** 31)
    }
  })

  it('enhancedSpeed is in m/s (Polar km/h converted), not raw km/h', () => {
    // Polar's SPEED stream is km/h; FIT's enhancedSpeed field is m/s. If we
    // wrote km/h directly Strava would flag the activity as "may be in a
    // vehicle" because every record looks like 25-40 m/s (90-145 km/h).
    //
    // For a session whose mean pace is around 11 min/mi (≈8.7 km/h ≈ 2.4 m/s),
    // the average enhancedSpeed across all records must be in the 1.5-5 m/s
    // band — not the 5-15 m/s band that raw km/h would put it in.
    const dec = decode(polarToFit(runningRecent))
    const speeds = dec.records
      .map((r) => r.enhancedSpeed as number | undefined)
      .filter((v): v is number => typeof v === 'number')
    expect(speeds.length).toBeGreaterThan(100)
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length
    expect(avg).toBeGreaterThan(0.5) // not all zeros / dropped
    expect(avg).toBeLessThan(6) // running pace, not "in a vehicle"

    // Also derive expected average from session totals as a stronger check.
    const session = runningRecent
    if (session.distanceMeters !== undefined) {
      const derivedMs = session.distanceMeters / (session.durationMillis / 1000)
      // Stream mean should be within 30% of derived (allows for dropouts/noise).
      expect(Math.abs(avg - derivedMs) / derivedMs).toBeLessThan(0.3)
    }
  })

  it('Distance conservation within 1% (running-large)', () => {
    const session = runningLarge
    if (session.distanceMeters === undefined) return
    const dec = decode(polarToFit(session))
    const fitTotal = dec.sessions[0].totalDistance
    expect(fitTotal).toBeDefined()
    const polarTotal = session.distanceMeters
    const deltaPct = Math.abs(fitTotal - polarTotal) / polarTotal
    expect(deltaPct).toBeLessThan(0.01)
  })

  it('Duration conservation within 1 second (running-large)', () => {
    const dec = decode(polarToFit(runningLarge))
    const fitElapsed = dec.sessions[0].totalElapsedTime
    const polarElapsed = runningLarge.durationMillis / 1000
    expect(Math.abs(fitElapsed - polarElapsed)).toBeLessThan(1)
  })

  it('UTC timestamps match the source local + offset', () => {
    // running-large: startTime "2025-08-16T17:12:22", tz -420 → UTC "2025-08-17T00:12:22Z"
    const dec = decode(polarToFit(runningLarge))
    const fileIdTs = dec.fileIds[0].timeCreated // a Date or number depending on SDK
    // The SDK returns Date objects for timestamp fields after decode.
    if (fileIdTs instanceof Date) {
      expect(fileIdTs.toISOString()).toBe('2025-08-17T00:12:22.000Z')
    } else {
      // Fallback: numeric FIT seconds. Convert and compare.
      const FIT_EPOCH = 631_065_600
      const iso = new Date((fileIdTs + FIT_EPOCH) * 1000).toISOString()
      expect(iso).toBe('2025-08-17T00:12:22.000Z')
    }
  })

  it('record count is bounded by the longest available stream', () => {
    const dec = decode(polarToFit(runningLarge))
    const ex = runningLarge.exercises[0]
    const sampleLens = (ex.samples?.samples ?? []).map((s) => s.values.length)
    const wpLen = ex.routes?.route.wayPoints.length ?? 0
    const expectedMax = Math.max(...sampleLens, wpLen)
    expect(dec.records.length).toBeLessThanOrEqual(expectedMax)
    // Should be close to the expected — within a couple of records.
    expect(expectedMax - dec.records.length).toBeLessThanOrEqual(2)
  })
})

describe('polarToFit — cropSuspectGps option', () => {
  /**
   * Build a synthetic session whose route has a known isolated teleport in
   * the middle. Steps are 1 metre north each except for a single jumping
   * waypoint that snaps far north and immediately back — the realistic
   * "Polar sensor glitch" pattern.
   */
  function syntheticSessionWithJump(opts: {
    preSteps: number
    jumpMeters: number
    postSteps: number
  }): PolarSession {
    const metersPerDegLat = (6_371_008.8 * Math.PI) / 180
    let lat = 0
    let elapsed = 0
    const wayPoints: any[] = []
    for (let i = 0; i < opts.preSteps; i++) {
      elapsed += 1000
      lat += 1 / metersPerDegLat
      wayPoints.push({ latitude: lat, longitude: 0, elapsedMillis: elapsed })
    }
    // Single isolated jump: snap far north for one waypoint, then return
    // to the natural progression. This is the shape of a real Polar GPS
    // glitch — one second of nonsense bracketed by clean fixes.
    elapsed += 1000
    const jumpLat = lat + opts.jumpMeters / metersPerDegLat
    wayPoints.push({ latitude: jumpLat, longitude: 0, elapsedMillis: elapsed })
    for (let i = 0; i < opts.postSteps; i++) {
      elapsed += 1000
      lat += 1 / metersPerDegLat
      wayPoints.push({ latitude: lat, longitude: 0, elapsedMillis: elapsed })
    }
    const totalSteps = opts.preSteps + 1 + opts.postSteps
    return {
      identifier: { id: 'crop-test' },
      name: 'Running',
      startTime: '2026-01-01T00:00:00',
      stopTime: '2026-01-01T00:00:00',
      durationMillis: totalSteps * 1000,
      timezoneOffsetMinutes: 0,
      sport: { id: '1' },
      exercises: [
        {
          identifier: { id: 'crop-test-ex' },
          startTime: '2026-01-01T00:00:00',
          stopTime: '2026-01-01T00:00:00',
          durationMillis: totalSteps * 1000,
          sport: { id: '1' },
          routes: {
            route: {
              wayPoints,
              startTime: '2026-01-01T00:00:00',
            },
          },
        },
      ],
    }
  }

  it('default behavior (no opts) preserves the suspect waypoint', () => {
    const session = syntheticSessionWithJump({ preSteps: 5, jumpMeters: 1000, postSteps: 5 })
    const dec = decode(polarToFit(session))
    const withGps = dec.records.filter(
      (r) => r.positionLat !== undefined && r.positionLong !== undefined,
    )
    // 11 waypoints attached to records (within the 2s match window).
    expect(withGps.length).toBe(11)
  })

  it('cropSuspectGps drops the >threshold waypoint while keeping the rest', () => {
    const session = syntheticSessionWithJump({ preSteps: 5, jumpMeters: 1000, postSteps: 5 })
    const cropped = decode(polarToFit(session, { cropSuspectGps: true }))
    const withGps = cropped.records.filter(
      (r) => r.positionLat !== undefined && r.positionLong !== undefined,
    )
    // The 1000m jump waypoint is dropped → 10 instead of 11. Note the
    // sample timeline still produces records for every second; only the
    // GPS attachment goes away for the cropped slot.
    expect(withGps.length).toBe(10)

    // No two adjacent kept waypoints should differ by more than the
    // threshold along the latitude axis (roughly).
    const lats = withGps.map((r) => r.positionLat as number)
    const SEMI_PER_DEG = 2 ** 31 / 180
    const metersPerDegLat = (6_371_008.8 * Math.PI) / 180
    for (let i = 1; i < lats.length; i++) {
      const dDeg = Math.abs(lats[i] - lats[i - 1]) / SEMI_PER_DEG
      const dMeters = dDeg * metersPerDegLat
      expect(dMeters).toBeLessThan(500)
    }
  })

  it('respects custom cropThresholdMeters', () => {
    // 75m jump: above a custom 50m threshold but below the default 500m.
    const session = syntheticSessionWithJump({ preSteps: 3, jumpMeters: 75, postSteps: 3 })

    // Default threshold (500m) keeps everything.
    const defaultRun = decode(polarToFit(session, { cropSuspectGps: true }))
    const defaultWithGps = defaultRun.records.filter(
      (r) => r.positionLat !== undefined && r.positionLong !== undefined,
    )
    expect(defaultWithGps.length).toBe(7)

    // Custom 50m threshold drops the 75m waypoint.
    const tightRun = decode(
      polarToFit(session, { cropSuspectGps: true, cropThresholdMeters: 50 }),
    )
    const tightWithGps = tightRun.records.filter(
      (r) => r.positionLat !== undefined && r.positionLong !== undefined,
    )
    expect(tightWithGps.length).toBe(6)
  })
})

describe('polarToFit — internals', () => {
  it('degreesToSemicircles maps boundaries correctly', () => {
    expect(__test__.degreesToSemicircles(0)).toBe(0)
    // 180° = 2^31 semicircles (exactly), but JS rounding may land slightly off.
    expect(__test__.degreesToSemicircles(180)).toBe(2 ** 31)
    expect(__test__.degreesToSemicircles(-180)).toBe(-(2 ** 31))
    // 90° = 2^30
    expect(__test__.degreesToSemicircles(90)).toBe(2 ** 30)
  })

  it('deriveSerial is deterministic and uint32-bounded', () => {
    const id = '0de21131-6090-0aac-e2f2-2f873ce91c2a-01cd6bd7-d465-4fcb-81f2-bfd2707262fc'
    const a = __test__.deriveSerial(id)
    const b = __test__.deriveSerial(id)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(2 ** 32)
  })

  it('numberToSportEnum round-trips through Profile.types.sport', () => {
    const runningId = (Object.entries(Profile.types.sport) as [string, string][]).find(
      ([, v]) => v === 'running',
    )?.[0]
    expect(runningId).toBeDefined()
    expect(__test__.numberToSportEnum(Number(runningId))).toBe('running')
  })
})
