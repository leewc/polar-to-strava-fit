import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { PolarSession } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../fixtures')

function load(name: string): PolarSession {
  const text = readFileSync(resolve(FIXTURES, name), 'utf8')
  // Fixtures are pre-cleaned (NaN -> null) at extraction time; raw JSON.parse must succeed.
  const parsed = JSON.parse(text) as PolarSession
  return parsed
}

const cases: Array<{
  fixture: string
  expectedName: string
  expectedSportId: string
  expectsGps: boolean
}> = [
  {
    fixture: 'running-large.json',
    expectedName: 'Running',
    expectedSportId: '1',
    expectsGps: true,
  },
  {
    fixture: 'indoor-tiny.json',
    expectedName: 'Other indoor',
    expectedSportId: '83',
    expectsGps: false,
  },
  {
    fixture: 'running-recent.json',
    expectedName: 'Running',
    expectedSportId: '1',
    expectsGps: true,
  },
]

describe('PolarSession fixtures', () => {
  for (const { fixture, expectedName, expectedSportId, expectsGps } of cases) {
    describe(fixture, () => {
      const session: PolarSession = load(fixture)

      it('parses with raw JSON.parse (NaN preprocessing applied at extraction)', () => {
        expect(session).toBeTruthy()
        expect(typeof session).toBe('object')
      })

      it('has identifier.id (string)', () => {
        expect(typeof session.identifier).toBe('object')
        expect(typeof session.identifier.id).toBe('string')
        expect(session.identifier.id.length).toBeGreaterThan(0)
      })

      it('has the expected display name', () => {
        expect(session.name).toBe(expectedName)
      })

      it('has startTime as a local civil time string (no offset suffix)', () => {
        expect(typeof session.startTime).toBe('string')
        // Polar emits "YYYY-MM-DDTHH:MM:SS" (no Z, no +HH:MM tail).
        expect(session.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
      })

      it('has stopTime + numeric durationMillis + numeric timezoneOffsetMinutes', () => {
        expect(typeof session.stopTime).toBe('string')
        expect(typeof session.durationMillis).toBe('number')
        expect(session.durationMillis).toBeGreaterThan(0)
        expect(typeof session.timezoneOffsetMinutes).toBe('number')
      })

      it('has session.sport.id (string)', () => {
        expect(typeof session.sport).toBe('object')
        expect(typeof session.sport.id).toBe('string')
      })

      it('has at least one exercise with sport.id matching expected', () => {
        expect(Array.isArray(session.exercises)).toBe(true)
        expect(session.exercises.length).toBeGreaterThan(0)
        const ex = session.exercises[0]
        expect(typeof ex.identifier.id).toBe('string')
        expect(typeof ex.startTime).toBe('string')
        expect(typeof ex.stopTime).toBe('string')
        expect(typeof ex.durationMillis).toBe('number')
        expect(typeof ex.sport).toBe('object')
        expect(ex.sport.id).toBe(expectedSportId)
      })

      it(`${expectsGps ? 'has' : 'lacks'} top-level GPS lat/lon`, () => {
        if (expectsGps) {
          expect(typeof session.latitude).toBe('number')
          expect(typeof session.longitude).toBe('number')
        } else {
          expect(session.latitude).toBeUndefined()
          expect(session.longitude).toBeUndefined()
        }
      })

      it('exercise samples (when present) are typed (number | null)[]', () => {
        const samples = session.exercises[0].samples?.samples
        if (samples && samples.length > 0) {
          const s = samples[0]
          expect(typeof s.type).toBe('string')
          expect(typeof s.intervalMillis).toBe('number')
          expect(Array.isArray(s.values)).toBe(true)
          // Every value must be a number or null (NaN was preprocessed away).
          for (const v of s.values) {
            expect(v === null || typeof v === 'number').toBe(true)
          }
        }
      })

      it(`${expectsGps ? 'has' : 'lacks'} routes.route.wayPoints`, () => {
        const route = session.exercises[0].routes?.route
        if (expectsGps) {
          expect(route).toBeTruthy()
          expect(Array.isArray(route!.wayPoints)).toBe(true)
          expect(route!.wayPoints.length).toBeGreaterThan(0)
          const wp = route!.wayPoints[0]
          expect(typeof wp.latitude).toBe('number')
          expect(typeof wp.longitude).toBe('number')
          expect(typeof wp.elapsedMillis).toBe('number')
          expect(typeof route!.startTime).toBe('string')
        } else {
          expect(route).toBeUndefined()
        }
      })
    })
  }
})
