import { describe, expect, it } from 'vitest'
import { fitLocalTimestamp, polarLocalToUtcDate } from './time.js'

describe('polarLocalToUtcDate', () => {
  it('converts PDT (-420) local time to UTC', () => {
    expect(
      polarLocalToUtcDate('2025-08-16T17:12:22', -420).toISOString(),
    ).toBe('2025-08-17T00:12:22.000Z')
  })

  it('passes through UTC (offset 0) unchanged', () => {
    expect(
      polarLocalToUtcDate('2025-01-01T12:00:00', 0).toISOString(),
    ).toBe('2025-01-01T12:00:00.000Z')
  })

  it('converts JST (+540) local time to UTC', () => {
    expect(
      polarLocalToUtcDate('2025-01-01T09:00:00', 540).toISOString(),
    ).toBe('2025-01-01T00:00:00.000Z')
  })

  it('handles midnight boundary at UTC', () => {
    expect(
      polarLocalToUtcDate('2025-01-01T00:00:00', 0).toISOString(),
    ).toBe('2025-01-01T00:00:00.000Z')
  })

  it('handles a DST-edge PDT date without throwing (spring-forward day)', () => {
    expect(() =>
      polarLocalToUtcDate('2025-03-09T03:00:00', -420),
    ).not.toThrow()
    expect(
      polarLocalToUtcDate('2025-03-09T03:00:00', -420).toISOString(),
    ).toBe('2025-03-09T10:00:00.000Z')
  })

  it('converts CST (+480) local time to UTC', () => {
    expect(
      polarLocalToUtcDate('2025-01-01T08:00:00', 480).toISOString(),
    ).toBe('2025-01-01T00:00:00.000Z')
  })

  it('throws on an invalid startTime string', () => {
    expect(() => polarLocalToUtcDate('not-a-date', 0)).toThrow(
      /Invalid startTime/,
    )
  })
})

describe('fitLocalTimestamp', () => {
  it('returns Unix seconds shifted by offset for PDT (-420)', () => {
    const utc = new Date('2025-08-17T00:12:22Z')
    const seconds = Math.floor(utc.getTime() / 1000)
    expect(fitLocalTimestamp(utc, -420)).toBe(seconds - 25200)
  })

  it('returns plain Unix seconds when offset is 0', () => {
    const utc = new Date('2025-08-17T00:12:22Z')
    const seconds = Math.floor(utc.getTime() / 1000)
    expect(fitLocalTimestamp(utc, 0)).toBe(seconds)
  })
})
