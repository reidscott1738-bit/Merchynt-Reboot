import { Badge, Card, Checkbox, EmptyState, Flash, PageHeader, StatusBadge, Table, Tabs, Td, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listAttributes, listProfileChanges, listServices } from "@/server/services/business";
import { listRecommendations, scoreHistory } from "@/server/services/optimization";
import { listClients } from "@/server/services/agency";
import { BusinessFields } from "../../../businesses/business-form";
import { archiveBusinessAction, importGoogleAction, recommendationsAction, updateBusinessAction } from "../business-actions";
import { AttributesPanel, ServicesPanel } from "../panels";

export const metadata = { title: "Business Profile" };

const show = (v: unknown) => (v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const tab = sp.tab ?? "details";
  const base = `/b/${businessId}/profile`;
  const back = `${base}?tab=${tab}`;
  const h = { businessId, back };
  const canEdit = can("business.edit");
  const recs = await listRecommendations(actor, businessId);
  const tabs = [
    { key: "details", label: "Details", href: `${base}?tab=details` },
    { key: "services", label: "Services", href: `${base}?tab=services` },
    { key: "attributes", label: "Attributes", href: `${base}?tab=attributes` },
    { key: "recommendations", label: "Score & recommendations", href: `${base}?tab=recommendations`, count: recs.length },
    { key: "history", label: "Change history", href: `${base}?tab=history` },
  ];

  let body: React.ReactNode;
  if (tab === "services") body = <ServicesPanel rows={await listServices(actor, businessId)} canEdit={canEdit} {...h} />;
  else if (tab === "attributes")
    body = (
      <Card title="Attributes" description="Attributes are factual claims (e.g. “Women-owned”). They are only sent to Google after a person confirms them.">
        <AttributesPanel rows={await listAttributes(actor, businessId)} canEdit={canEdit} {...h} />
      </Card>
    );
  else if (tab === "history") {
    const changes = await listProfileChanges(actor, businessId, 100);
    body = (
      <Card padded={false} title="Profile change history" description="Every edit, where it came from and whether Google accepted it. “Verified” means the value was read back from Google after writing.">
        {changes.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No changes yet" />
          </div>
        ) : (
          <Table head={["When", "Field", "Before", "After", "Origin", "Google sync"]}>
            {changes.map((c) => (
              <tr key={c.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</Td>
                <Td>{c.field}</Td>
                <Td className="max-w-xs truncate text-xs text-slate-500">{show(c.before)}</Td>
                <Td className="max-w-xs truncate text-xs">{show(c.after)}</Td>
                <Td>{c.origin}</Td>
                <Td>
                  <StatusBadge status={c.syncStatus === "verified" ? "verified" : c.syncStatus} />
                  {c.syncError && <div className="text-xs text-red-600">{c.syncError}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    );
  } else if (tab === "recommendations") {
    const scores = await scoreHistory(actor, businessId);
    const s = scores[0];
    body = (
      <div className="space-y-6">
        <Card
          title={s ? `Profile score: ${s.score} / 100` : "Profile score"}
          description="A completeness and activity checklist computed from your own data. It is this app's measure, not a Google metric."
          actions={
            canEdit && (
              <form action={recommendationsAction} className="flex items-center gap-3">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="_back" value={back} />
                <Checkbox name="generateCopy" defaultChecked label="Draft copy with AI" />
                <SubmitButton name="op" value="analyze" size="sm" pendingText="Analyzing…">
                  Analyze profile
                </SubmitButton>
              </form>
            )
          }
        >
          {s ? (
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {s.breakdown.map((b) => (
                <li key={b.key} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <span>
                    <span className="font-medium">{b.label}</span>
                    <span className="block text-xs text-slate-500">{b.detail}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium">
                    {b.earned}/{b.possible}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Run an analysis to compute the score.</p>
          )}
        </Card>
        <Card title="Recommendations">
          {recs.length === 0 ? (
            <EmptyState title="No open recommendations" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recs.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.impact === "high" ? "red" : r.impact === "medium" ? "yellow" : "gray"}>{r.impact} impact</Badge>
                    <span className="font-medium">{r.issue}</span>
                    {r.requiresFactConfirmation && <Badge tone="blue">Confirm facts first</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
                  {r.nextAction && <p className="mt-1 text-sm">Next step: {r.nextAction}</p>}
                  {canEdit && (
                    <form action={recommendationsAction} className="mt-2 space-y-2">
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="_back" value={back} />
                      <input type="hidden" name="id" value={r.id} />
                      {r.field === "description" && typeof r.proposedValue === "string" && <Textarea name="edited" rows={5} defaultValue={r.proposedValue} maxLength={750} />}
                      {r.field === "service_descriptions" && Array.isArray(r.proposedValue) && (
                        <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                          {(r.proposedValue as { name?: string; description: string }[]).map((x, i) => (
                            <li key={i}>
                              <span className="font-medium">{x.name}</span>: {x.description}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        {r.proposedValue != null && (
                          <SubmitButton name="op" value="apply" size="sm">
                            Apply
                          </SubmitButton>
                        )}
                        <SubmitButton name="op" value="dismiss" size="sm" variant="secondary">
                          Dismiss
                        </SubmitButton>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  } else {
    const clients = actor.orgKind === "agency" && can("clients.manage") ? await listClients(actor) : [];
    body = (
      <div className="space-y-6">
        <Card
          title="Business details"
          description={business.gbpLocationName ? "Changes to name, description, phone, website, category, hours and booking link are sent to Google and verified." : "Google is not connected, so changes are saved here only."}
          actions={
            business.gbpLocationName &&
            can("integrations.manage") && (
              <form action={importGoogleAction}>
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="_back" value={back} />
                <SubmitButton size="sm" variant="secondary">
                  Re-import from Google
                </SubmitButton>
              </form>
            )
          }
        >
          <form action={updateBusinessAction} className="space-y-6">
            <input type="hidden" name="businessId" value={businessId} />
            <input type="hidden" name="_back" value={back} />
            <BusinessFields b={business} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
            {canEdit && <SubmitButton>Save details</SubmitButton>}
          </form>
        </Card>
        {can("business.create") && (
          <Card title="Archive business" description="Stops every automation and hides the business. Data is kept.">
            <form action={archiveBusinessAction}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={back} />
              <SubmitButton variant="danger" confirm="Archive this business and stop all automations?">
                Archive business
              </SubmitButton>
            </form>
          </Card>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Business Profile" description={business.gbpLocationName ? `Linked to Google location ${business.gbpLocationName}` : "Not linked to Google yet"} />
      <Flash ok={sp.ok} err={sp.err} />
      <Tabs items={tabs} current={tab} />
      {body}
    </>
  );
}
