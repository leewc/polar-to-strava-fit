import { describe, it, expect } from 'vitest'
import { parsePolarJson } from './parsePolarJson'

describe('parsePolarJson', () => {
  it('parses clean JSON identically to JSON.parse round-trip', () => {
    const clean = {
      identifier: { id: 'sess-1' },
      startTime: '2024-01-01T00:00:00',
      stopTime: '2024-01-01T00:01:00',
      durationMillis: 60000,
      exercises: [
        {
          identifier: { id: 'ex-1' },
          startTime: '2024-01-01T00:00:00',
          stopTime: '2024-01-01T00:01:00',
          durationMillis: 60000,
          sport: { id: '1' },
          samples: {
            samples: [
              { type: 'HEART_RATE', intervalMillis: 1000, values: [80, 81, 82] },
            ],
          },
        },
      ],
    }
    const text = JSON.stringify(clean)
    const parsed = parsePolarJson(text)
    expect(parsed).toEqual(clean)
  })

  it('parses NaN-only sample stream into all nulls', () => {
    const text =
      '{"identifier":{"id":"x"},"startTime":"2024-01-01T00:00:00","exercises":[{"identifier":{"id":"e"},"startTime":"2024-01-01T00:00:00","stopTime":"2024-01-01T00:01:00","durationMillis":60000,"sport":{"id":"1"},"samples":{"samples":[{"type":"HEART_RATE","intervalMillis":1000,"values":[NaN, NaN, NaN]}]}}]}'
    const parsed = parsePolarJson(text)
    const values = parsed.exercises[0].samples!.samples[0].values
    expect(values).toEqual([null, null, null])
  })

  it('parses quoted "NaN" string tokens (the form Polar bulk export actually uses)', () => {
    // The real Polar export emits "NaN" as a quoted string inside numeric
    // values arrays — not a bare NaN token. Both forms must normalise to null.
    const text =
      '{"identifier":{"id":"x"},"startTime":"2024-01-01T00:00:00","exercises":[{"identifier":{"id":"e"},"startTime":"2024-01-01T00:00:00","stopTime":"2024-01-01T00:01:00","durationMillis":60000,"sport":{"id":"1"},"samples":{"samples":[{"type":"HEART_RATE","intervalMillis":1000,"values":["NaN", "NaN", 83.0, "NaN"]}]}}]}'
    const parsed = parsePolarJson(text)
    const values = parsed.exercises[0].samples!.samples[0].values
    expect(values).toEqual([null, null, 83, null])
  })

  it('parses mixed NaN/number values correctly', () => {
    const text =
      '{"identifier":{"id":"x"},"startTime":"2024-01-01T00:00:00","exercises":[{"identifier":{"id":"e"},"startTime":"2024-01-01T00:00:00","stopTime":"2024-01-01T00:01:00","durationMillis":60000,"sport":{"id":"1"},"samples":{"samples":[{"type":"HEART_RATE","intervalMillis":1000,"values":[83.0, NaN, 87.0, NaN, 90.0]}]}}]}'
    const parsed = parsePolarJson(text)
    const values = parsed.exercises[0].samples!.samples[0].values
    expect(values).toEqual([83, null, 87, null, 90])
  })

  it('throws on malformed JSON', () => {
    const text = '{"unclosed: "value"'
    expect(() => parsePolarJson(text)).toThrow()
  })

  it('throws when identifier.id is missing', () => {
    const text = '{"startTime":"2024-01-01T00:00:00","exercises":[]}'
    expect(() => parsePolarJson(text)).toThrow(/identifier\.id/)
  })

  it('throws when startTime is missing', () => {
    const text = '{"identifier":{"id":"x"},"exercises":[]}'
    expect(() => parsePolarJson(text)).toThrow(/startTime/)
  })

  it('throws when exercises is missing', () => {
    const text = '{"identifier":{"id":"x"},"startTime":"2024-01-01T00:00:00"}'
    expect(() => parsePolarJson(text)).toThrow(/exercises/)
  })
})
