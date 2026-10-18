import Link from "next/link";
import { Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, StatusBadge, Table, Td, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { creditBalance, listReports, ON_DEMAND_REPORT_CREDITS } from "@/server/services/reports";
import { reportAction } from "./actions";

export const metadata = { title: "Reports" };

const SECTIONS: [string, string][] = [
  ["performance", "Google profile performance"],
  ["lead_actions", "Calls, directions and website clicks"],
  ["rankings", "Map rankings"],
  ["competitors", "Competitors"],
  ["ai_visibility", "AI visibility"],
  ["reviews", "Reviews"],
  ["activity", "Work completed"],
];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const [rows, credits] = await Promise.all([listReports(actor, businessId), creditBalance(actor.orgId)]);
  const now = new Date();
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return (
    <>
      <PageHeader title="Reports" description="Monthly reports are built automatically when the Monthly report automation is on. Every number shows where it came from; estimates are labeled." />
      <Flash ok={sp.ok} err={sp.err} />
      {can("reports.manage") && (
        <Card title="On-demand report" description={`Uses ${ON_DEMAND_REPORT_CREDITS} credit. Your organization has ${credits} credit${credits === 1 ? "" : "s"}. Failed reports are refunded.`} className="mb-6">
          <form action={reportAction} className="space-y-4">
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="_back" value={`/b/${businessId}/reports`} />
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="From">
                <Input name="start" type="date" required defaultValue={iso(lastMonthStart)} />
              </Field>
              <Field label="To">
                <Input name="end" type="date" required defaultValue={iso(lastMonthEnd)} max={iso(now)} />
              </Field>
              <Field label="Email to (optional)" hint="Comma or line separated.">
                <Textarea name="recipients" rows={1} />
              </Field>
            </div>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
              {SECTIONS.map(([k, l]) => (
                <Checkbox key={k} name="include" value={k} defaultChecked label={l} />
              ))}
            </div>
            <SubmitButton name="op" value="request" disabled={credits < ON_DEMAND_REPORT_CREDITS}>
              Build report
            </SubmitButton>
          </form>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No reports yet" />
      ) : (
        <Card padded={false}>
          <Table head={["Period", "Type", "Status", "Generated", ""]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.periodStart} to {r.periodEnd}
                </Td>
                <Td>{r.type === "monthly" ? "Monthly" : `On demand (${r.creditsCharged} credit)`}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                  {r.error && <div className="mt-1 max-w-64 text-xs text-red-600">{r.error}</div>}
                </Td>
                <Td className="text-xs">{formatDateTime(r.generatedAt)}</Td>
                <Td>
                  <Link href={`/b/${businessId}/reports/${r.id}`} className="text-blue-700 underline">
                    Open
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
