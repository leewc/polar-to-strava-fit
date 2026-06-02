/** Polar bulk-export `startTime` is naive local civil time
 *  (e.g. "2025-08-16T17:12:22"), accompanied by `timezoneOffsetMinutes`
 *  (e.g. -420 for UTC-7 / Pacific Daylight Time).
 *
 *  This converts that pair to a JS Date representing the corresponding
 *  UTC instant.
 */
export function polarLocalToUtcDate(
  startTime: string,
  timezoneOffsetMinutes: number,
): Date {
  // Treat the input string as if it were UTC (i.e. parse as if Z suffix),
  // then shift by -timezoneOffsetMinutes minutes to recover real UTC.
  // Strategy: append "Z" to force UTC parse, get ms-since-epoch, then
  // SUBTRACT timezoneOffsetMinutes*60_000 to get true UTC ms.
  // (-420 offset means "pretend-UTC was 420 min ahead of real UTC", so
  // real UTC = pretend-UTC - (-420) = pretend-UTC + 420 min.)
  const pretendUtcMs = Date.parse(startTime + 'Z')
  if (Number.isNaN(pretendUtcMs)) {
    throw new Error(`Invalid startTime: "${startTime}"`)
  }
  return new Date(pretendUtcMs - timezoneOffsetMinutes * 60_000)
}

/** FIT files store both `timestamp` (UTC seconds since FIT epoch) and
 *  `local_timestamp` (the same instant expressed as if it were UTC, in
 *  the user's local timezone). FIT decoders use the difference to render
 *  local time without a tz library.
 *
 *  Returns Unix seconds (NOT FIT seconds) — caller is responsible for
 *  converting to FIT epoch (subtract 631065600).
 */
export function fitLocalTimestamp(
  utcDate: Date,
  timezoneOffsetMinutes: number,
): number {
  return Math.round(utcDate.getTime() / 1000) + timezoneOffsetMinutes * 60
}
