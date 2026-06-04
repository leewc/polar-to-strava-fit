/**
 * Stats compute tests — multi-sport Best Efforts.
 *
 * Each test synthesises a `PolarSession` with a 1Hz cumulative DISTANCE
 * sample stream computed from `pace × elapsed`. The session's `name` chooses
 * its FIT sport via the existing sportMap, which then resolves the family:
 *
 *   'Running'        → sport=running   → family=running
 *   'Cycling'        → sport=cycling   → family=cycling
 *   'Pool swimming'  → sport=swimming  → family=swimming
 *   'Walking'        → sport=walking   → family=walking
 *
 * Sliding-window seconds are integer at 1Hz: minimum samples N such that
 * carried[end] - carried[start] >= target. For pace P and target D, that's
 * ceil(D / P) at the start of the stream. Tests assert the integer value.
 *
 * Synthetic sessions don't need real FIT bytes — `computeStats` accepts
 * `bytes: Uint8Array` but never inspects it (kept in signature for future
 * use, see stats.ts). Pass an empty Uint8Array.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { computeStats, sportFamilyFromSport, SPORT_FAMILIES } from './stats'
import type { PolarSession } from './types'

/** Inputs for the synthetic-session factory. */
interface SyntheticOpts {
  fileName: string
  /** Polar Flow display label. Drives the FIT sport mapping. */
  sportName: string
  /** Constant pace in metres per second (samples are 1Hz). */
  paceMetersPerSecond: number
  /** Total session duration in seconds. The DISTANCE stream has
   *  `durationSec + 1` samples so distance[durationSec] = pace × durationSec. */
  durationSec: number
  /** Optional altitude stream (1Hz, same length as DISTANCE). */
  altitudeStream?: number[]
  /** Override the totals-block distance. Defaults to pace × durationSec. */
  distanceMeters?: number
}

/** A single ready-for-computeStats item. */
type StatsItem = { session: PolarSession; bytes: Uint8Array; fileName: string }

/** Build a synthetic Polar session. The DISTANCE stream is exactly
 *  `durationSec + 1` samples long: `[0, pace, 2*pace, ..., durationSec*pace]`. */
function syntheticSession(opts: SyntheticOpts): StatsItem {
  const samplesCount = opts.durationSec + 1
  const distance: number[] = []
  for (let i = 0; i < samplesCount; i++) {
    distance.push(opts.paceMetersPerSecond * i)
  }
  const samples: Array<{ type: string; intervalMillis: number; values: (number | null)[] }> = [
    { type: 'DISTANCE', intervalMillis: 1000, values: distance },
  ]
  if (opts.altitudeStream) {
    samples.push({ type: 'ALTITUDE', intervalMillis: 1000, values: opts.altitudeStream })
  }
  const session: PolarSession = {
    identifier: { id: opts.fileName },
    name: opts.sportName,
    startTime: '2025-01-01T00:00:00',
    stopTime: '2025-01-01T00:00:00',
    durationMillis: opts.durationSec * 1000,
    distanceMeters: opts.distanceMeters ?? opts.paceMetersPerSecond * opts.durationSec,
    timezoneOffsetMinutes: 0,
    sport: { id: '0' },
    exercises: [
      {
        identifier: { id: opts.fileName + '-ex' },
        startTime: '2025-01-01T00:00:00',
        stopTime: '2025-01-01T00:00:00',
        durationMillis: opts.durationSec * 1000,
        sport: { id: '0' },
        samples: { samples },
      },
    ],
  }
  return { session, bytes: new Uint8Array(0), fileName: opts.fileName }
}

/** Indoor session (no DISTANCE stream). Counts toward totals only. */
function indoorSession(opts: {
  fileName: string
  durationSec: number
  distanceMeters?: number
}): StatsItem {
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

// Shared synthetic items for the multi-family tests below. Each represents
// "the canonical Tier-1 session" for its family.
let runningItem: StatsItem
let cyclingItem: StatsItem
let swimmingItem: StatsItem
let walkingItem: StatsItem

beforeAll(() => {
  runningItem = syntheticSession({
    fileName: 'run.json',
    sportName: 'Running',
    paceMetersPerSecond: 4,
    durationSec: 1250, // 5 km at 4 m/s
  })
  cyclingItem = syntheticSession({
    fileName: 'bike.json',
    sportName: 'Cycling',
    paceMetersPerSecond: 10,
    durationSec: 3000, // 30 km at 10 m/s
  })
  swimmingItem = syntheticSession({
    fileName: 'swim.json',
    sportName: 'Pool swimming',
    paceMetersPerSecond: 1.5,
    durationSec: 1000, // 1500 m at 1.5 m/s
  })
  walkingItem = syntheticSession({
    fileName: 'walk.json',
    sportName: 'Walking',
    paceMetersPerSecond: 1.5,
    durationSec: 3334, // ~5 km at 1.5 m/s (5001 m exactly)
  })
})

describe('sportFamilyFromSport', () => {
  it('maps the four supported FIT sports to families', () => {
    expect(sportFamilyFromSport('running')).toBe('running')
    expect(sportFamilyFromSport('cycling')).toBe('cycling')
    expect(sportFamilyFromSport('swimming')).toBe('swimming')
    expect(sportFamilyFromSport('walking')).toBe('walking')
    expect(sportFamilyFromSport('hiking')).toBe('walking')
  })

  it('returns undefined for sports without a Best Efforts table', () => {
    expect(sportFamilyFromSport('generic')).toBeUndefined()
    expect(sportFamilyFromSport('rowing')).toBeUndefined()
    expect(sportFamilyFromSport(undefined)).toBeUndefined()
  })
})

describe('computeStats — running family', () => {
  it('1K best = 250s, 5K best = 1250s, 10K = null for a 4 m/s 5 km run', () => {
    const report = computeStats([runningItem])
    const running = report.bestEfforts.running!
    expect(running).toBeDefined()
    const oneK = running.find((b) => b.label === '1K')!
    const fiveK = running.find((b) => b.label === '5K')!
    const tenK = running.find((b) => b.label === '10K')!
    expect(oneK.bestSeconds).toBe(250)
    expect(oneK.sourceFileName).toBe('run.json')
    expect(fiveK.bestSeconds).toBe(1250)
    expect(fiveK.sourceFileName).toBe('run.json')
    expect(tenK.bestSeconds).toBeNull()
    expect(tenK.sourceFileName).toBeNull()
  })
})

describe('computeStats — cycling family', () => {
  it('5K=500s, 10K=1000s, 20K=2000s, 40K=null for a 10 m/s 30 km ride', () => {
    const report = computeStats([cyclingItem])
    const cycling = report.bestEfforts.cycling!
    expect(cycling).toBeDefined()
    expect(cycling.find((b) => b.label === '5K')!.bestSeconds).toBe(500)
    expect(cycling.find((b) => b.label === '10K')!.bestSeconds).toBe(1000)
    expect(cycling.find((b) => b.label === '20K')!.bestSeconds).toBe(2000)
    expect(cycling.find((b) => b.label === '40K')!.bestSeconds).toBeNull()
  })
})

describe('computeStats — swimming family', () => {
  it('100m, 1K, 1500m windows for a 1.5 m/s 1500m swim', () => {
    const report = computeStats([swimmingItem])
    const swimming = report.bestEfforts.swimming!
    expect(swimming).toBeDefined()
    // 100m at 1.5 m/s = 66.67s in continuous land. With 1Hz integer-second
    // samples, the smallest window meeting >=100m is 67s (carried[67] = 100.5,
    // carried[0] = 0). Asserts both the integer reality and the ballpark.
    const hundred = swimming.find((b) => b.label === '100m')!
    expect(hundred.bestSeconds).toBe(67)
    expect(hundred.bestSeconds!).toBeCloseTo(66.67, 0) // tolerance 0.5
    // 1000m at 1.5 m/s ≈ 666.67s; integer answer = 667.
    const oneK = swimming.find((b) => b.label === '1K')!
    expect(oneK.bestSeconds).toBe(667)
    // 1500m at 1.5 m/s = 1000s exactly (carried[1000] = 1500 exactly).
    const fifteen = swimming.find((b) => b.label === '1500m')!
    expect(fifteen.bestSeconds).toBe(1000)
  })
})

describe('computeStats — walking family', () => {
  it('1K and 5K windows for a 1.5 m/s ~5 km walk', () => {
    const report = computeStats([walkingItem])
    const walking = report.bestEfforts.walking!
    expect(walking).toBeDefined()
    // 1000 / 1.5 = 666.67 in continuous land. With 1Hz integer-second
    // samples, the smallest window meeting >=1000m is 667s. The test asserts
    // both the integer reality and that it's the right ballpark.
    const oneK = walking.find((b) => b.label === '1K')!
    expect(oneK.bestSeconds).toBe(667)
    expect(oneK.bestSeconds!).toBeCloseTo(666.67, 0) // tolerance 0.5
    // 5000 / 1.5 = 3333.33 → integer 3334. Difference 0.67 exceeds the
    // toBeCloseTo precision-0 budget (0.5) so we assert the integer directly.
    const fiveK = walking.find((b) => b.label === '5K')!
    expect(fiveK.bestSeconds).toBe(3334)
  })
})

describe('computeStats — multi-family + filtering', () => {
  it('all four families present when all four sessions are passed', () => {
    const report = computeStats([runningItem, cyclingItem, swimmingItem, walkingItem])
    expect(Object.keys(report.bestEfforts).sort()).toEqual(
      ['cycling', 'running', 'swimming', 'walking'],
    )
    // Spot-check one row per family to make sure bucketing didn't cross-pollinate.
    expect(report.bestEfforts.running!.find((b) => b.label === '5K')!.sourceFileName).toBe(
      'run.json',
    )
    expect(report.bestEfforts.cycling!.find((b) => b.label === '5K')!.sourceFileName).toBe(
      'bike.json',
    )
    expect(report.bestEfforts.swimming!.find((b) => b.label === '1K')!.sourceFileName).toBe(
      'swim.json',
    )
    expect(report.bestEfforts.walking!.find((b) => b.label === '1K')!.sourceFileName).toBe(
      'walk.json',
    )
  })

  it('only the populated family appears (single running session → no cycling/swimming/walking keys)', () => {
    const report = computeStats([runningItem])
    expect(Object.keys(report.bestEfforts)).toEqual(['running'])
    expect(report.bestEfforts.cycling).toBeUndefined()
    expect(report.bestEfforts.swimming).toBeUndefined()
    expect(report.bestEfforts.walking).toBeUndefined()
  })

  it('indoor session yields empty bestEfforts (no family keys)', () => {
    const indoor = indoorSession({ fileName: 'indoor.json', durationSec: 600 })
    const report = computeStats([indoor])
    expect(report.bestEfforts).toEqual({})
  })

  it('returns the canonical reference distances per family in order', () => {
    // SPORT_FAMILIES is the source of truth the UI relies on for ordering.
    expect(SPORT_FAMILIES.running.map((t) => t.label)).toEqual([
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
    expect(SPORT_FAMILIES.cycling.map((t) => t.label)).toEqual([
      '5K',
      '10K',
      '20K',
      '40K',
      '50 mile',
      '100K',
      'Century',
    ])
    expect(SPORT_FAMILIES.swimming.map((t) => t.label)).toEqual([
      '100m',
      '200m',
      '500m',
      '1K',
      '1500m',
    ])
    expect(SPORT_FAMILIES.walking.map((t) => t.label)).toEqual(['1K', '5K', '10K'])
  })
})

describe('computeStats — totals', () => {
  it('sums activityCount, totalDistance, and totalDurationSec across all families', () => {
    const indoor = indoorSession({
      fileName: 'indoor.json',
      durationSec: 600,
      distanceMeters: 0,
    })
    const report = computeStats([
      runningItem, // 5000 m, 1250 s
      cyclingItem, // 30000 m, 3000 s
      swimmingItem, // 1500 m, 1000 s
      walkingItem, // 5001 m, 3334 s
      indoor, // 0 m, 600 s
    ])
    expect(report.totals.activityCount).toBe(5)
    expect(report.totals.totalDistanceMeters).toBeCloseTo(5000 + 30000 + 1500 + 5001 + 0, 5)
    expect(report.totals.totalDurationSec).toBe(1250 + 3000 + 1000 + 3334 + 600)
  })

  it('elevation gain is null when no session has altitude samples', () => {
    const report = computeStats([runningItem])
    expect(report.totals.totalElevationGainMeters).toBeNull()
  })

  it('elevation gain sums (max - min) altitude per session that has it', () => {
    const a = syntheticSession({
      fileName: 'a.json',
      sportName: 'Running',
      paceMetersPerSecond: 4,
      durationSec: 10,
      altitudeStream: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    })
    const b = syntheticSession({
      fileName: 'b.json',
      sportName: 'Running',
      paceMetersPerSecond: 4,
      durationSec: 10,
      altitudeStream: [100, 110, 120, 130, 140, 150, 145, 140, 130, 110, 100],
    })
    const report = computeStats([a, b])
    expect(report.totals.totalElevationGainMeters).toBe(100)
  })

  it('returns zero totals + empty bestEfforts for an empty input list', () => {
    const report = computeStats([])
    expect(report.bestEfforts).toEqual({})
    expect(report.totals.activityCount).toBe(0)
    expect(report.totals.totalDistanceMeters).toBe(0)
    expect(report.totals.totalDurationSec).toBe(0)
    expect(report.totals.totalElevationGainMeters).toBeNull()
  })
})
