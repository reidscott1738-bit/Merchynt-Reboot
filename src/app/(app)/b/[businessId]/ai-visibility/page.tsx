import Link from "next/link";
import { Alert, Badge, Card, Checkbox, DemoBadge, EmptyState, Field, Flash, PageHeader, Select, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listAiVisibilityAudits, providerAvailability } from "@/server/services/ai-visibility";
import { listKeywords } from "@/server/services/rankings";
import { aiVisibilityAction } from "./actions";

export const metadata = { title: "AI Visibility" };

export default async function AiVisibilityPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const [audits, kws] = await Promise.all([listAiVisibilityAudits(actor, businessId), listKeywords(actor, businessId)]);
  const providers = providerAvailability(business.name);
  const tracked = kws.filter((k) => k.isTracked);
  return (
    <>
      <PageHeader title="AI Visibility" description="See whether AI assistants name your business when people ask for local recommendations." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4">
        <Alert title="How to read these results">
          Each assistant is asked the same questions through its public API. API answers can differ from what someone sees in the consumer app, and answers change from day to day, so treat results as a sample, not a ranking.
        </Alert>
      </div>
      {can("audits.run") && (
        <Card title="Run an audit" className="mb-6">
          {tracked.length === 0 ? (
            <p className="text-sm text-slate-600">
              Add tracked keywords on the <Link href={`/b/${businessId}/keywords`} className="text-blue-700 underline">Keywords</Link> page first.
            </p>
          ) : (
            <form action={aiVisibilityAction} className="space-y-4">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={`/b/${businessId}/ai-visibility`} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700">Assistants</p>
                  {providers.map((p) => (
                    <Checkbox
                      key={p.id}
                      name="providers"
                      value={p.id}
                      defaultChecked={p.support !== "unsupported"}
                      disabled={p.support === "unsupported"}
                      label={
                        <span className="flex flex-wrap items-center gap-1.5">
                          {p.label} {p.isDemo && <Badge tone="purple">demo answers</Badge>} {p.support === "limited" && <Badge tone="yellow">limited</Badge>}
                          {p.support === "unsupported" && <Badge>unavailable</Badge>}
                        </span>
                      }
                      hint={p.notes}
                    />
                  ))}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-700">Keywords (up to 10)</p>
                    {tracked.slice(0, 10).map((k) => (
                      <Checkbox key={k.id} name="keywordIds" value={k.id} defaultChecked label={k.phrase} />
                    ))}
                  </div>
                  <Field label="Question variations per keyword">
                    <Select name="queriesPerKeyword" defaultValue="1">
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </Select>
                  </Field>
                </div>
              </div>
              <SubmitButton pendingText="Starting…">Run audit</SubmitButton>
            </form>
          )}
        </Card>
      )}
      {audits.length === 0 ? (
        <EmptyState title="No audits yet" />
      ) : (
        <Card title="Past audits" padded={false}>
          <Table head={["Started", "Assistants", "Status", "Mentioned", ""]}>
            {audits.map((a) => (
              <tr key={a.id}>
                <Td>{formatDateTime(a.createdAt)}</Td>
                <Td className="text-xs">{a.providers.join(", ")}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  {a.stats?.succeeded ? `${a.stats.mentioned ?? 0} of ${a.stats.succeeded} answers` : "—"} <DemoBadge show={Boolean(a.stats?.demo)} label="demo" />
                </Td>
                <Td>
                  <Link href={`/b/${businessId}/ai-visibility/${a.id}`} className="text-blue-700 underline">
                    View
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
