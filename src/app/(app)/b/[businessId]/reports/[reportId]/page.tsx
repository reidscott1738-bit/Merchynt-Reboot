import { notFound } from "next/navigation";
import { Alert, Card, DemoBadge, Flash, PageHeader, StatusBadge, Table, Td, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { getReport, type ReportData } from "@/server/services/reports";
import { AppError } from "@/server/errors";
import { reportAction } from "../actions";

export const metadata = { title: "Report" };

export default async function ReportView({ params, searchParams }: { params: Promise<{ businessId: string; reportId: string }>; searchParams: SP }) {
  const { businessId, reportId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  let data: Awaited<ReturnType<typeof getReport>>;
  try {
    data = await getReport(actor, businessId, reportId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { report: r, deliveries } = data;
  const d = r.status === "ready" ? (r.data as unknown as ReportData) : null;
  const back = `/b/${businessId}/reports/${r.id}`;
  return (
    <>
      <PageHeader
        title={`Report: ${r.periodStart} to ${r.periodEnd}`}
        back={{ href: `/b/${businessId}/reports`, label: "Reports" }}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={r.status} /> {r.generatedAt && `Generated ${formatDateTime(r.generatedAt)}`} <DemoBadge show={d?.containsDemoData} label="Contains demo data" />
          </span>
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {["queued", "generating"].includes(r.status) && <Alert>The report is being built. Refresh in a minute.</Alert>}
      {r.status === "failed" && <Alert tone="red" title="The report could not be built">{r.error} {r.creditsCharged > 0 && "The credit was refunded."}</Alert>}
      {d && r.html && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card padded={false}>
            {/* The report HTML is generated server-side with escaped values; the sandbox blocks scripts regardless. */}
            <iframe srcDoc={r.html} sandbox="" title="Report" className="h-[80vh] w-full rounded-xl" />
          </Card>
          <div className="space-y-6">
            <Card title="Sources">
              <ul className="list-disc pl-5 text-sm text-slate-600">
                {d.sources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Card>
            {can("reports.manage") && (
              <Card title="Send by email">
                <form action={reportAction} className="space-y-2">
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="_back" value={back} />
                  <input type="hidden" name="reportId" value={r.id} />
                  <Textarea name="recipients" rows={2} placeholder="owner@example.com" required />
                  <SubmitButton name="op" value="send" size="sm">
                    Send
                  </SubmitButton>
                </form>
              </Card>
            )}
            {deliveries.length > 0 && (
              <Card title="Deliveries" padded={false}>
                <Table head={["To", "Status"]}>
                  {deliveries.map((x) => (
                    <tr key={x.id}>
                      <Td className="break-all text-xs">{x.recipient}</Td>
                      <Td>
                        <StatusBadge status={x.status} />
                        {x.error && <div className="text-xs text-red-600">{x.error}</div>}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
