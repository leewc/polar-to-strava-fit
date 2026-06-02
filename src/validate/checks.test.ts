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
