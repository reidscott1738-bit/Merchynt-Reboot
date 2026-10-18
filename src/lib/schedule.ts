import type { AutomationSchedule } from "@/server/db/schema";
import { addDaysLocal, daysInMonth, fromLocal, toLocalParts } from "./time";

function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`Invalid time "${time}", expected HH:MM`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${time}"`);
  return { hour, minute };
}

export function validateSchedule(s: AutomationSchedule): string[] {
  const errors: string[] = [];
  try {
    parseTime(s.time);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (s.frequency === "weekly" && (!s.daysOfWeek || s.daysOfWeek.length === 0)) errors.push("Pick at least one day of the week");
  if (s.daysOfWeek?.some((d) => d < 0 || d > 6)) errors.push("Days of week must be 0-6");
  if (s.frequency === "monthly" && (s.dayOfMonth == null || s.dayOfMonth < 1 || s.dayOfMonth > 28)) errors.push("Day of month must be 1-28");
  if (s.interval != null && (s.interval < 1 || s.interval > 12)) errors.push("Interval must be between 1 and 12");
  return errors;
}

/**
 * Next run strictly after `after`, evaluated in the business timezone.
 * `anchor` (usually the last run) lets interval > 1 skip periods.
 */
export function computeNextRun(s: AutomationSchedule, timeZone: string, after: Date, lastRun?: Date | null): Date {
  const { hour, minute } = parseTime(s.time);
  const interval = Math.max(1, s.interval ?? 1);

  if (s.frequency === "hourly") {
    const next = new Date(after.getTime());
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(minute);
    while (next <= after) next.setUTCHours(next.getUTCHours() + 1);
    if (lastRun && interval > 1) {
      const min = lastRun.getTime() + interval * 3600_000;
      while (next.getTime() < min) next.setUTCHours(next.getUTCHours() + 1);
    }
    return next;
  }

  const local = toLocalParts(after, timeZone);
  for (let offset = 0; offset < 400; offset++) {
    const day = addDaysLocal(local, offset);
    let matches = false;
    if (s.frequency === "daily") matches = true;
    if (s.frequency === "weekly") matches = (s.daysOfWeek ?? []).includes(day.weekday);
    if (s.frequency === "monthly") matches = day.day === Math.min(s.dayOfMonth ?? 1, daysInMonth(day.year, day.month));
    if (!matches) continue;
    const candidate = fromLocal(day.year, day.month, day.day, hour, minute, timeZone);
    if (candidate <= after) continue;
    if (lastRun && interval > 1) {
      const periodDays = s.frequency === "daily" ? 1 : s.frequency === "weekly" ? 7 : 28;
      const minGap = (interval * periodDays - (s.frequency === "monthly" ? 0 : 0.5)) * 86400_000;
      if (candidate.getTime() - lastRun.getTime() < minGap) continue;
    }
    return candidate;
  }
  throw new Error("Could not compute next run within 400 days");
}

export function describeSchedule(s: AutomationSchedule): string {
  const every = s.interval && s.interval > 1 ? `every ${s.interval} ` : "";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (s.frequency) {
    case "hourly":
      return `${every ? `Every ${s.interval} hours` : "Hourly"} at :${s.time.split(":")[1]}`;
    case "daily":
      return `${every ? `Every ${s.interval} days` : "Daily"} at ${s.time}`;
    case "weekly":
      return `${every ? `Every ${s.interval} weeks` : "Weekly"} on ${(s.daysOfWeek ?? []).map((d) => names[d]).join(", ")} at ${s.time}`;
    case "monthly":
      return `${every ? `Every ${s.interval} months` : "Monthly"} on day ${s.dayOfMonth} at ${s.time}`;
  }
}
