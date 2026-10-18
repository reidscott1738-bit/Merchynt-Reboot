/** US holidays commonly referenced in local marketing, computed per year. */
export type Holiday = { name: string; date: string };

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset));
}
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const iso = (x: Date) => x.toISOString().slice(0, 10);

export function usHolidays(year: number): Holiday[] {
  return [
    { name: "New Year's Day", date: iso(d(year, 1, 1)) },
    { name: "Valentine's Day", date: iso(d(year, 2, 14)) },
    { name: "St. Patrick's Day", date: iso(d(year, 3, 17)) },
    { name: "Mother's Day", date: iso(nthWeekday(year, 5, 0, 2)) },
    { name: "Memorial Day", date: iso(lastWeekday(year, 5, 1)) },
    { name: "Father's Day", date: iso(nthWeekday(year, 6, 0, 3)) },
    { name: "Independence Day", date: iso(d(year, 7, 4)) },
    { name: "Labor Day", date: iso(nthWeekday(year, 9, 1, 1)) },
    { name: "Halloween", date: iso(d(year, 10, 31)) },
    { name: "Veterans Day", date: iso(d(year, 11, 11)) },
    { name: "Thanksgiving", date: iso(nthWeekday(year, 11, 4, 4)) },
    { name: "Christmas", date: iso(d(year, 12, 25)) },
  ];
}

/** Holiday within `windowDays` after (or on) the given local date, if any. */
export function upcomingHoliday(localDate: string, windowDays = 3): Holiday | null {
  const base = new Date(`${localDate}T00:00:00Z`);
  const all = [...usHolidays(base.getUTCFullYear()), ...usHolidays(base.getUTCFullYear() + 1)];
  for (const h of all) {
    const diff = (new Date(`${h.date}T00:00:00Z`).getTime() - base.getTime()) / 86400000;
    if (diff >= 0 && diff <= windowDays) return h;
  }
  return null;
}
