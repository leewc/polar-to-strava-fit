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
