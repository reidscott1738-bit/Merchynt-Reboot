export type MetricKind = "observed" | "calculated" | "estimate";

export type MetricValue = {
  key: string;
  label: string;
  kind: MetricKind;
  value: number | null;
  previous: number | null;
  change: number | null; // relative change, e.g. 0.12 = +12%
  source: string;
  period: { start: string; end: string };
  note?: string;
};

export function relativeChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 1000;
}

export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const pe = new Date(s.getTime() - 86400000);
  const ps = new Date(pe.getTime() - (days - 1) * 86400000);
  return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
}

export function monthPeriod(year: number, month: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Marketing estimate: lead actions × assumed value per action. Labeled as an
 * estimate everywhere it appears; never presented as revenue.
 */
export function estimatedValue(leadActions: number | null, assumedValuePerAction: number | null): number | null {
  if (leadActions == null || assumedValuePerAction == null || assumedValuePerAction <= 0) return null;
  return Math.round(leadActions * assumedValuePerAction);
}

export function sumOrNull(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}
