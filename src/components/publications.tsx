import { Badge, StatusBadge, formatDateTime } from "./ui";
import type { publicationJobs } from "@/server/db/schema";

/** Per-destination publish state. Demo publications never show a provider link because nothing was published. */
export function Publications({ rows }: { rows: (typeof publicationJobs.$inferSelect)[] }) {
  if (!rows.length) return null;
  const live = rows.filter((p) => p.status !== "cancelled");
  if (!live.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {live.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2">
          <span className="w-20 font-medium capitalize">{p.destination}</span>
          <StatusBadge status={p.status === "succeeded" ? "published" : p.status} />
          {p.isDemo && <Badge tone="purple">Demo, not actually published</Badge>}
          {p.status === "queued" && <span className="text-slate-500">for {formatDateTime(p.requestedFor)}</span>}
          {p.completedAt && <span className="text-slate-500">{formatDateTime(p.completedAt)}</span>}
          {p.providerUrl && !p.isDemo && (
            <a href={p.providerUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              View
            </a>
          )}
          {p.lastError && <span className="text-red-600">{p.lastError}</span>}
        </li>
      ))}
    </ul>
  );
}
