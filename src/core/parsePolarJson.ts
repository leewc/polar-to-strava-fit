import JSON5 from 'json5'
import type { PolarSession } from './types'

/** Parse Polar bulk-export training-session JSON.
 *
 *  Polar's bulk export is *almost* JSON but represents sensor dropouts in
 *  two non-standard ways inside numeric `values` arrays:
 *    1. The bare token `NaN` (invalid JSON, valid JSON5).
 *    2. The quoted string `"NaN"` (valid JSON, but a string where a number
 *       belongs).
 *
 *  We use JSON5 to handle (1) natively (no preprocessing), and a scoped
 *  reviver to handle (2): only arrays whose key is `values` are touched, so
 *  a coincidental `"NaN"` elsewhere — e.g. inside a session note — would be
 *  preserved verbatim. After parsing, sample-stream values are uniformly
 *  `(number | null)[]` where `null` represents a dropout.
 *
 *  A minimal runtime shape check confirms the top-level keys we depend on.
 */
export function parsePolarJson(text: string): PolarSession {
  const data = JSON5.parse(text, (key, value) => {
    if (key === 'values' && Array.isArray(value)) {
      return value.map((v) =>
        v === 'NaN' || (typeof v === 'number' && Number.isNaN(v)) ? null : v,
      )
    }
    return value
  }) as PolarSession

  if (typeof data?.identifier?.id !== 'string') {
    throw new Error("Invalid Polar session: missing 'identifier.id'")
  }
  if (typeof data.startTime !== 'string') {
    throw new Error("Invalid Polar session: missing 'startTime'")
  }
  if (!Array.isArray(data.exercises)) {
    throw new Error("Invalid Polar session: missing 'exercises' array")
  }
  return data
}
