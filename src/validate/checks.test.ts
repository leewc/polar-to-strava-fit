import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { polarToFit } from '@core/polarToFit'
import { parsePolarJson } from '@core/parsePolarJson'
import type { PolarSession } from '@core/types'
import {
  decodeAndAssertStructure,
  conservationReport,
  DEFAULT_TOLERANCES,
  gpsQualityReport,
  DEFAULT_GPS_THRESHOLDS,
} from './checks'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../fixtures')

function loadSession(name: string): PolarSession {
  return parsePolarJson(readFileSync(resolve(FIXTURES, name), 'utf8'))
}

describe('validate/checks — fixture round-trips', () => {
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
  ])('decodeAndAssertStructure passes for %s', (_name, getSession) => {
    const session = getSession()
    const summary = decodeAndAssertStructure(polarToFit(session))
    expect(summary.recordCount).toBeGreaterThan(0)
    expect(summary.totalElapsedSeconds).toBeGreaterThan(0)
    expect(summary.manufacturer).toBe('polarElectro')
  })

  it('conservation report passes for running-large with expected sport', () => {
    const session = runningLarge
    const summary = decodeAndAssertStructure(polarToFit(session))
    const report = conservationReport(session, summary, {
      sport: 'running',
      subSport: 'street',
    })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([])
    expect(report.sportMatchesExpected).toBe(true)
    expect(report.recordCount).toBeGreaterThan(0)
    expect(Math.abs(report.durationDeltaSec)).toBeLessThan(DEFAULT_TOLERANCES.durationSec)
    if (report.distanceDeltaPct !== undefined) {
      expect(Math.abs(report.distanceDeltaPct)).toBeLessThan(DEFAULT_TOLERANCES.distancePct)
    }
  })

  it('conservation report passes for indoor-tiny (no GPS, no distance)', () => {
    const session = indoorTiny
    const summary = decodeAndAssertStructure(polarToFit(session))
    expect(summary.recordsWithGps).toBe(0)
    const report = conservationReport(session, summary, {
      sport: 'generic',
    })
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([])
    expect(report.sportMatchesExpected).toBe(true)
  })

  it('records-with-gps count is positive for outdoor sessions', () => {
    const summary = decodeAndAssertStructure(polarToFit(runningRecent))
    expect(summary.recordsWithGps).toBeGreaterThan(0)
    // Most records should have GPS (waypoints align 1:1 with samples after first second)
    expect(summary.recordsWithGps).toBeGreaterThan(summary.recordCount * 0.9)
  })
})

describe('validate/checks — failure detection', () => {
  it('decodeAndAssertStructure throws on truncated FIT', () => {
    // Build a valid FIT then truncate the last 8 bytes (CRC + part of payload)
    const session = loadSession('indoor-tiny.json')
    const bytes = polarToFit(session)
    const truncated = bytes.slice(0, bytes.length - 8)
    expect(() => decodeAndAssertStructure(truncated)).toThrow()
  })

  it('decodeAndAssertStructure throws on garbage bytes', () => {
    const garbage = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => decodeAndAssertStructure(garbage)).toThrow()
  })

  it('conservation report flags duration mismatch outside tolerance', () => {
    const session = loadSession('running-large.json')
    const summary = decodeAndAssertStructure(polarToFit(session))
    // Inject a fake longer duration to force a warning
    const fakePolar: PolarSession = {
      ...session,
      durationMillis: session.durationMillis + 60_000, // +60s
    }
    const report = conservationReport(fakePolar, summary)
    expect(report.ok).toBe(false)
    expect(report.warnings.some((w) => w.includes('duration mismatch'))).toBe(true)
    expect(Math.abs(report.durationDeltaSec)).toBeGreaterThan(DEFAULT_TOLERANCES.durationSec)
  })

  it('conservation report flags sport mismatch when expected differs', () => {
    const session = loadSession('running-large.json')
    const summary = decodeAndAssertStructure(polarToFit(session))
    const report = conservationReport(session, summary, { sport: 'cycling' })
    expect(report.ok).toBe(false)
    expect(report.sportMatchesExpected).toBe(false)
    expect(report.warnings.some((w) => w.includes('sport mismatch'))).toBe(true)
  })

  it('conservation report flags distance mismatch outside tolerance', () => {
    const session = loadSession('running-large.json')
    const summary = decodeAndAssertStructure(polarToFit(session))
    const fakePolar: PolarSession = {
      ...session,
      distanceMeters: (session.distanceMeters ?? 1000) * 2, // 100% off
    }
    const report = conservationReport(fakePolar, summary)
    expect(report.ok).toBe(false)
    expect(report.warnings.some((w) => w.includes('distance mismatch'))).toBe(true)
  })

  it('conservation report ignores sport when expectedSport is null', () => {
    const session = loadSession('running-large.json')
    const summary = decodeAndAssertStructure(polarToFit(session))
    const report = conservationReport(session, summary, null)
    expect(report.sportMatchesExpected).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GPS-quality detection
// ---------------------------------------------------------------------------

/**
 * Build a synthetic PolarSession whose route is `n` 1Hz waypoints walking
 * north from (0,0) at the supplied per-second step (in metres). Lets each
 * test inject its own teleport without dragging in fixture file size.
 */
function syntheticGpsSession(
  steps: Array<{ northMeters: number }>,
  opts: { distanceMeters?: number; durationMillis?: number } = {},
): PolarSession {
  // Use the haversine model's exact meters-per-degree-latitude so the path
  // length the report computes lines up with the lengths the test asks for.
  // R * π / 180 with R = 6_371_008.8 (the value haversineMeters uses).
  const metersPerDegLat = (6_371_008.8 * Math.PI) / 180
  let lat = 0
  const wayPoints = []
  let elapsed = 0
  for (const s of steps) {
    elapsed += 1000
    lat += s.northMeters / metersPerDegLat
    wayPoints.push({ latitude: lat, longitude: 0, elapsedMillis: elapsed })
  }
  const durationMillis = opts.durationMillis ?? steps.length * 1000
  return {
    identifier: { id: 'synth' },
    name: 'Running',
    startTime: '2026-01-01T00:00:00',
    stopTime: '2026-01-01T00:00:00',
    durationMillis,
    distanceMeters: opts.distanceMeters,
    timezoneOffsetMinutes: 0,
    sport: { id: '1' },
    exercises: [
      {
        identifier: { id: 'synth-ex' },
        startTime: '2026-01-01T00:00:00',
        stopTime: '2026-01-01T00:00:00',
        durationMillis,
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

describe('validate/checks — gpsQualityReport', () => {
  it('returns clean report for a steady 3 m/s run with no jumps', () => {
    // 60 waypoints, each 3m apart → 177m path length total.
    const steps = Array.from({ length: 60 }, () => ({ northMeters: 3 }))
    const session = syntheticGpsSession(steps, { distanceMeters: 60 * 3 })
    const r = gpsQualityReport(session)
    expect(r).toBeDefined()
    if (!r) throw new Error('unreachable')
    expect(r.severity).toBe('clean')
    expect(r.jumpsOver50m).toEqual([])
    expect(r.maxGapMeters).toBeLessThan(DEFAULT_GPS_THRESHOLDS.warnMeters)
    // 60 waypoints → 59 gaps × 3m ≈ 177m total path length.
    expect(r.pathLengthMeters).toBeGreaterThan(176)
    expect(r.pathLengthMeters).toBeLessThan(178)
    if (r.pathOverDistanceRatio !== undefined) {
      expect(r.pathOverDistanceRatio).toBeGreaterThan(0.95)
      expect(r.pathOverDistanceRatio).toBeLessThan(1.05)
    }
  })

  it('flags a single ~75m jump as minor severity', () => {
    // Steady 3m/s for 30 seconds, then one 75m jump, then steady again.
    const steps = [
      ...Array.from({ length: 30 }, () => ({ northMeters: 3 })),
      { northMeters: 75 },
      ...Array.from({ length: 29 }, () => ({ northMeters: 3 })),
    ]
    const session = syntheticGpsSession(steps, {
      // Recorded distance ≈ path length (90 + 75 + 87 = 252m) so
      // pathOverDistanceRatio ≈ 1.0 and severity is driven only by the
      // single 75m jump → "minor", not "severe".
      distanceMeters: 252,
    })
    const r = gpsQualityReport(session)
    expect(r).toBeDefined()
    if (!r) throw new Error('unreachable')
    expect(r.severity).toBe('minor')
    expect(r.jumpsOver50m.length).toBe(1)
    const jump = r.jumpsOver50m[0]
    expect(jump.gapMeters).toBeGreaterThan(70)
    expect(jump.gapMeters).toBeLessThan(80)
    expect(r.maxGapMeters).toBe(jump.gapMeters)
  })

  it('flags a 1000m jump as severe severity', () => {
    const steps = [
      ...Array.from({ length: 30 }, () => ({ northMeters: 3 })),
      { northMeters: 1000 },
      ...Array.from({ length: 29 }, () => ({ northMeters: 3 })),
    ]
    const session = syntheticGpsSession(steps, { distanceMeters: 60 * 3 })
    const r = gpsQualityReport(session)
    expect(r).toBeDefined()
    if (!r) throw new Error('unreachable')
    expect(r.severity).toBe('severe')
    expect(r.maxGapMeters).toBeGreaterThan(990)
    expect(r.jumpsOver50m.length).toBe(1)
  })

  it('flags severe via path/distance ratio when path far exceeds recorded distance', () => {
    // Several small jumps that each stay under the severeMeters threshold
    // but collectively inflate path length beyond 1.2x recordedDistance.
    const steps = [
      { northMeters: 100 },
      { northMeters: 100 },
      { northMeters: 100 },
    ]
    const session = syntheticGpsSession(steps, { distanceMeters: 100 })
    const r = gpsQualityReport(session)
    expect(r).toBeDefined()
    if (!r) throw new Error('unreachable')
    expect(r.pathOverDistanceRatio).toBeDefined()
    if (r.pathOverDistanceRatio !== undefined) {
      expect(r.pathOverDistanceRatio).toBeGreaterThan(1.2)
    }
    expect(r.severity).toBe('severe')
  })

  it('returns undefined for sessions with no GPS waypoints', () => {
    const session: PolarSession = {
      identifier: { id: 'indoor' },
      name: 'Other indoor',
      startTime: '2026-01-01T00:00:00',
      stopTime: '2026-01-01T00:30:00',
      durationMillis: 30 * 60 * 1000,
      timezoneOffsetMinutes: 0,
      sport: { id: '99' },
      exercises: [
        {
          identifier: { id: 'indoor-ex' },
          startTime: '2026-01-01T00:00:00',
          stopTime: '2026-01-01T00:30:00',
          durationMillis: 30 * 60 * 1000,
          sport: { id: '99' },
        },
      ],
    }
    expect(gpsQualityReport(session)).toBeUndefined()
  })

  it('respects custom warn/severe thresholds', () => {
    const steps = [
      ...Array.from({ length: 5 }, () => ({ northMeters: 3 })),
      { northMeters: 30 }, // under default 50, but over a custom 20
      ...Array.from({ length: 5 }, () => ({ northMeters: 3 })),
    ]
    // Path = 5*3 + 30 + 5*3 = 60m; recorded distance matches so the
    // ratio stays ≈1.0 and severity is driven only by the single jump.
    const session = syntheticGpsSession(steps, { distanceMeters: 60 })
    const tight = gpsQualityReport(session, { warnMeters: 20, severeMeters: 25 })
    expect(tight).toBeDefined()
    if (!tight) throw new Error('unreachable')
    // 30m jump > 20m warn AND > 25m severe → severity = severe
    expect(tight.severity).toBe('severe')
    expect(tight.jumpsOver50m.length).toBe(1)

    const loose = gpsQualityReport(session) // defaults
    expect(loose?.severity).toBe('clean')
    expect(loose?.jumpsOver50m).toEqual([])
  })

  it('conservationReport surfaces severe gpsReport in warnings; minor stays silent', () => {
    // A purely-synthetic session with a real teleport. We need a polarToFit
    // round-trip to feed conservationReport, but the converter handles
    // arbitrary lat/lon values fine.
    const severeSteps = [
      ...Array.from({ length: 30 }, () => ({ northMeters: 3 })),
      { northMeters: 1000 },
      ...Array.from({ length: 29 }, () => ({ northMeters: 3 })),
    ]
    const session = syntheticGpsSession(severeSteps, {
      distanceMeters: 60 * 3,
    })
    const summary = decodeAndAssertStructure(polarToFit(session))
    const report = conservationReport(session, summary, null)
    expect(report.gpsReport).toBeDefined()
    expect(report.gpsReport?.severity).toBe('severe')
    expect(report.warnings.some((w) => w.includes('gps anomalies'))).toBe(true)

    // Minor case: small jump shouldn't add any warning, just populate gpsReport.
    const minorSteps = [
      ...Array.from({ length: 30 }, () => ({ northMeters: 3 })),
      { northMeters: 75 },
      ...Array.from({ length: 29 }, () => ({ northMeters: 3 })),
    ]
    const minorSession = syntheticGpsSession(minorSteps, {
      distanceMeters: 60 * 3 + 75,
    })
    const minorSummary = decodeAndAssertStructure(polarToFit(minorSession))
    const minorReport = conservationReport(minorSession, minorSummary, null)
    expect(minorReport.gpsReport?.severity).toBe('minor')
    expect(minorReport.warnings.some((w) => w.includes('gps anomalies'))).toBe(false)
  })
})
