import { notFound } from "next/navigation";
import { Alert, Badge, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, Stat, StatusBadge, Table, Tabs, Td, Textarea, formatDateTime } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { activityLog, getBranding, listClients, listMembers, orgOverview } from "@/server/services/agency";
import { listIntegrations } from "@/server/services/integrations";
import { domainInstructions, listDomains } from "@/server/services/websites";
import { OAUTH_PROVIDERS } from "@/server/integrations/oauth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { ROLES } from "@/server/db/schema";
import { settingsAction } from "./actions";

export const metadata = { title: "Settings" };

const TABS: { key: string; label: string; perm: Permission }[] = [
  { key: "org", label: "Organization", perm: "org.manage" },
  { key: "members", label: "Team", perm: "members.manage" },
  { key: "branding", label: "White label", perm: "org.manage" },
  { key: "domains", label: "App domain", perm: "org.manage" },
  { key: "integrations", label: "Connections", perm: "integrations.manage" },
  { key: "usage", label: "Usage & credits", perm: "org.manage" },
  { key: "activity", label: "Activity log", perm: "members.manage" },
];

const USAGE_LABELS: Record<string, string> = { ai_request: "AI requests", ranking_point: "Ranking grid points", ai_visibility_query: "AI visibility questions", video_render: "Video renders", report: "Reports", email: "Emails" };

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, can } = await orgPage();
  const tabs = TABS.filter((t) => can(t.perm));
  if (!tabs.length) notFound();
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;
  const back = `/settings?tab=${tab}`;
  const H = () => <input type="hidden" name="_back" value={back} />;

  let body: React.ReactNode = null;
  if (tab === "org") {
    const { org, businesses } = await orgOverview(actor);
    body = (
      <Card title="Organization">
        <form action={settingsAction} className="max-w-lg space-y-3">
          <H />
          <Field label="Name">
            <Input name="name" defaultValue={org.name} required maxLength={120} />
          </Field>
          <Field label="Type" hint="Agencies get client management, white label and client health.">
            <Select name="kind" defaultValue={org.kind}>
              <option value="business">Business</option>
              <option value="agency">Agency</option>
            </Select>
          </Field>
          <p className="text-sm text-slate-500">{businesses} active business{businesses === 1 ? "" : "es"}.</p>
          <SubmitButton name="op" value="org" size="sm">
            Save
          </SubmitButton>
        </form>
      </Card>
    );
  } else if (tab === "members") {
    const [{ members, invitations }, clients] = await Promise.all([listMembers(actor), listClients(actor)]);
    const ClientPicker = ({ selected }: { selected: string[] | null }) =>
      clients.length > 0 ? (
        <div className="space-y-0.5">
          <p className="text-xs text-slate-500">Limit to clients (required for client approvers)</p>
          {clients.map((c) => (
            <Checkbox key={c.id} name="clientIds" value={c.id} defaultChecked={selected?.includes(c.id)} label={c.name} />
          ))}
        </div>
      ) : null;
    body = (
      <div className="space-y-6">
        {sp.inviteUrl && (
          <Alert tone="green" title="Invitation link">
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all text-xs">{sp.inviteUrl}</code>
              <CopyButton value={sp.inviteUrl} />
            </div>
            <p className="mt-1 text-xs">The link was also emailed. It is shown only once and expires in 7 days.</p>
          </Alert>
        )}
        <Card title="Invite someone">
          <form action={settingsAction} className="grid gap-3 md:grid-cols-3">
            <H />
            <Field label="Email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="member">
                {ROLES.filter((r) => r !== "owner" || actor.role === "owner").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <ClientPicker selected={null} />
            <div className="md:col-span-3">
              <SubmitButton name="op" value="invite" size="sm">
                Send invitation
              </SubmitButton>
            </div>
          </form>
          <ul className="mt-4 grid gap-1 border-t border-slate-100 pt-3 text-xs text-slate-500 md:grid-cols-2">
            {ROLES.map((r) => (
              <li key={r}>
                <span className="font-medium text-slate-700">{ROLE_LABELS[r]}:</span> {ROLE_DESCRIPTIONS[r]}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Team" padded={false}>
          <Table head={["Person", "Role and access", "Last sign-in", ""]}>
            {members.map(({ m, u }) => (
              <tr key={m.id} className="align-top">
                <Td>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                  {m.status !== "active" && <StatusBadge status={m.status} />}
                </Td>
                <Td>
                  {u.id === actor.userId ? (
                    <span className="text-sm">{ROLE_LABELS[m.role]} (you)</span>
                  ) : (
                    <form action={settingsAction} className="space-y-2">
                      <H />
                      <input type="hidden" name="id" value={m.id} />
                      <Select name="role" defaultValue={m.role} aria-label="Role">
                        {ROLES.filter((r) => r !== "owner" || actor.role === "owner").map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                      <ClientPicker selected={m.clientIds} />
                      <SubmitButton name="op" value="member" size="sm" variant="secondary">
                        Save
                      </SubmitButton>
                    </form>
                  )}
                </Td>
                <Td className="text-xs">{formatDateTime(u.lastLoginAt)}</Td>
                <Td>
                  {u.id !== actor.userId && (
                    <form action={settingsAction}>
                      <H />
                      <input type="hidden" name="id" value={m.id} />
                      {m.status === "active" ? (
                        <SubmitButton name="op" value="deactivate" size="sm" variant="ghost" confirm={`Remove ${u.name}'s access?`}>
                          Deactivate
                        </SubmitButton>
                      ) : (
                        <SubmitButton name="op" value="reactivate" size="sm" variant="ghost">
                          Reactivate
                        </SubmitButton>
                      )}
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {invitations.length > 0 && (
          <Card title="Pending invitations" padded={false}>
            <Table head={["Email", "Role", "Expires", ""]}>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td>{ROLE_LABELS[i.role]}</Td>
                  <Td className="text-xs">{i.expiresAt < new Date() ? <StatusBadge status="expired" /> : formatDateTime(i.expiresAt)}</Td>
                  <Td>
                    <form action={settingsAction}>
                      <H />
                      <input type="hidden" name="id" value={i.id} />
                      <SubmitButton name="op" value="revoke-invite" size="sm" variant="ghost">
                        Revoke
                      </SubmitButton>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    );
  } else if (tab === "branding") {
    const b = await getBranding(actor.orgId);
    body = (
      <Card title="White label" description="Shown to clients in emails, approval pages, reports and connection invites.">
        <form action={settingsAction} className="grid gap-3 md:grid-cols-2">
          <H />
          <Field label="Brand name">
            <Input name="displayName" defaultValue={b?.displayName ?? ""} maxLength={80} />
          </Field>
          <Field label="Logo URL" hint="An https image URL.">
            <Input name="logoUrl" type="url" defaultValue={b?.logoUrl ?? ""} />
          </Field>
          <Field label="Main color">
            <Input name="primaryColor" type="color" defaultValue={b?.primaryColor ?? "#2563eb"} className="h-10 p-1" />
          </Field>
          <Field label="Second color">
            <Input name="secondaryColor" type="color" defaultValue={b?.secondaryColor ?? "#0f172a"} className="h-10 p-1" />
          </Field>
          <Field label="Support email">
            <Input name="supportEmail" type="email" defaultValue={b?.supportEmail ?? ""} />
          </Field>
          <Field label="Support page">
            <Input name="supportUrl" type="url" defaultValue={b?.supportUrl ?? ""} />
          </Field>
          <Field label="Email sender name">
            <Input name="senderName" defaultValue={b?.senderName ?? ""} maxLength={80} />
          </Field>
          <Field
            label="Email sender address"
            hint={
              b?.senderEmail ? (
                b.senderVerifiedAt ? (
                  <Badge tone="green">Verified {formatDateTime(b.senderVerifiedAt)}</Badge>
                ) : (
                  "Not verified. Emails use the platform sender until your domain passes SPF and DKIM with the mail provider."
                )
              ) : (
                "Leave empty to use the platform sender."
              )
            }
          >
            <Input name="senderEmail" type="email" defaultValue={b?.senderEmail ?? ""} />
          </Field>
          <Field label="Report footer" className="md:col-span-2">
            <Textarea name="reportFooter" rows={2} maxLength={300} defaultValue={b?.reportFooter ?? ""} />
          </Field>
          <div className="flex gap-2 md:col-span-2">
            <SubmitButton name="op" value="branding" size="sm">
              Save branding
            </SubmitButton>
            {b?.senderEmail && !b.senderVerifiedAt && (
              <SubmitButton name="op" value="sender-verified" size="sm" variant="secondary" confirm="Confirm SPF and DKIM pass for this domain with your mail provider.">
                I have verified the sending domain
              </SubmitButton>
            )}
          </div>
        </form>
      </Card>
    );
  } else if (tab === "domains") {
    const domains = (await listDomains(actor)).filter((d) => d.purpose === "app");
    body = (
      <Card title="Custom app domain" description="Lets clients reach the app at your own domain, such as app.youragency.com. TLS certificates are issued by your reverse proxy.">
        <div className="space-y-4">
          {domains.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{d.hostname}</span> <StatusBadge status={d.status} />
                {d.lastError && <span className="text-xs text-red-600">{d.lastError}</span>}
              </div>
              {d.status !== "active" && (
                <Table head={["Type", "Name", "Value"]}>
                  {domainInstructions(d).map((r) => (
                    <tr key={r.type}>
                      <Td>{r.type}</Td>
                      <Td className="break-all font-mono text-xs">{r.name}</Td>
                      <Td className="break-all font-mono text-xs">{r.value}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              <form action={settingsAction} className="mt-2 flex gap-2">
                <H />
                <input type="hidden" name="id" value={d.id} />
                <SubmitButton name="op" value="verify-domain" size="sm" variant="secondary">
                  Check DNS
                </SubmitButton>
                <SubmitButton name="op" value="remove-domain" size="sm" variant="ghost" confirm="Remove this domain?">
                  Remove
                </SubmitButton>
              </form>
            </div>
          ))}
          <form action={settingsAction} className="flex gap-2">
            <H />
            <Input name="hostname" placeholder="app.youragency.com" required />
            <SubmitButton name="op" value="add-domain" size="sm" variant="secondary">
              Add domain
            </SubmitButton>
          </form>
        </div>
      </Card>
    );
  } else if (tab === "integrations") {
    const rows = await listIntegrations(actor);
    body = (
      <Card
        title="Connected accounts"
        description="Link accounts to a business from that business's Integrations page."
        actions={
          <form action={settingsAction}>
            <H />
            <SubmitButton name="op" value="health" size="sm" variant="secondary" pendingText="Checking…">
              Check all
            </SubmitButton>
          </form>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No connected accounts" />
        ) : (
          <Table head={["Account", "Permissions granted", "Status", ""]}>
            {rows.map((c) => (
              <tr key={c.id} className="align-top">
                <Td>
                  <div className="font-medium">{c.externalAccountName}</div>
                  <div className="text-xs text-slate-500">
                    {OAUTH_PROVIDERS[c.provider].label} · connected {formatDateTime(c.createdAt)}
                  </div>
                </Td>
                <Td className="max-w-64 break-words text-xs text-slate-500">{c.scopes.join(", ")}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                  {c.lastError && <div className="mt-1 max-w-64 text-xs text-red-600">{c.lastError}</div>}
                  <div className="text-xs text-slate-500">Checked {formatDateTime(c.lastHealthCheckAt)}</div>
                </Td>
                <Td>
                  {c.status !== "revoked" && (
                    <form action={settingsAction}>
                      <H />
                      <input type="hidden" name="id" value={c.id} />
                      <SubmitButton name="op" value="disconnect" size="sm" variant="ghost" confirm="Disconnect this account? Publishing to its pages stops.">
                        Disconnect
                      </SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    );
  } else if (tab === "usage") {
    const { org, usage, credits } = await orgOverview(actor);
    const limits: Record<string, number | undefined> = { ai_request: org.limits.monthlyAiRequests, ranking_point: org.limits.monthlyRankingPoints, ai_visibility_query: org.limits.monthlyAiVisibilityQueries, video_render: org.limits.monthlyVideoRenders };
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(USAGE_LABELS).map(([k, label]) => (
            <Stat key={k} label={`${label} this month`} value={(usage[k as keyof typeof usage] ?? 0).toLocaleString()} hint={limits[k] != null ? `Limit ${limits[k]!.toLocaleString()}` : "No limit set"} />
          ))}
        </div>
        <Card title="Report credits" description="On-demand reports use credits. There is no billing integration yet, so owners adjust the balance by hand and every change is logged.">
          <p className="mb-3 text-2xl font-semibold">{credits}</p>
          <form action={settingsAction} className="flex flex-wrap items-end gap-2">
            <H />
            <Field label="Add or remove">
              <Input name="amount" type="number" step={1} required className="w-32" />
            </Field>
            <Field label="Note">
              <Input name="note" maxLength={200} />
            </Field>
            <SubmitButton name="op" value="credits" size="sm" variant="secondary">
              Adjust
            </SubmitButton>
          </form>
        </Card>
      </div>
    );
  } else if (tab === "activity") {
    const rows = await activityLog(actor, { limit: 200 });
    body = (
      <Card title="Activity log" description="The latest 200 events across the organization." padded={false}>
        <Table head={["When", "Who", "What", "Details"]}>
          {rows.map(({ e, userName }) => (
            <tr key={e.id} className="align-top">
              <Td className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</Td>
              <Td className="text-xs">{userName ?? (e.actorType === "approval_link" ? "Approval link" : e.actorType === "public" ? "Public visitor" : "System")}</Td>
              <Td className="text-sm">{e.action.replaceAll("_", " ").replace(".", ": ")}</Td>
              <Td className="max-w-md break-words font-mono text-xs text-slate-500">{e.detail ? JSON.stringify(e.detail).slice(0, 300) : ""}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      <Flash ok={sp.ok} err={sp.err} />
      <Tabs current={tab} items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/settings?tab=${t.key}` }))} />
      {body}
    </>
  );
}
