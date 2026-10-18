import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, DemoBadge, Flash, PageHeader, Stat, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { RankingHeatmap, type HeatPoint } from "@/components/heatmap";
import { businessPage, type SP } from "@/server/page-context";
import { getAudit } from "@/server/services/rankings";
import { AppError } from "@/server/errors";

export const metadata = { title: "Ranking audit" };
export const dynamic = "force-dynamic";

const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

export default async function AuditPage({ params, searchParams }: { params: Promise<{ businessId: string; auditId: string }>; searchParams: SP }) {
  const { businessId, auditId } = await params;
  const sp = await searchParams;
  const { actor, business } = await businessPage(businessId);
  let a: Awaited<ReturnType<typeof getAudit>>;
  try {
    a = await getAudit(actor, businessId, auditId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const s = (a.audit.stats ?? {}) as Record<string, number | null>;
  const points: HeatPoint[] = a.observations.map((o) => ({ lat: o.lat, lng: o.lng, status: o.status, rank: o.rank }));
  const c = a.comparison;
  return (
    <>
      <PageHeader
        title={`“${a.keyword.phrase}”`}
        back={{ href: `/b/${businessId}/rankings`, label: "Ranking Audits" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.audit.status} /> {formatDateTime(a.audit.createdAt, business.timezone)} · {a.config.gridSize}×{a.config.gridSize} grid, {a.config.radiusKm} km, {a.config.device} · settings v{a.config.version} · provider {a.audit.provider}
            <DemoBadge show={a.audit.isDemo} label="Demo data: synthetic rankings" />
          </span>
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {["queued", "running"].includes(a.audit.status) && (
        <div className="mb-4">
          <Alert>
            {a.audit.pointsSucceeded} of {a.audit.pointsTotal} points observed so far. Refresh to see progress.
          </Alert>
        </div>
      )}
      {a.audit.error && (
        <div className="mb-4">
          <Alert tone="red">{a.audit.error}</Alert>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Average rank" value={s.averageRank ?? "—"} hint="Over points where you appear" demo={a.audit.isDemo} />
        <Stat label="Top 3" value={pct(s.top3Share)} hint="Share of points" demo={a.audit.isDemo} />
        <Stat label="Not in top 20" value={pct(s.notFoundShare)} demo={a.audit.isDemo} />
        <Stat label="Coverage" value={pct(s.coverage)} hint={`${s.failed ?? 0} point(s) failed to load`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Map">
            {points.length ? <RankingHeatmap center={{ lat: a.config.centerLat, lng: a.config.centerLng }} radiusKm={a.config.radiusKm} points={points} /> : <p className="text-sm text-slate-500">No points observed yet.</p>}
            <p className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
              <span><span className="inline-block h-3 w-3 rounded-full bg-green-600 align-middle" /> 1–3</span>
              <span><span className="inline-block h-3 w-3 rounded-full bg-amber-500 align-middle" /> 4–10</span>
              <span><span className="inline-block h-3 w-3 rounded-full bg-orange-600 align-middle" /> 11–20</span>
              <span><span className="inline-block h-3 w-3 rounded-full bg-red-600 align-middle" /> not in top 20</span>
              <span><span className="inline-block h-3 w-3 rounded-full bg-slate-400 align-middle" /> failed</span>
            </p>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Compared with the previous audit">
            {!c ? (
              <p className="text-sm text-slate-500">No earlier audit for this keyword.</p>
            ) : !c.sameConfiguration ? (
              <p className="text-sm text-slate-600">
                The{" "}
                <Link href={`/b/${businessId}/rankings/${c.previousAuditId}`} className="underline">
                  previous audit
                </Link>{" "}
                used different settings, so points cannot be compared one to one.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                <li>Improved at {c.improved} point(s)</li>
                <li>Worsened at {c.worsened} point(s)</li>
                <li>Unchanged at {c.unchanged} point(s)</li>
                {c.averageRankChange != null && <li>Average rank change: {c.averageRankChange > 0 ? `+${c.averageRankChange} (worse)` : `${c.averageRankChange} (better)`}</li>}
                <li className="text-xs text-slate-500">{c.incomparable} point(s) not comparable (failed in one run)</li>
              </ul>
            )}
          </Card>
          <Card title="Competitors in this audit" padded={false}>
            <Table head={["Business", "Top 3", "Seen", "Avg"]}>
              {a.competitors.slice(0, 12).map(({ snap, comp }) => (
                <tr key={snap.id}>
                  <Td className="max-w-[12rem] truncate">{comp.name}</Td>
                  <Td>{snap.top3Count}</Td>
                  <Td>{snap.appearances}</Td>
                  <Td>{snap.averageRank?.toFixed(1) ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
