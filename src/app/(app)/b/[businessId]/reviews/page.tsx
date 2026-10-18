import { Alert, Badge, Card, DemoBadge, EmptyState, Field, Flash, Input, PageHeader, Select, Stars, Stat, StatusBadge, Tabs, Textarea, formatDate, formatDateTime } from "@/components/ui";
import { AutoSubmitSelect, SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { detectPolicySignals, getPolicies, listRemovalRequests, listReviews, listTemplates, reviewStats } from "@/server/services/reviews";
import { ReviewPolicyForm } from "../panels";
import { removalAction, reviewAction, templateAction } from "./actions";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const tab = sp.tab ?? "inbox";
  const base = `/b/${businessId}/reviews`;
  const qs = new URLSearchParams(Object.entries({ tab, rating: sp.rating, status: sp.status, q: sp.q }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `${base}?${qs}`;
  const canReply = can("reviews.reply");
  const hidden = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );
  const stats = await reviewStats(businessId);

  let body: React.ReactNode;
  if (tab === "rules") {
    const [policies, templates] = await Promise.all([getPolicies(businessId), listTemplates(actor, businessId)]);
    body = (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Reply rules by rating">{can("reviews.manage") ? <ReviewPolicyForm policies={policies} templates={templates} businessId={businessId} back={back} /> : <p className="text-sm text-slate-500">Only managers can change reply rules.</p>}</Card>
        <Card title="Templates" description="Placeholders: {first_name}, {business_name}. Templates are checked before saving.">
          <ul className="space-y-4">
            {templates.map((t) => (
              <li key={t.id}>
                <form action={templateAction} className="space-y-2">
                  {hidden()}
                  <input type="hidden" name="id" value={t.id} />
                  <Input name="name" defaultValue={t.name} required />
                  <Textarea name="body" rows={3} defaultValue={t.body} required />
                  <div className="flex gap-2">
                    <SubmitButton size="sm" variant="secondary" name="op" value="save">
                      Save
                    </SubmitButton>
                    <SubmitButton size="sm" variant="ghost" name="op" value="delete" confirm="Delete this template?">
                      Delete
                    </SubmitButton>
                  </div>
                </form>
              </li>
            ))}
          </ul>
          <form action={templateAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            {hidden()}
            <Field label="New template name">
              <Input name="name" required />
            </Field>
            <Textarea name="body" rows={3} required placeholder="Thank you {first_name}! We appreciate you choosing {business_name}." />
            <SubmitButton size="sm">Add template</SubmitButton>
          </form>
        </Card>
      </div>
    );
  } else if (tab === "removals") {
    const rows = await listRemovalRequests(actor, businessId);
    body = (
      <Card title="Removal requests" description="Google has no API for review removal. Record a request here, submit it in Google's review management tool, then record the outcome. Flags below are heuristics for you to judge, not determinations.">
        {rows.length === 0 ? (
          <EmptyState title="No removal requests" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(({ report, review }) => (
              <li key={report.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} /> <span className="font-medium">{review.reviewerName ?? "Anonymous"}</span> <StatusBadge status={report.status} />
                </div>
                <p className="mt-1 text-slate-600">{review.text}</p>
                <p className="mt-1">Reason: {report.reason}</p>
                {report.detectedSignals?.length ? <p className="text-xs text-slate-500">Signals: {report.detectedSignals.join(", ")}</p> : null}
                <form action={removalAction} className="mt-2 flex flex-wrap items-end gap-2">
                  {hidden()}
                  <input type="hidden" name="id" value={report.id} />
                  <Select name="status" defaultValue={report.status === "draft" ? "submitted" : report.status} className="w-48">
                    <option value="submitted">Submitted to Google</option>
                    <option value="removed">Google removed it</option>
                    <option value="kept">Google kept it</option>
                    <option value="unknown">Outcome unknown</option>
                  </Select>
                  <Input name="notes" placeholder="Notes" defaultValue={report.notes ?? ""} className="w-64" />
                  <SubmitButton size="sm" variant="secondary">
                    Update
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  } else {
    const rows = await listReviews(actor, businessId, { rating: sp.rating ? Number(sp.rating) : undefined, status: sp.status ?? "all", q: sp.q });
    body = (
      <>
        <form action={base} className="mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="inbox" />
          <AutoSubmitSelect name="status" defaultValue={sp.status ?? "all"} aria-label="Status">
            <option value="all">All reviews</option>
            <option value="needs_action">Needs action</option>
            <option value="unanswered">Unanswered</option>
            <option value="pending_approval">Pending approval</option>
            <option value="published">Replied</option>
            <option value="failed">Failed</option>
            <option value="ignored">Ignored</option>
          </AutoSubmitSelect>
          <AutoSubmitSelect name="rating" defaultValue={sp.rating ?? ""} aria-label="Rating">
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} stars
              </option>
            ))}
          </AutoSubmitSelect>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search text or name" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No reviews">{business.gbpLocationName ? "Sync to pull reviews from Google." : "Connect Google Business Profile to sync reviews."}</EmptyState>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const draft = r.latestReply && ["draft", "pending_approval", "failed"].includes(r.latestReply.status) ? r.latestReply : null;
              const signals = r.rating <= 2 ? detectPolicySignals(r, business.name) : [];
              return (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Stars rating={r.rating} />
                    <span className="font-medium">{r.reviewerName ?? "Anonymous"}</span>
                    <span className="text-xs text-slate-500">{formatDate(r.publishedAt)}</span>
                    <StatusBadge status={r.replyStatus} />
                    <DemoBadge show={r.isDemo} />
                    {r.sentiment && <Badge>{r.sentiment}</Badge>}
                  </div>
                  {r.text ? <p className="mt-2 whitespace-pre-wrap text-sm">{r.text}</p> : <p className="mt-2 text-sm italic text-slate-400">Rating only</p>}
                  {r.ownerReply && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                      <p className="text-xs font-medium text-slate-500">Owner reply {r.ownerReplyAt && `· ${formatDateTime(r.ownerReplyAt)}`}</p>
                      <p className="whitespace-pre-wrap">{r.ownerReply}</p>
                    </div>
                  )}
                  {r.latestReply?.status === "published" && !r.ownerReply && (
                    <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
                      <p className="text-xs font-medium text-emerald-700">Reply published {r.isDemo ? "(demo, not sent to Google)" : ""}</p>
                      <p className="whitespace-pre-wrap">{r.latestReply.content}</p>
                    </div>
                  )}
                  {canReply && !r.ownerReply && !["published", "publishing"].includes(r.replyStatus) && (
                    <details className="mt-3" open={Boolean(draft)}>
                      <summary className="cursor-pointer text-sm font-medium text-blue-800">{draft ? "Edit and publish reply" : "Reply"}</summary>
                      <form action={reviewAction} className="mt-2 space-y-2">
                        {hidden()}
                        <input type="hidden" name="reviewId" value={r.id} />
                        <Textarea name="content" rows={4} defaultValue={draft?.content ?? ""} maxLength={4000} />
                        {draft?.validation && draft.validation.issues.length > 0 && (
                          <ul className="text-xs">
                            {draft.validation.issues.map((i, n) => (
                              <li key={n} className={i.severity === "error" ? "text-red-600" : "text-amber-700"}>
                                {i.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {draft?.origin === "ai" && Boolean((draft.generation as { demo?: boolean } | null)?.demo) && <DemoBadge label="Demo template draft" />}
                        {draft?.taskId && <p className="text-xs text-slate-500">This draft also has an approval task.</p>}
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton name="op" value="submit" size="sm">
                            Publish reply
                          </SubmitButton>
                          <SubmitButton name="op" value="draft" size="sm" variant="secondary" pendingText="Drafting…">
                            {draft ? "Redraft with AI" : "Draft with AI"}
                          </SubmitButton>
                          <SubmitButton name="op" value="ignore" size="sm" variant="ghost">
                            No reply needed
                          </SubmitButton>
                          {["ignored", "failed"].includes(r.replyStatus) && (
                            <SubmitButton name="op" value="requeue" size="sm" variant="ghost">
                              Process again
                            </SubmitButton>
                          )}
                        </div>
                      </form>
                    </details>
                  )}
                  {canReply && r.rating <= 3 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-500">Request removal{signals.length ? ` (${signals.length} possible policy signal${signals.length > 1 ? "s" : ""})` : ""}</summary>
                      <form action={reviewAction} className="mt-2 space-y-2">
                        {hidden()}
                        <input type="hidden" name="reviewId" value={r.id} />
                        {signals.length > 0 && <p className="text-xs text-slate-500">Signals: {signals.join(", ")}</p>}
                        <Input name="reason" required placeholder="Which Google policy does it violate?" defaultValue={signals[0] ?? ""} />
                        <Input name="evidence" placeholder="Evidence (e.g. no record of this customer)" />
                        <SubmitButton name="op" value="report" size="sm" variant="secondary">
                          Record removal request
                        </SubmitButton>
                      </form>
                    </details>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Replies follow your per-star rules. Every reply is checked for invented facts, promises and personal data before it can publish."
        actions={
          can("reviews.manage") && (
            <form action={reviewAction} className="flex gap-2">
              {hidden()}
              {business.gbpLocationName && (
                <SubmitButton name="op" value="sync" variant="secondary" pendingText="Syncing…">
                  Sync from Google
                </SubmitButton>
              )}
              <SubmitButton name="op" value="process" pendingText="Processing…">
                Process new reviews
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {!business.gbpLocationName && stats.demoCount === 0 && (
        <div className="mb-4">
          <Alert tone="blue">Google is not connected, so there are no reviews to show and replies cannot be published.</Alert>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Reviews synced" value={stats.total} demo={stats.demoCount > 0} />
        <Stat label="Average" value={stats.average ? `${stats.average}★` : "—"} hint="Of reviews stored here" />
        <Stat label="Replied" value={stats.responseRate == null ? "—" : `${Math.round(stats.responseRate * 100)}%`} />
        <Stat label="Needs action" value={(stats.byStatus.pending_approval ?? 0) + (stats.byStatus.escalated ?? 0) + (stats.byStatus.failed ?? 0)} />
      </div>
      <Tabs
        current={tab}
        items={[
          { key: "inbox", label: "Inbox", href: `${base}?tab=inbox` },
          { key: "rules", label: "Reply rules & templates", href: `${base}?tab=rules` },
          { key: "removals", label: "Removal requests", href: `${base}?tab=removals` },
        ]}
      />
      {body}
    </>
  );
}
