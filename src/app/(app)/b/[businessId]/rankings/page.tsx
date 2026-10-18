import Link from "next/link";
import { Card, DemoBadge, EmptyState, Flash, LinkButton, PageHeader, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { businessPage, type SP } from "@/server/page-context";
import { listAudits } from "@/server/services/rankings";

export const metadata = { title: "Ranking Audits" };

export default async function RankingsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor } = await businessPage(businessId);
  const rows = await listAudits(actor, businessId, sp.keyword);
  return (
    <>
      <PageHeader title="Ranking Audits" description="Each audit checks Google Maps results at every point of a grid around the audit center. Run audits from Keywords." actions={<LinkButton href={`/b/${businessId}/keywords`} variant="secondary">Keywords</LinkButton>} />
      <Flash ok={sp.ok} err={sp.err} />
      {rows.length === 0 ? (
        <EmptyState title="No audits yet">Open Keywords, check the audit area, and run an audit.</EmptyState>
      ) : (
        <Card padded={false}>
          <Table head={["Keyword", "When", "Status", "Grid", "Avg rank", "Top 3", "Coverage", ""]}>
            {rows.map(({ audit, config, keyword }) => {
              const s = (audit.stats ?? {}) as Record<string, number | null>;
              return (
                <tr key={audit.id}>
                  <Td>
                    <Link href={`/b/${businessId}/rankings/${audit.id}`} className="font-medium text-blue-800 hover:underline">
                      {keyword.phrase}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(audit.createdAt)}</Td>
                  <Td>
                    <StatusBadge status={audit.status} />
                  </Td>
                  <Td className="text-xs">
                    {config.gridSize}×{config.gridSize}, {config.radiusKm} km · v{config.version}
                  </Td>
                  <Td>{s.averageRank ?? "—"}</Td>
                  <Td>{s.top3Share != null ? `${Math.round(s.top3Share * 100)}%` : "—"}</Td>
                  <Td>{s.coverage != null ? `${Math.round(s.coverage * 100)}%` : `${audit.pointsSucceeded}/${audit.pointsTotal}`}</Td>
                  <Td>
                    <DemoBadge show={audit.isDemo} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </>
  );
}
