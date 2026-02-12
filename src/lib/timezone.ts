/**
 * Get the UTC offset in milliseconds for a given IANA timezone.
 * Positive value means the timezone is behind UTC (e.g. America/Los_Angeles = +8h).
 */
export function getTimezoneOffsetMs(tz: string, date: Date = new Date()): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  return new Date(utcStr).getTime() - new Date(tzStr).getTime();
}

/** Get midnight today in user's timezone, expressed as a UTC Date */
export function startOfDayUTC(tz: string, date: Date = new Date()): Date {
  // Get today's date string in the user's timezone (YYYY-MM-DD)
  const todayStr = date.toLocaleDateString("en-CA", { timeZone: tz });
  // Midnight UTC for that calendar date
  const midnightUTC = new Date(`${todayStr}T00:00:00Z`);
  // Shift by the timezone offset so it represents midnight in user's tz
  const offsetMs = getTimezoneOffsetMs(tz, date);
  return new Date(midnightUTC.getTime() + offsetMs);
}

/** Get end of day (midnight tomorrow) in user's timezone, expressed as a UTC Date */
export function endOfDayUTC(tz: string, date: Date = new Date()): Date {
  const start = startOfDayUTC(tz, date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}
