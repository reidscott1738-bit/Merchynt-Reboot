import { Badge, Card, Checkbox, Field, Flash, Input, PageHeader, Select, StatusBadge, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listAutomations } from "@/server/services/automations";
import { listKeywords } from "@/server/services/rankings";
import { listCampaigns } from "@/server/services/campaigns";
import { AI_SEARCH_PROVIDER_IDS } from "@/server/integrations/ai-search";
import { runAutomationAction, saveAutomationAction } from "./actions";

export const metadata = { title: "Automations" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEALTH: Record<string, { tone: "green" | "yellow" | "red" | "gray" | "blue"; label: string }> = {
  off: { tone: "gray", label: "Off" },
  healthy: { tone: "green", label: "Healthy" },
  waiting: { tone: "blue", label: "Waiting for first run" },
  degraded: { tone: "yellow", label: "Last run failed" },
  failing: { tone: "red", label: "Failing" },
};
const SECTIONS = ["performance", "lead_actions", "rankings", "competitors", "ai_visibility", "reviews", "activity"];

export default async function AutomationsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const [rows, kws, campaigns] = await Promise.all([listAutomations(actor, businessId), listKeywords(actor, businessId), listCampaigns(actor, businessId)]);
  const back = `/b/${businessId}/automations`;
  const canEdit = can("automations.manage");
  return (
    <>
      <PageHeader title="Automations" description="Each automation runs on its schedule in the business time zone. Anything that publishes respects its approval setting, and failed runs are retried and reported here." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4">
        {rows.map(({ type, meta, rule, scheduleText, timezone, runs, health }) => {
          const c = rule.config as Record<string, unknown>;
          const s = rule.schedule;
          const h = HEALTH[health];
          return (
            <Card
              key={type}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {meta.label} <Badge tone={h.tone}>{h.label}</Badge> {meta.publishes && <Badge tone="blue">Publishes</Badge>}
                </span>
              }
              description={meta.description}
              actions={
                canEdit && (
                  <form action={runAutomationAction}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="_back" value={back} />
                    <input type="hidden" name="type" value={type} />
                    <SubmitButton size="sm" variant="secondary">
                      Run now
                    </SubmitButton>
                  </form>
                )
              }
            >
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                <span>{scheduleText} ({timezone})</span>
                <span>Next run: {rule.enabled ? formatDateTime(rule.nextRunAt, timezone) : "—"}</span>
                <span>Last success: {formatDateTime(rule.lastSuccessAt, timezone)}</span>
                {rule.lastError && <span className="text-red-600">Last error: {rule.lastError}</span>}
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-blue-800">Settings and history</summary>
                <form action={saveAutomationAction} className="mt-4 space-y-5">
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="_back" value={back} />
                  <input type="hidden" name="type" value={type} />
                  <Checkbox name="enabled" defaultChecked={rule.enabled} label="Enabled" disabled={!canEdit} />
                  <div className="grid gap-3 md:grid-cols-4">
                    <Field label="Frequency">
                      <Select name="frequency" defaultValue={s.frequency}>
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </Select>
                    </Field>
                    <Field label="Time" hint="For hourly, only the minutes are used.">
                      <Input name="time" type="time" defaultValue={s.time} />
                    </Field>
                    <Field label="Day of month (monthly)">
                      <Input name="dayOfMonth" type="number" min={1} max={28} defaultValue={s.dayOfMonth ?? 1} />
                    </Field>
                    <Field label="Every N periods">
                      <Input name="interval" type="number" min={1} max={12} defaultValue={s.interval ?? 1} />
                    </Field>
                  </div>
                  <fieldset>
                    <legend className="mb-1 text-sm font-medium text-slate-700">Days (weekly)</legend>
                    <div className="flex flex-wrap gap-3">
                      {DAYS.map((d, i) => (
                        <Checkbox key={d} name="daysOfWeek" value={String(i)} defaultChecked={s.daysOfWeek?.includes(i)} label={d} />
                      ))}
                    </div>
                  </fieldset>
                  <TypeConfig type={type} c={c} keywords={kws.map((k) => ({ id: k.id, label: k.phrase }))} campaigns={campaigns.map((x) => ({ id: x.id, label: x.name }))} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Notify these emails" hint="Comma separated. Approval emails and failure alerts go here." className="md:col-span-2">
                      <Input name="notificationRecipients" defaultValue={rule.notificationRecipients.join(", ")} />
                    </Field>
                    <Field label="Retries after a failure">
                      <Input name="maxRetries" type="number" min={0} max={10} defaultValue={rule.maxRetries} />
                    </Field>
                  </div>
                  <Checkbox name="showTasksInDashboard" defaultChecked={rule.showTasksInDashboard} label="Show approval tasks in the dashboard" hint="Turn off to handle approvals only by email." />
                  {canEdit && <SubmitButton>Save settings</SubmitButton>}
                </form>
                <div className="mt-6">
                  <p className="mb-2 text-sm font-medium">Recent runs</p>
                  {runs.length === 0 ? (
                    <p className="text-sm text-slate-500">No runs yet.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {runs.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
                          <span>
                            <StatusBadge status={r.status} /> <span className="text-xs text-slate-500">{r.trigger} · {formatDateTime(r.startedAt ?? r.scheduledFor, timezone)}</span>
                          </span>
                          <span className="max-w-lg text-xs text-slate-600">{r.error ?? (r.summary ? Object.entries(r.summary).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : "")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Multi({ name, options, selected }: { name: string; options: { id: string; label: string }[]; selected: unknown }) {
  const sel = Array.isArray(selected) ? (selected as string[]) : [];
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => (
        <Checkbox key={o.id} name={name} value={o.id} defaultChecked={sel.includes(o.id)} label={o.label} />
      ))}
    </div>
  );
}

function TypeConfig({ type, c, keywords, campaigns }: { type: string; c: Record<string, unknown>; keywords: { id: string; label: string }[]; campaigns: { id: string; label: string }[] }) {
  const v = (k: string) => (c[k] == null ? "" : String(c[k]));
  switch (type) {
    case "posting":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Posts per week">
            <Input name="postsPerWeek" type="number" min={1} max={7} defaultValue={v("postsPerWeek")} />
          </Field>
          <Field label="Drafts kept ready" hint="How many upcoming posts to keep drafted.">
            <Input name="batchSize" type="number" min={1} max={12} defaultValue={v("batchSize")} />
          </Field>
          <Field label="Approval">
            <Select name="approvalMode" defaultValue={v("approvalMode")}>
              <option value="all">Every post needs approval</option>
              <option value="branded_or_ai">Only posts with branded or AI images</option>
              <option value="none">Publish without approval</option>
            </Select>
          </Field>
          <Field label="Images">
            <Select name="imageSource" defaultValue={v("imageSource")}>
              <option value="uploaded_only">My uploads only</option>
              <option value="uploaded_then_gbp">My uploads, then Google profile photos</option>
              <option value="allow_ai">Allow AI images (no provider configured)</option>
            </Select>
          </Field>
          <Field label="Image style">
            <Select name="imageMode" defaultValue={v("imageMode")}>
              <option value="raw">Photo as is</option>
              <option value="branded">Branded overlay</option>
            </Select>
          </Field>
          <Field label="Don't reuse an image for (days)">
            <Input name="imageReuseDays" type="number" min={0} max={365} defaultValue={v("imageReuseDays")} />
          </Field>
          <Field label="Button">
            <Select name="cta" defaultValue={v("cta")}>
              {["LEARN_MORE", "CALL", "BOOK", "ORDER", "SHOP", "SIGN_UP"].map((x) => (
                <option key={x} value={x}>
                  {x.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Overlay button text (branded only)">
            <Input name="customCtaText" maxLength={40} defaultValue={v("customCtaText")} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Publish to</p>
            <Multi name="destinations" selected={c.destinations} options={["google", "facebook", "instagram", "linkedin"].map((x) => ({ id: x, label: x }))} />
            <Checkbox name="holidayReferences" defaultChecked={Boolean(c.holidayReferences)} label="Mention upcoming holidays" />
          </div>
        </div>
      );
    case "review_replies":
    case "historical_reviews":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Sign-off" hint="e.g. “— Maria, Owner”">
            <Input name="signOff" maxLength={80} defaultValue={v("signOff")} />
          </Field>
          <Field label="Look back (days)" hint="For older unanswered reviews.">
            <Input name="historicalLookbackDays" type="number" min={1} max={730} defaultValue={v("historicalLookbackDays")} />
          </Field>
          <Field label="Older reviews per run">
            <Input name="historicalPerRun" type="number" min={1} max={25} defaultValue={v("historicalPerRun")} />
          </Field>
          <p className="text-xs text-slate-500 md:col-span-3">Per-star rules (which ratings publish automatically) are set on the Reviews page.</p>
        </div>
      );
    case "faq_generation":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="FAQs per run">
            <Input name="perRun" type="number" min={1} max={10} defaultValue={v("perRun")} />
          </Field>
          <Field label="Approval">
            <Select name="approvalMode" defaultValue={v("approvalMode")}>
              <option value="all">Approve each FAQ</option>
              <option value="none">Publish without approval</option>
            </Select>
          </Field>
        </div>
      );
    case "video_generation":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Format">
            <Select name="format" defaultValue={v("format")}>
              <option value="vertical">Vertical 9:16</option>
              <option value="horizontal">Horizontal 16:9</option>
            </Select>
          </Field>
          <Field label="Approval">
            <Select name="approvalMode" defaultValue={v("approvalMode")}>
              <option value="all">Approve each video</option>
              <option value="none">Publish without approval</option>
            </Select>
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Publish to</p>
            <Multi name="destinations" selected={c.destinations} options={["google", "youtube", "facebook", "instagram", "linkedin"].map((x) => ({ id: x, label: x }))} />
          </div>
        </div>
      );
    case "reporting":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Email the report to" hint="Comma separated.">
            <Input name="recipients" defaultValue={Array.isArray(c.recipients) ? (c.recipients as string[]).join(", ") : ""} />
          </Field>
          <Field label="Compare with">
            <Select name="comparisonPeriod" defaultValue={v("comparisonPeriod")}>
              <option value="previous_period">Previous month</option>
              <option value="previous_year">Same month last year</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <p className="mb-1 text-sm font-medium text-slate-700">Sections</p>
            <Multi name="includeSections" selected={c.includeSections} options={SECTIONS.map((x) => ({ id: x, label: x.replace("_", " ") }))} />
          </div>
        </div>
      );
    case "ai_visibility_audit":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Assistants to ask</p>
            <Multi name="providers" selected={c.providers} options={AI_SEARCH_PROVIDER_IDS.map((x) => ({ id: x, label: x }))} />
          </div>
          <Field label="Questions per keyword">
            <Input name="queriesPerKeyword" type="number" min={1} max={3} defaultValue={v("queriesPerKeyword")} />
          </Field>
        </div>
      );
    case "ranking_audit":
      return (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Keywords to audit</p>
          {keywords.length ? <Multi name="keywordIds" selected={c.keywordIds} options={keywords} /> : <p className="text-sm text-slate-500">Add keywords first. With none selected, every tracked keyword is audited.</p>}
        </div>
      );
    case "review_requests":
      return (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Campaigns to send</p>
          {campaigns.length ? <Multi name="campaignIds" selected={c.campaignIds} options={campaigns} /> : <p className="text-sm text-slate-500">No campaigns yet. With none selected, every active campaign sends.</p>}
        </div>
      );
    case "website_updates":
      return <Checkbox name="autoPublishFaqs" defaultChecked={Boolean(c.autoPublishFaqs)} label="Republish the website when approved FAQs or videos are added" />;
    default:
      return null;
  }
}
