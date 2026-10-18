import "server-only";
import { bool, list, num, optStr, str } from "./actions";
import { fromLocal, toLocalParts } from "@/lib/time";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Reads the shared business-details form into the businessInputSchema shape. Only fields present in the form are returned. */
export function businessFromForm(f: FormData) {
  const out: Record<string, unknown> = {};
  const text = ["name", "website", "primaryCategory", "description", "phone", "email", "appointmentUrl", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "timezone", "brandPrimaryColor", "brandVoice", "googleReviewUrl", "clientId"];
  for (const k of text) if (f.has(k)) out[k] = k === "name" ? str(f, k) : optStr(f, k);
  if (f.has("secondaryCategories")) out.secondaryCategories = list(f, "secondaryCategories");
  if (f.has("serviceAreaPlaces")) out.serviceAreaPlaces = list(f, "serviceAreaPlaces");
  if (f.has("latitude")) out.latitude = num(f, "latitude");
  if (f.has("longitude")) out.longitude = num(f, "longitude");
  if (f.has("averageCustomerValue")) out.averageCustomerValue = num(f, "averageCustomerValue");
  if (f.has("_flags")) {
    out.isServiceAreaBusiness = bool(f, "isServiceAreaBusiness");
    out.hideAddress = bool(f, "hideAddress");
  }
  if (f.has("_hours")) {
    const hours: Record<string, { open: string; close: string }[]> = {};
    for (const d of DAYS) {
      if (bool(f, `closed_${d}`)) {
        hours[d] = [];
        continue;
      }
      const open = str(f, `open_${d}`);
      const close = str(f, `close_${d}`);
      if (open && close) hours[d] = [{ open, close }];
    }
    out.hours = Object.keys(hours).length ? hours : null;
  }
  return out;
}

export { DAYS };

/** Parses a datetime-local value ("2026-05-01T09:30") as wall-clock time in the business time zone. */
export function localToDate(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  return fromLocal(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone);
}

/** Formats a date for a datetime-local input in the business time zone. */
export function dateToLocalInput(d: Date | null | undefined, timeZone: string) {
  if (!d) return "";
  const p = toLocalParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
