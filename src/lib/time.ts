/**
 * Timezone helpers built on Intl so scheduled work respects each business's
 * local time (including DST) without a date library.
 */

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function toLocalParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

/** Offset in minutes between the zone's wall clock and UTC at a given instant. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = toLocalParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/**
 * Converts a wall-clock time in a timezone to a UTC instant. For times that do
 * not exist (spring-forward gap) the result moves forward to the next valid time.
 */
export function fromLocal(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  // second pass handles DST boundaries
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60000;
  return new Date(instant);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysLocal(p: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

export function formatInZone(date: Date | string | null | undefined, timeZone: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(new Date(date));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
