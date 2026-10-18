import { Alert, Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Tabs, Td, Textarea, formatDateTime } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { currentSchemaDocument, latestSeoAudit, listFaqs } from "@/server/services/seo";
import { seoAction } from "./actions";

export const metadata = { title: "Website & AI SEO" };

const BASIS: Record<string, string> = { detected: "Found on the page", recommendation: "Suggestion", assumption: "Best guess" };

export default async function SeoPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const tab = sp.tab ?? "audit";
  const base = `/b/${businessId}/seo`;
  const back = `${base}?tab=${tab}`;
  const edit = can("website.edit");
  const H = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );

  let body: React.ReactNode;
  if (tab === "schema") {
    const doc = await currentSchemaDocument(actor, businessId);
    body = (
      <Card
        title="Structured data (JSON-LD)"
        description="LocalBusiness markup built only from your verified profile facts. Sites built here include it automatically; for another site, paste it into the page head."
        actions={
          edit && (
            <form action={seoAction}>
              <H />
              <SubmitButton name="op" value="schema" size="sm" variant="secondary">
                {doc ? "Regenerate" : "Generate"}
              </SubmitButton>
            </form>
          )
        }
      >
        {!doc ? (
          <p className="text-sm text-slate-500">Not generated yet.</p>
        ) : (
          <div className="space-y-3">
            {doc.validation.issues.length > 0 ? (
              <Alert tone={doc.validation.ok ? "yellow" : "red"} title="Checks">
                <ul className="list-disc pl-5">
                  {doc.validation.issues.map((i) => (
                    <li key={i.code + i.message}>{i.message}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="green">The markup passed all checks. Confirm with Google&apos;s Rich Results Test after adding it to a live page.</Alert>
            )}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Generated {formatDateTime(doc.createdAt)}</span>
              <CopyButton value={doc.scriptTag} label="Copy script tag" />
            </div>
            <pre className="max-h-[32rem] overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(doc.jsonLd, null, 2)}</pre>
          </div>
        )}
      </Card>
    );
  } else if (tab === "faqs") {
    const faqs = await listFaqs(actor, businessId);
    body = (
      <div className="space-y-6">
        {edit && (
          <Card title="Add FAQs" description="AI drafts answers only from verified facts. Every draft goes to Tasks for approval before it appears on your website.">
            <div className="flex flex-wrap items-end gap-6">
              <form action={seoAction} className="flex items-end gap-2">
                <H />
                <Field label="How many">
                  <Select name="count" defaultValue="5">
                    {[3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton name="op" value="faq-generate" pendingText="Writing…">
                  Draft with AI
                </SubmitButton>
              </form>
            </div>
            <form action={seoAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
              <H />
              <Field label="Question">
                <Input name="question" required maxLength={200} />
              </Field>
              <Field label="Answer">
                <Textarea name="answer" required rows={3} />
              </Field>
              <div>
                <SubmitButton name="op" value="faq-save" size="sm" variant="secondary">
                  Add FAQ
                </SubmitButton>
              </div>
            </form>
          </Card>
        )}
        {faqs.length === 0 ? (
          <EmptyState title="No FAQs yet">FAQs answer common customer questions on your website and help AI assistants describe your business accurately.</EmptyState>
        ) : (
          faqs.map((f) => (
            <Card key={f.id}>
              <form action={seoAction} className="space-y-2">
                <H />
                <input type="hidden" name="id" value={f.id} />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={f.status} />
                  {f.staleSince && <Badge tone="yellow">Facts changed since this was written</Badge>}
                  {f.validation?.issues.map((i) => (
                    <Badge key={i.code + i.message} tone={i.severity === "error" ? "red" : "yellow"}>
                      {i.message}
                    </Badge>
                  ))}
                </div>
                <Input name="question" defaultValue={f.question} disabled={!edit} aria-label="Question" className="font-medium" />
                <Textarea name="answer" defaultValue={f.answer} rows={3} disabled={!edit} aria-label="Answer" />
                {edit && (
                  <div className="flex gap-2">
                    <input type="hidden" name="status" value="approved" />
                    <SubmitButton name="op" value="faq-save" size="sm" variant="secondary">
                      {f.status === "approved" || f.status === "published" ? "Save" : "Save and approve"}
                    </SubmitButton>
                    <SubmitButton name="op" value="faq-delete" size="sm" variant="ghost" confirm="Delete this FAQ?">
                      Delete
                    </SubmitButton>
                  </div>
                )}
              </form>
            </Card>
          ))
        )}
      </div>
    );
  } else {
    const latest = await latestSeoAudit(actor, businessId);
    const recs = latest?.recommendations.filter((r) => r.status !== "dismissed") ?? [];
    const order = { needs_work: 0, unverifiable: 1, pending: 2, applied: 3, optimized: 4, dismissed: 5 } as const;
    recs.sort((a, b) => order[a.status] - order[b.status]);
    body = (
      <div className="space-y-6">
        {can("audits.run") && (
          <Card title="Audit a page" description="Fetches the page the way a search engine does and checks titles, headings, local signals, structured data, robots.txt and sitemap. Facts found on the site are proposed for you to confirm in Train AI.">
            <form action={seoAction} className="flex flex-wrap gap-2">
              <H />
              <Input name="url" type="url" defaultValue={latest?.audit.url ?? business.website ?? ""} placeholder="https://example.com" className="min-w-72 flex-1" />
              <SubmitButton name="op" value="audit" pendingText="Starting…">
                Run audit
              </SubmitButton>
            </form>
          </Card>
        )}
        {!latest ? (
          <EmptyState title="No audits yet">Run an audit of your homepage to get page-by-page recommendations.</EmptyState>
        ) : (
          <Card title={latest.audit.url} description={<span className="flex items-center gap-2"><StatusBadge status={latest.audit.status} /> {formatDateTime(latest.audit.completedAt ?? latest.audit.createdAt)}{latest.audit.httpStatus ? ` · HTTP ${latest.audit.httpStatus}` : ""}</span>}>
            {latest.audit.status === "failed" && <Alert tone="red" title="The audit could not finish">{latest.audit.error}</Alert>}
            {["queued", "running"].includes(latest.audit.status) && <Alert>The audit is running. Refresh in a minute.</Alert>}
            {recs.length > 0 && (
              <Table head={["Element", "Status", "Found", "Recommendation", ""]}>
                {recs.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.element}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                      <div className="mt-1 text-xs text-slate-500" title={`Confidence ${Math.round(r.confidence * 100)}%`}>
                        {BASIS[r.basis]}
                      </div>
                    </Td>
                    <Td className="max-w-56 break-words text-xs text-slate-600">{r.currentValue ?? "None"}</Td>
                    <Td className="max-w-md text-sm">
                      <p>{r.explanation}</p>
                      {r.recommendedValue && (
                        <p className="mt-1 flex items-start gap-2 rounded bg-slate-50 p-2 text-xs">
                          <span className="flex-1 break-words">{r.recommendedValue}</span>
                          <CopyButton value={r.recommendedValue} />
                        </p>
                      )}
                      {r.instructions && <p className="mt-1 text-xs text-slate-500">{r.instructions}</p>}
                    </Td>
                    <Td>
                      {edit && ["needs_work", "unverifiable", "pending"].includes(r.status) && (
                        <form action={seoAction} className="flex flex-col gap-1">
                          <H />
                          <input type="hidden" name="recId" value={r.id} />
                          <SubmitButton name="op" value="applied" size="sm" variant="secondary">
                            Done
                          </SubmitButton>
                          <SubmitButton name="op" value="dismissed" size="sm" variant="ghost">
                            Dismiss
                          </SubmitButton>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Website & AI SEO" description="Make your website clear to search engines and AI assistants." />
      <Flash ok={sp.ok} err={sp.err} />
      <Tabs
        current={tab}
        items={[
          { key: "audit", label: "Page audit", href: `${base}?tab=audit` },
          { key: "schema", label: "Structured data", href: `${base}?tab=schema` },
          { key: "faqs", label: "FAQs", href: `${base}?tab=faqs` },
        ]}
      />
      {body}
    </>
  );
}
