import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { KNOWLEDGE_CATEGORIES, type businessKnowledge, type businessServices, type businessAttributes, type reviewTemplates } from "@/server/db/schema";
import type { RatingPolicy } from "@/lib/review-policy";
import type { TrustPlanItem } from "@/server/services/business";
import { attributeAction, applyTrustAction, knowledgeAction, savePoliciesAction, serviceAction } from "./business-actions";

type Hidden = { businessId: string; back: string };
function H({ businessId, back }: Hidden) {
  return (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );
}

const SOURCE_LABEL: Record<string, string> = { gbp: "Google profile", website: "Website", user: "Entered by you", import: "Import", ai_extracted: "AI extracted", ai_suggested: "AI suggestion", recommendation: "Recommendation" };

export function KnowledgePanel({ rows, canEdit, ...h }: Hidden & { rows: (typeof businessKnowledge.$inferSelect)[]; canEdit: boolean }) {
  const pending = rows.filter((r) => r.verificationStatus === "unverified");
  const rest = rows.filter((r) => r.verificationStatus !== "unverified");
  return (
    <div className="space-y-6">
      <Card title="Facts waiting for confirmation" description="Imported or extracted facts are never used as verified claims until a person confirms them.">
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing to confirm.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((k) => (
              <li key={k.id} className="py-3">
                <form action={knowledgeAction} className="space-y-2">
                  <H {...h} />
                  <input type="hidden" name="id" value={k.id} />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{k.category.replace("_", " ")}</Badge>
                    <span className="font-medium">{k.key}</span>
                    <span className="text-xs text-slate-500">from {SOURCE_LABEL[k.source] ?? k.source}</span>
                  </div>
                  <Textarea name="value" rows={2} defaultValue={k.value} disabled={!canEdit} />
                  {k.evidence && <p className="text-xs text-slate-500">Evidence: “{k.evidence}”{k.sourceRef && <> · {k.sourceRef}</>}</p>}
                  {canEdit && (
                    <div className="flex gap-2">
                      <SubmitButton name="op" value="verify" size="sm">
                        Confirm
                      </SubmitButton>
                      <SubmitButton name="op" value="reject" size="sm" variant="secondary">
                        Not accurate
                      </SubmitButton>
                    </div>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Business knowledge" description="Verified facts the AI may state. Anything not listed here is not claimed in generated content.">
        {rest.length === 0 ? (
          <EmptyState title="No facts yet">Add facts such as years in business, licenses, warranties or pricing policies.</EmptyState>
        ) : (
          <Table head={["Category", "Fact", "Value", "Status", ""]}>
            {rest.map((k) => (
              <tr key={k.id}>
                <Td>{k.category.replace("_", " ")}</Td>
                <Td className="font-medium">{k.key}</Td>
                <Td className="max-w-md whitespace-pre-wrap">{k.value}</Td>
                <Td>
                  <StatusBadge status={k.verificationStatus} />
                </Td>
                <Td>
                  {canEdit && (
                    <form action={knowledgeAction}>
                      <H {...h} />
                      <input type="hidden" name="id" value={k.id} />
                      <Button name="op" value="delete" variant="ghost" size="sm">
                        Delete
                      </Button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {canEdit && (
          <form action={knowledgeAction} className="mt-5 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4">
            <H {...h} />
            <input type="hidden" name="op" value="add" />
            <Field label="Category">
              <Select name="category">
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fact">
              <Input name="key" required placeholder="Years in business" />
            </Field>
            <Field label="Value" className="md:col-span-2">
              <Input name="value" required placeholder="Family owned since 1998" />
            </Field>
            <Checkbox name="isPublic" defaultChecked label="OK to mention publicly" />
            <div className="md:col-span-3">
              <SubmitButton size="sm">Add fact</SubmitButton>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

export function ServicesPanel({ rows, canEdit, ...h }: Hidden & { rows: (typeof businessServices.$inferSelect)[]; canEdit: boolean }) {
  const proposals = rows.filter((r) => r.status === "proposed_add" || r.status === "proposed_remove");
  const active = rows.filter((r) => r.status === "active");
  return (
    <div className="space-y-6">
      {proposals.length > 0 && (
        <Card
          title="Suggested changes"
          description="Suggestions do not change your profile until approved."
          actions={
            canEdit && (
              <form action={serviceAction}>
                <H {...h} />
                <SubmitButton name="op" value="bulk" size="sm" variant="secondary">
                  Approve all
                </SubmitButton>
              </form>
            )
          }
        >
          <ul className="divide-y divide-slate-100 text-sm">
            {proposals.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Badge tone={s.status === "proposed_add" ? "green" : "red"}>{s.status === "proposed_add" ? "Add" : "Remove"}</Badge> <span className="font-medium">{s.name}</span> <span className="text-xs text-slate-500">{SOURCE_LABEL[s.source]}</span>
                </span>
                {canEdit && (
                  <form action={serviceAction} className="flex gap-2">
                    <H {...h} />
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton name="op" value="approve" size="sm">
                      Approve
                    </SubmitButton>
                    <SubmitButton name="op" value="reject" size="sm" variant="secondary">
                      Reject
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Services" description="Services sync to Google where the profile's category allows editing the service list.">
        {active.length === 0 ? (
          <EmptyState title="No services yet">Add the services you want to be found for.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((s) => (
              <li key={s.id} className="py-3">
                <form action={serviceAction} className="grid gap-2 md:grid-cols-[1fr_2fr_auto] md:items-start">
                  <H {...h} />
                  <input type="hidden" name="id" value={s.id} />
                  <div>
                    <Input name="name" defaultValue={s.name} disabled={!canEdit} />
                    <div className="mt-1 flex gap-1">
                      <StatusBadge status={s.syncStatus === "synced" ? "published" : s.syncStatus} />
                      {s.lastError && <span className="text-xs text-red-600">{s.lastError}</span>}
                    </div>
                  </div>
                  <Textarea name="description" rows={2} defaultValue={s.description ?? ""} maxLength={1000} disabled={!canEdit} />
                  {canEdit && (
                    <div className="flex gap-1">
                      <SubmitButton name="op" value="update" size="sm" variant="secondary">
                        Save
                      </SubmitButton>
                      <SubmitButton name="op" value="remove" size="sm" variant="ghost" confirm="Remove this service?">
                        Remove
                      </SubmitButton>
                    </div>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form action={serviceAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
            <H {...h} />
            <input type="hidden" name="op" value="add" />
            <Field label="New service">
              <Input name="name" required minLength={2} />
            </Field>
            <Field label="Description (optional)">
              <Input name="description" maxLength={1000} />
            </Field>
            <SubmitButton size="sm">Add</SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}

export function AttributesPanel({ rows, canEdit, ...h }: Hidden & { rows: (typeof businessAttributes.$inferSelect)[]; canEdit: boolean }) {
  if (!rows.length) return <EmptyState title="No attributes imported">Attributes such as “Wheelchair accessible entrance” import from Google once the profile is connected.</EmptyState>;
  return (
    <Table head={["Attribute", "Value", "Status", "Sync", ""]}>
      {rows.map((a) => (
        <tr key={a.id}>
          <Td>
            {a.displayName}
            {a.groupName && <div className="text-xs text-slate-500">{a.groupName}</div>}
          </Td>
          <Td>{a.value === true ? "Yes" : a.value === false ? "No" : Array.isArray(a.value) ? a.value.join(", ") : (a.value ?? "—")}</Td>
          <Td>
            <StatusBadge status={a.status} />
          </Td>
          <Td>
            <StatusBadge status={a.syncStatus} />
          </Td>
          <Td>
            {canEdit && a.status === "suggested" && (
              <form action={attributeAction} className="flex gap-1">
                <H {...h} />
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton name="op" value="confirm" size="sm">
                  Confirm true
                </SubmitButton>
                <SubmitButton name="op" value="reject" size="sm" variant="secondary">
                  Reject
                </SubmitButton>
              </form>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

const MODE_LABEL: Record<string, string> = { auto: "Reply and publish automatically", approval: "Draft a reply for approval", template: "Use a saved template", ignore: "Don't reply" };

export function ReviewPolicyForm({ policies, templates, completeStep, ...h }: Hidden & { policies: RatingPolicy[]; templates: (typeof reviewTemplates.$inferSelect)[]; completeStep?: string }) {
  return (
    <form action={savePoliciesAction} className="space-y-4">
      <H {...h} />
      {completeStep && <input type="hidden" name="completeStep" value={completeStep} />}
      <p className="text-sm text-slate-600">Choose what happens for each star rating. Replies that fail validation always wait for a person, whatever the rule says.</p>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {[5, 4, 3, 2, 1].map((rating) => {
          const p = policies.find((x) => x.rating === rating) ?? { rating, mode: "approval" as const };
          return (
            <div key={rating} className="grid gap-3 p-3 md:grid-cols-[6rem_1fr_1fr] md:items-center">
              <span className="font-medium text-amber-600">{"★".repeat(rating)}</span>
              <Select name={`mode_${rating}`} defaultValue={p.mode} aria-label={`${rating}-star rule`}>
                {Object.entries(MODE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <div className="space-y-1">
                <Select name={`template_${rating}`} defaultValue={p.templateId ?? ""} aria-label="Template">
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap gap-3">
                  <Checkbox name={`tplApproval_${rating}`} defaultChecked={p.templateRequiresApproval} label="Template replies need approval" />
                  <Checkbox name={`escalate_${rating}`} defaultChecked={p.escalate} label="Alert me" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <SubmitButton>Save reply rules</SubmitButton>
    </form>
  );
}

export function TrustPlan({ items, applied, ...h }: Hidden & { items: TrustPlanItem[]; applied: boolean }) {
  return (
    <form action={applyTrustAction} className="space-y-4">
      <H {...h} />
      <p className="text-sm text-slate-600">
        These are suggested starting settings. Review each one; nothing changes until you apply them, and you can change any setting later. Posts always start in approval mode. Only 5-star review replies publish without approval.
      </p>
      {applied && <p className="text-sm text-emerald-700">Recommended settings were applied earlier. Applying again resets the selected automations to these defaults.</p>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((it) => (
          <li key={it.type} className="p-3">
            <Checkbox
              name="accept"
              value={it.type}
              defaultChecked={it.enable}
              label={
                <span className="font-medium">
                  {it.label} {it.publishesAutomatically && <Badge tone="yellow">Publishes automatically</Badge>}
                </span>
              }
              hint={it.detail}
            />
          </li>
        ))}
      </ul>
      <SubmitButton>Apply selected settings</SubmitButton>
    </form>
  );
}
