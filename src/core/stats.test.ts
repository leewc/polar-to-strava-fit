/**
 * Stats compute tests. Synthesises minimal `PolarSession` fixtures with
 * known-good DISTANCE streams so the best-effort algorithm's correctness is
 * easy to eyeball:
 *
 *   - constant 4 m/s pace, 1250s long → 5K total
 *     ⇒ 1K best = 250s, 5K best = 1250s, 10K best = null (can't reach)
 *
 *   - constant 5 m/s pace, 1000s long → 5K total
 *     ⇒ 1K best = 200s, 5K best = 1000s
 *
 * Picking the fastest across both → 1K = 200s (from session 2).
 */
import { describe, expect, it } from 'vitest'
import { computeStats } from './stats'
import type { PolarSession } from './types'

/** Build a minimal Running PolarSession with a 1Hz cumulative DISTANCE stream
 *  generated from `pace` (m/s) over `seconds` total samples. */
function runningSession(opts: {
  fileName: string
  paceMps: number
  seconds: number
  altitudeStream?: number[]
  distanceMeters?: number
  durationSec?: number
  name?: string
}): { session: PolarSession; bytes: Uint8Array; fileName: string } {
  const distance: number[] = []
  for (let i = 0; i < opts.seconds; i++) {
    // distance[0] = 0; distance[i] = pace * i. The cumulative stream starts
    // at zero and increments by `pace` metres every second.
    distance.push(opts.paceMps * i)
  }
  const samples: Array<{ type: string; intervalMillis: number; values: (number | null)[] }> = [
    { type: 'DISTANCE', intervalMillis: 1000, values: distance },
  ]
  if (opts.altitudeStream) {
    samples.push({ type: 'ALTITUDE', intervalMillis: 1000, values: opts.altitudeStream })
  }
  const session: PolarSession = {
    identifier: { id: opts.fileName },
    name: opts.name ?? 'Running',
    startTime: '2025-01-01T00:00:00',
    stopTime: '2025-01-01T00:00:00',
    durationMillis:
      typeof opts.durationSec === 'number' ? opts.durationSec * 1000 : opts.seconds * 1000,
    distanceMeters:
      typeof opts.distanceMeters === 'number'
        ? opts.distanceMeters
        : (opts.seconds - 1) * opts.paceMps,
    timezoneOffsetMinutes: 0,
    sport: { id: '1' },
    exercises: [
      {
        identifier: { id: opts.fileName + '-ex' },
        startTime: '2025-01-01T00:00:00',
        stopTime: '2025-01-01T00:00:00',
        durationMillis: opts.seconds * 1000,
        sport: { id: '1' },
        samples: { samples },
      },
    ],
  }
  return { session, bytes: new Uint8Array(0), fileName: opts.fileName }
}

/** Build a minimal indoor session (no DISTANCE, no GPS). Counts toward
 *  totals but not best-efforts. */
function indoorSession(opts: {
  fileName: string
  durationSec: number
  distanceMeters?: number
}): { session: PolarSession; bytes: Uint8Array; fileName: string } {
  const session: PolarSession = {
    identifier: { id: opts.fileName },
    name: 'Other indoor',
    startTime: '2025-01-01T00:00:00',
    stopTime: '2025-01-01T00:00:00',
    durationMillis: opts.durationSec * 1000,
    distanceMeters: opts.distanceMeters,
    timezoneOffsetMinutes: 0,
    sport: { id: '0' },
    exercises: [
      {
        identifier: { id: opts.fileName + '-ex' },
        startTime: '2025-01-01T00:00:00',
        stopTime: '2025-01-01T00:00:00',
        durationMillis: opts.durationSec * 1000,
        sport: { id: '0' },
        samples: { samples: [] },
      },
    ],
  }
  return { session, bytes: new Uint8Array(0), fileName: opts.fileName }
}

describe('computeStats — best efforts', () => {
  it('1K best = 250s and 5K best = 1250s for a constant 4 m/s 5K run', () => {
    // 1251 samples means distance[0]=0 and distance[1250]=5000.
    const item = runningSession({ fileName: 'a.json', paceMps: 4, seconds: 1251 })
    const report = computeStats([item])

    const oneK = report.bestEfforts.find((b) => b.label === '1K')!
    const fiveK = report.bestEfforts.find((b) => b.label === '5K')!
    expect(oneK.bestSeconds).toBe(250)
    expect(oneK.sourceFileName).toBe('a.json')
    expect(fiveK.bestSeconds).toBe(1250)
    expect(fiveK.sourceFileName).toBe('a.json')
  })

  it('picks the fastest across multiple sessions per target', () => {
    // Session A: 4 m/s, 5K
    const a = runningSession({ fileName: 'a.json', paceMps: 4, seconds: 1251 })
    // Session B: 5 m/s, 5K. 1K = 200s, faster.
    const b = runningSession({ fileName: 'b.json', paceMps: 5, seconds: 1001 })
    const report = computeStats([a, b])
    const oneK = report.bestEfforts.find((b) => b.label === '1K')!
    expect(oneK.bestSeconds).toBe(200)
    expect(oneK.sourceFileName).toBe('b.json')
    const fiveK = report.bestEfforts.find((b) => b.label === '5K')!
    expect(fiveK.bestSeconds).toBe(1000)
    expect(fiveK.sourceFileName).toBe('b.json')
  })

  it('leaves bestSeconds = null for targets no session reaches', () => {
    // 4 m/s for 1251s → covers 5K but not 10K, 15K, half-marathon.
    const item = runningSession({ fileName: 'a.json', paceMps: 4, seconds: 1251 })
    const report = computeStats([item])
    const tenK = report.bestEfforts.find((b) => b.label === '10K')!
    const half = report.bestEfforts.find((b) => b.label === 'Half-Marathon')!
    expect(tenK.bestSeconds).toBeNull()
    expect(tenK.sourceFileName).toBeNull()
    expect(half.bestSeconds).toBeNull()
  })

  it('skips indoor sessions for best-effort calculations', () => {
    const indoor = indoorSession({ fileName: 'indoor.json', durationSec: 600 })
    const report = computeStats([indoor])
    // Every best-effort row stays null because there are no Running sessions.
    for (const e of report.bestEfforts) {
      expect(e.bestSeconds).toBeNull()
      expect(e.sourceFileName).toBeNull()
    }
  })

  it('400m best is 100s for a 4 m/s run', () => {
    // 4 m/s × 100s = 400m exactly. Target = 400m. Should match end-start = 100.
    const item = runningSession({ fileName: 'a.json', paceMps: 4, seconds: 1251 })
    const report = computeStats([item])
    const fourHundred = report.bestEfforts.find((b) => b.label === '400m')!
    expect(fourHundred.bestSeconds).toBe(100)
  })
})

describe('computeStats — totals', () => {
  it('sums activity count, distance, and duration across all sessions', () => {
    // Note: distanceMeters set explicitly so totals are easy to predict
    // independent of the synthetic stream length.
    const a = runningSession({
      fileName: 'a.json',
      paceMps: 4,
      seconds: 1251,
      distanceMeters: 5000,
      durationSec: 1250,
    })
    const b = runningSession({
      fileName: 'b.json',
      paceMps: 5,
      seconds: 1001,
      distanceMeters: 5000,
      durationSec: 1000,
    })
    const indoor = indoorSession({
      fileName: 'indoor.json',
      durationSec: 600,
      distanceMeters: 0,
    })
    const report = computeStats([a, b, indoor])
    expect(report.totals.activityCount).toBe(3)
    expect(report.totals.totalDistanceMeters).toBe(10000)
    expect(report.totals.totalDurationSec).toBe(2850) // 1250 + 1000 + 600
  })

  it('elevation gain is null when no session has altitude samples', () => {
    const item = runningSession({ fileName: 'a.json', paceMps: 4, seconds: 1251 })
    const report = computeStats([item])
    expect(report.totals.totalElevationGainMeters).toBeNull()
  })

  it('elevation gain sums (max - min) altitude per session that has it', () => {
    // 0..50m on session a, 100..150m on session b → 50 + 50 = 100.
    const a = runningSession({
      fileName: 'a.json',
      paceMps: 4,
      seconds: 11,
      altitudeStream: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    })
    const b = runningSession({
      fileName: 'b.json',
      paceMps: 4,
      seconds: 11,
      altitudeStream: [100, 110, 120, 130, 140, 150, 145, 140, 130, 110, 100],
    })
    const report = computeStats([a, b])
    expect(report.totals.totalElevationGainMeters).toBe(100)
  })
})

describe('computeStats — bestEfforts shape', () => {
  it('returns all 11 best-effort rows in canonical order', () => {
    const report = computeStats([])
    const labels = report.bestEfforts.map((b) => b.label)
    expect(labels).toEqual([
      '400m',
      '1/2 mile',
      '1K',
      '1 mile',
      '2 mile',
      '5K',
      '10K',
      '15K',
      '10 mile',
      '20K',
      'Half-Marathon',
    ])
    // All null with no input.
    for (const e of report.bestEfforts) {
      expect(e.bestSeconds).toBeNull()
      expect(e.sourceFileName).toBeNull()
    }
    expect(report.totals.activityCount).toBe(0)
    expect(report.totals.totalDistanceMeters).toBe(0)
    expect(report.totals.totalDurationSec).toBe(0)
    expect(report.totals.totalElevationGainMeters).toBeNull()
  })
})
