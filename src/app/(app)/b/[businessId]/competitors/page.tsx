import { Card, DemoBadge, EmptyState, Flash, PageHeader, Table, Td, formatDate } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listCompetitors } from "@/server/services/rankings";
import { competitorAction } from "../rankings/actions";

export const metadata = { title: "Competitors" };

export default async function CompetitorsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const rows = await listCompetitors(actor, businessId);
  const back = `/b/${businessId}/competitors`;
  return (
    <>
      <PageHeader title="Competitors" description="Businesses that appeared in your ranking audits. Numbers come only from audit observations; ratings and review counts are what the ranking provider returned at that time." />
      <Flash ok={sp.ok} err={sp.err} />
      {rows.length === 0 ? (
        <EmptyState title="No competitors seen yet">Competitors appear after your first ranking audit.</EmptyState>
      ) : (
        <Card padded={false}>
          <Table head={["Business", "Last audit: top 3 points", "Points seen", "Avg rank", "Rating", "Reviews", "Last seen", ""]}>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="font-medium">{c.name}</span> <DemoBadge show={c.isDemo} label="Demo" />
                  {c.address && <div className="text-xs text-slate-500">{c.address}</div>}
                </Td>
                <Td>{c.latest?.top3Count ?? "—"}</Td>
                <Td>{c.latest?.appearances ?? "—"}</Td>
                <Td>{c.latest?.averageRank?.toFixed(1) ?? "—"}</Td>
                <Td>{c.latest?.rating ?? "—"}</Td>
                <Td>{c.latest?.reviewCount ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{formatDate(c.lastSeenAt)}</Td>
                <Td>
                  {can("business.edit") && (
                    <form action={competitorAction}>
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="_back" value={back} />
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="tracked" value={String(!c.isTracked)} />
                      <SubmitButton size="sm" variant={c.isTracked ? "secondary" : "ghost"}>
                        {c.isTracked ? "Tracked" : "Track"}
                      </SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
