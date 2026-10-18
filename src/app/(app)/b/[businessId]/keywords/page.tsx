import Link from "next/link";
import { Alert, Badge, Card, Checkbox, DemoBadge, EmptyState, Field, Flash, Input, PageHeader, Select, formatDate } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { currentConfig, listKeywords, suggestKeywords } from "@/server/services/rankings";
import { rankingProviderStatus } from "@/server/integrations/ranking";
import { keywordAction } from "../rankings/actions";

export const metadata = { title: "Keywords" };

const INTENTS = ["discovery", "comparison", "branded", "transactional", "informational"];

export default async function KeywordsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const rows = await listKeywords(actor, businessId);
  const configs = await Promise.all(rows.map((k) => currentConfig(k.id)));
  const suggestions = sp.suggest ? await suggestKeywords(actor, businessId) : [];
  const provider = rankingProviderStatus();
  const back = `/b/${businessId}/keywords`;
  const run = can("audits.run");
  const H = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
    </>
  );
  return (
    <>
      <PageHeader
        title="Keywords"
        description="Searches you want to be found for. Each keyword has its own audit area; changing it creates a new settings version so old and new results are never mixed."
        actions={
          run && (
            <form action={keywordAction} className="flex gap-2">
              <H />
              <SubmitButton name="op" value="suggest" variant="secondary">
                Suggest keywords
              </SubmitButton>
              <SubmitButton name="op" value="demand" variant="secondary">
                Refresh search volume
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 space-y-2">
        {!provider.configured && <Alert tone="yellow" title="No ranking data provider">Ranking audits need DataForSEO credentials (DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD). Search volume is not shown without a provider.</Alert>}
        {provider.isDemo && <Alert tone="blue">Ranking audits use the demo provider. Results are synthetic and labeled as demo data.</Alert>}
        {(business.latitude == null || business.longitude == null) && (
          <Alert tone="yellow">
            Add map coordinates under{" "}
            <Link href={`/b/${businessId}/profile`} className="underline">
              Business Profile
            </Link>{" "}
            to set the default audit center.
          </Alert>
        )}
      </div>
      {suggestions.length > 0 && (
        <Card title="Suggestions" description="Built from your categories, services and city. Volume is not estimated here." className="mb-6">
          <ul className="divide-y divide-slate-100 text-sm">
            {suggestions.map((s) => (
              <li key={s.phrase} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{s.phrase}</span> <span className="text-xs text-slate-500">{s.reason}</span>
                </span>
                <form action={keywordAction}>
                  <H />
                  <input type="hidden" name="phrase" value={s.phrase} />
                  <input type="hidden" name="intent" value={s.intent} />
                  <input type="hidden" name="source" value="suggested" />
                  <SubmitButton name="op" value="add" size="sm" variant="secondary">
                    Add
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No keywords yet">Add a keyword below or ask for suggestions.</EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.map((k, i) => {
            const cfg = configs[i];
            const st = k.latestAudit?.stats as { averageRank?: number | null; top3Share?: number | null } | null | undefined;
            return (
              <Card key={k.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {k.phrase} {k.city && <span className="text-slate-500">· {k.city}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge>{k.intent}</Badge> priority {k.priority} {!k.isTracked && <Badge tone="gray">not tracked</Badge>}
                      {k.demandEstimate != null ? <span>~{k.demandEstimate.toLocaleString()} searches/month ({k.demandSource}, {formatDate(k.demandAsOf)})</span> : <span>Volume unknown</span>}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {k.latestAudit ? (
                      <Link href={`/b/${businessId}/rankings/${k.latestAudit.id}`} className="text-blue-800 hover:underline">
                        Avg rank {st?.averageRank ?? "—"} · top 3 in {st?.top3Share != null ? `${Math.round(st.top3Share * 100)}%` : "—"} of points
                      </Link>
                    ) : (
                      <span className="text-slate-500">Not audited yet</span>
                    )}
                    {k.latestAudit && (
                      <div>
                        <DemoBadge show={k.latestAudit.isDemo} />
                      </div>
                    )}
                  </div>
                </div>
                {run && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-blue-800">Audit settings{cfg ? ` (version ${cfg.version})` : ""}</summary>
                    <form action={keywordAction} className="mt-3 grid gap-3 md:grid-cols-6">
                      <H />
                      <input type="hidden" name="id" value={k.id} />
                      <Field label="Center latitude">
                        <Input name="centerLat" type="number" step="any" required defaultValue={cfg?.centerLat ?? business.latitude ?? ""} />
                      </Field>
                      <Field label="Center longitude">
                        <Input name="centerLng" type="number" step="any" required defaultValue={cfg?.centerLng ?? business.longitude ?? ""} />
                      </Field>
                      <Field label="Radius (km)">
                        <Input name="radiusKm" type="number" step="0.5" min={0.5} max={50} defaultValue={cfg?.radiusKm ?? 5} />
                      </Field>
                      <Field label="Grid">
                        <Select name="gridSize" defaultValue={String(cfg?.gridSize ?? 7)}>
                          {[3, 5, 7, 9, 11, 13, 15].map((n) => (
                            <option key={n} value={n}>
                              {n}×{n} ({n * n} points)
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Device">
                        <Select name="device" defaultValue={cfg?.device ?? "mobile"}>
                          <option value="mobile">Mobile</option>
                          <option value="desktop">Desktop</option>
                        </Select>
                      </Field>
                      <Field label="Language">
                        <Input name="language" defaultValue={cfg?.language ?? "en"} />
                      </Field>
                      <Field label="Why the change (optional)" className="md:col-span-4">
                        <Input name="changeNote" maxLength={200} />
                      </Field>
                      <div className="flex items-end gap-2 md:col-span-2">
                        <SubmitButton name="op" value="config" size="sm" variant="secondary">
                          Save settings
                        </SubmitButton>
                        <SubmitButton name="op" value="audit" size="sm" disabled={!provider.configured}>
                          Run audit
                        </SubmitButton>
                      </div>
                    </form>
                    <form action={keywordAction} className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                      <H />
                      <input type="hidden" name="id" value={k.id} />
                      <Field label="Priority">
                        <Input name="priority" type="number" min={1} max={5} defaultValue={k.priority} className="w-20" />
                      </Field>
                      <Field label="Intent">
                        <Select name="intent" defaultValue={k.intent}>
                          {INTENTS.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </Select>
                      </Field>
                      <Checkbox name="isTracked" defaultChecked={k.isTracked} label="Include in scheduled audits" />
                      <SubmitButton name="op" value="update" size="sm" variant="secondary">
                        Save
                      </SubmitButton>
                      <SubmitButton name="op" value="archive" size="sm" variant="ghost" confirm="Archive this keyword? Its audit history is kept.">
                        Archive
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {run && (
        <Card title="Add a keyword" className="mt-6">
          <form action={keywordAction} className="grid gap-3 md:grid-cols-5 md:items-end">
            <H />
            <Field label="Keyword" className="md:col-span-2">
              <Input name="phrase" required minLength={2} placeholder="emergency plumber" />
            </Field>
            <Field label="City (optional)">
              <Input name="city" />
            </Field>
            <Field label="Intent">
              <Select name="intent" defaultValue="discovery">
                {INTENTS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <SubmitButton name="op" value="add">
              Add keyword
            </SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
