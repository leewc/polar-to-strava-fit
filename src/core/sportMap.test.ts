import { describe, expect, it } from 'vitest'
import { Profile } from '@garmin/fitsdk'
import { POLAR_TO_FIT, lookupSport } from './sportMap'

/** Resolve a SDK enum string ("running") to its numeric value. */
function sportNum(name: string): number {
  for (const [k, v] of Object.entries(Profile.types.sport)) {
    if (v === name) return Number(k)
  }
  throw new Error(`unknown FIT sport name: ${name}`)
}
function subSportNum(name: string): number {
  for (const [k, v] of Object.entries(Profile.types.subSport)) {
    if (v === name) return Number(k)
  }
  throw new Error(`unknown FIT sub_sport name: ${name}`)
}

describe('POLAR_TO_FIT static table', () => {
  it('contains the canonical 15+ mappings PLAN.md calls out', () => {
    // Row count sanity: we captured the full Polar appendix, expect ~140+ rows.
    expect(Object.keys(POLAR_TO_FIT).length).toBeGreaterThanOrEqual(100)
  })
})

describe('lookupSport — required mappings', () => {
  // Expressed as [Polar label, expected sport name, expected subSport name | undefined]
  const cases: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ['Running', 'running', 'street'],
    ['Trail running', 'running', 'trail'],
    ['Treadmill running', 'running', 'treadmill'],
    ['Cycling', 'cycling', undefined],
    ['Mountain biking', 'cycling', 'mountain'],
    ['Indoor cycling', 'cycling', 'indoorCycling'],
    ['Pool swimming', 'swimming', undefined],
    ['Open water swimming', 'swimming', 'openWater'],
    ['Hiking', 'hiking', undefined],
    ['Walking', 'walking', undefined],
    ['Strength training', 'training', 'strengthTraining'],
    ['Yoga', 'generic', 'yoga'],
    ['Other indoor', 'generic', undefined],
    ['Other outdoor', 'generic', undefined],
    ['Downhill skiing', 'alpineSkiing', undefined],
  ]

  for (const [label, sportName, subSportName] of cases) {
    it(`maps "${label}" → ${sportName}${subSportName ? '/' + subSportName : ''}`, () => {
      const result = lookupSport(label)
      expect(result.isFallback).toBe(false)
      expect(result.sport).toBe(sportNum(sportName))
      if (subSportName === undefined) {
        expect(result.subSport).toBeUndefined()
      } else {
        expect(result.subSport).toBe(subSportNum(subSportName))
      }
    })
  }
})

describe('lookupSport — fallback for unknown labels', () => {
  it('returns GENERIC sport with isFallback=true for an unmapped name', () => {
    const result = lookupSport('Made-up sport')
    expect(result.isFallback).toBe(true)
    expect(result.sport).toBe(sportNum('generic'))
    expect(result.subSport).toBeUndefined()
  })

  it('returns GENERIC for empty/whitespace input', () => {
    expect(lookupSport('').isFallback).toBe(true)
    expect(lookupSport('   ').isFallback).toBe(true)
  })
})

describe('lookupSport — case- and whitespace-insensitive matching', () => {
  it('treats "running", "RUNNING", "  Running  " identically to "Running"', () => {
    const canonical = lookupSport('Running')
    expect(canonical.isFallback).toBe(false)

    const lower = lookupSport('running')
    const upper = lookupSport('RUNNING')
    const padded = lookupSport('  Running  ')

    expect(lower).toEqual(canonical)
    expect(upper).toEqual(canonical)
    expect(padded).toEqual(canonical)
  })

  it('matches multi-word labels case-insensitively too', () => {
    const canonical = lookupSport('Mountain biking')
    expect(canonical.isFallback).toBe(false)
    expect(lookupSport('MOUNTAIN BIKING')).toEqual(canonical)
    expect(lookupSport('mountain biking')).toEqual(canonical)
    expect(lookupSport('  Mountain Biking  ')).toEqual(canonical)
  })
})
