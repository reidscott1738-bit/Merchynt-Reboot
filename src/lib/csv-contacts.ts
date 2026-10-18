import Papa from "papaparse";
import { isValidEmail, normalizeEmail } from "./text";

export type ParsedContact = {
  row: number;
  name: string | null;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  serviceLabel: string | null;
  salesperson: string | null;
  status: "pending" | "invalid" | "duplicate" | "suppressed";
  errors: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "full name", "customer", "customer name", "first name"],
  email: ["email", "email address", "e-mail"],
  phone: ["phone", "phone number", "mobile", "cell"],
  service: ["service", "job", "job type", "service type"],
  salesperson: ["salesperson", "technician", "tech", "rep", "employee"],
};

function mapHeader(h: string): string | null {
  const k = h.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(k)) return field;
  return null;
}

export type CsvParseResult = { contacts: ParsedContact[]; headerErrors: string[]; summary: Record<ParsedContact["status"], number> };

export function parseContactsCsv(csv: string, opts: { suppressed: Set<string>; existing: Set<string>; maxRows?: number }): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: "greedy" });
  const headerErrors: string[] = [];
  const fields = (parsed.meta.fields ?? []).map((f) => [f, mapHeader(f)] as const);
  if (!fields.some(([, m]) => m === "email")) headerErrors.push("CSV needs an Email column");
  const maxRows = opts.maxRows ?? 5000;
  if (parsed.data.length > maxRows) headerErrors.push(`CSV has ${parsed.data.length} rows; the limit per import is ${maxRows}`);
  const contacts: ParsedContact[] = [];
  const seen = new Set<string>();
  parsed.data.slice(0, maxRows).forEach((raw, i) => {
    const rec: Record<string, string> = {};
    for (const [orig, mapped] of fields) if (mapped && raw[orig] != null) rec[mapped] = String(raw[orig]).trim();
    const errors: string[] = [];
    const email = rec.email || null;
    let status: ParsedContact["status"] = "pending";
    if (!email) {
      errors.push("Missing email");
      status = "invalid";
    } else if (!isValidEmail(email)) {
      errors.push("Invalid email address");
      status = "invalid";
    }
    const norm = email ? normalizeEmail(email) : null;
    if (status === "pending" && norm) {
      if (opts.suppressed.has(norm)) {
        status = "suppressed";
        errors.push("Contact has opted out or bounced previously");
      } else if (seen.has(norm) || opts.existing.has(norm)) {
        status = "duplicate";
        errors.push("Duplicate email");
      }
    }
    if (norm && status !== "invalid") seen.add(norm);
    contacts.push({
      row: i + 2,
      name: rec.name || null,
      email,
      emailNormalized: norm,
      phone: rec.phone || null,
      serviceLabel: rec.service || null,
      salesperson: rec.salesperson || null,
      status,
      errors,
    });
  });
  const summary = { pending: 0, invalid: 0, duplicate: 0, suppressed: 0 };
  for (const c of contacts) summary[c.status]++;
  for (const e of parsed.errors.slice(0, 5)) headerErrors.push(`Row ${e.row ?? "?"}: ${e.message}`);
  return { contacts, headerErrors, summary };
}
