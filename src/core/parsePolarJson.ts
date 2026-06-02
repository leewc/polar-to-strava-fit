import type { PolarSession } from './types'

/** Parse Polar bulk-export training-session JSON.
 *  Polar's bulk export uses the literal NaN token (invalid JSON);
 *  this function preprocesses to convert NaN → null before JSON.parse,
 *  then runs a minimal runtime shape check.
 */
export function parsePolarJson(text: string): PolarSession {
  const cleaned = text.replace(/\bNaN\b/g, 'null')
  const data = JSON.parse(cleaned) as PolarSession
  // shape checks below; throw with clear messages
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
