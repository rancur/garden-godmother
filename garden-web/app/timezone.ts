// Garden timezone utilities — all date/time display uses the garden's physical location timezone,
// not the browser's local time. The timezone is fetched from the property settings and cached in localStorage.

const DEFAULT_TZ = 'America/Phoenix';

export function getGardenTimezone(): string {
  if (typeof window === 'undefined') return DEFAULT_TZ;
  return localStorage.getItem('garden-timezone') || DEFAULT_TZ;
}

export function setGardenTimezone(tz: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('garden-timezone', tz || DEFAULT_TZ);
  }
}

export function formatGardenDate(isoString: string, options?: Intl.DateTimeFormatOptions): string {
  const tz = getGardenTimezone();
  return new Date(isoString).toLocaleDateString('en-US', { timeZone: tz, ...options });
}

export function formatGardenTime(isoString: string, options?: Intl.DateTimeFormatOptions): string {
  const tz = getGardenTimezone();
  return new Date(isoString).toLocaleTimeString('en-US', { timeZone: tz, ...options });
}

export function formatGardenDateTime(isoString: string, options?: Intl.DateTimeFormatOptions): string {
  const tz = getGardenTimezone();
  return new Date(isoString).toLocaleString('en-US', { timeZone: tz, ...options });
}

/** Returns today's date in the garden timezone as YYYY-MM-DD */
export function getGardenToday(): string {
  const tz = getGardenTimezone();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** Returns current month (1-12) in the garden timezone */
export function getGardenMonth(): number {
  const tz = getGardenTimezone();
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(new Date()), 10);
}

/** Returns current year in the garden timezone */
export function getGardenYear(): number {
  const tz = getGardenTimezone();
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(new Date()), 10);
}

/** Format a Date object for display in garden timezone (for "last updated" style displays) */
export function formatGardenTimeFromDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const tz = getGardenTimezone();
  return date.toLocaleTimeString('en-US', { timeZone: tz, ...options });
}

/** Format a Date object as locale string in garden timezone */
export function formatGardenDateTimeFromDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const tz = getGardenTimezone();
  return date.toLocaleString('en-US', { timeZone: tz, ...options });
}

/** Get a YYYY-MM-DD string for a date N days from now in garden timezone */
export function getGardenDateOffset(daysFromNow: number): string {
  const future = new Date(Date.now() + daysFromNow * 86400000);
  const tz = getGardenTimezone();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(future);
}
