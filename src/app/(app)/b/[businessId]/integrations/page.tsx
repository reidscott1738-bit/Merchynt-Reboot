import Link from "next/link";
import { Alert, Badge, Card, Field, Flash, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { discoverForActor, listConnectionInvites, listIntegrations, listTargets, type DiscoveredTarget } from "@/server/services/integrations";
import { isProviderConfigured, OAUTH_PROVIDERS } from "@/server/integrations/oauth";
import { INTEGRATION_PROVIDERS } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { integrationAction } from "./actions";

export const metadata = { title: "Integrations" };

const TARGET_LABEL: Record<string, string> = { gbp_location: "Google Business Profile", facebook_page: "Facebook Page", instagram_account: "Instagram account", linkedin_organization: "LinkedIn Page", youtube_channel: "YouTube channel", companycam_project_source: "CompanyCam" };

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const manage = can("integrations.manage");
  const base = `/b/${businessId}/integrations`;
  const [connections, targets, invites] = await Promise.all([listIntegrations(actor), listTargets(actor, businessId), manage ? listConnectionInvites(actor, businessId) : Promise.resolve([])]);

  let discovered: { integrationId: string; targets: DiscoveredTarget[]; error?: string } | null = null;
  if (sp.discover && manage) {
    try {
      discovered = { integrationId: sp.discover, targets: await discoverForActor(actor, sp.discover) };
    } catch (e) {
      discovered = { integrationId: sp.discover, targets: [], error: e instanceof AppError ? e.message : "The provider could not be reached. Try again, or reconnect the account." };
    }
  }
  const linkedKeys = new Set(targets.map((t) => `${t.target.targetType}|${t.target.externalId}`));
  const hidden = () => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={base} />
    </>
  );

  return (
    <>
      <PageHeader title="Integrations" description="Connect accounts with the provider's own sign-in. Tokens are encrypted on the server and never sent to the browser. Only the permissions needed to publish are requested." />
      <Flash ok={sp.ok} err={sp.err} />
      {sp.inviteUrl && (
        <div className="mb-4">
          <Alert tone="green" title="Connection invite link">
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="break-all text-xs">{sp.inviteUrl}</code>
              <CopyButton value={sp.inviteUrl} />
            </div>
            <p className="mt-1 text-xs">Shown once. It expires in 7 days and can be used one time.</p>
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="Linked to this business" padded={false}>
          <Table head={["Destination", "Account", "Connection", ""]} empty={targets.length === 0 ? "Nothing linked yet. Connect an account below, then choose the page or location for this business." : undefined}>
            {targets.map(({ target: t, provider, status, accountName, lastError }) => (
              <tr key={t.id}>
                <Td>
                  <div className="font-medium">{t.externalName ?? t.externalId}</div>
                  <div className="text-xs text-slate-500">{TARGET_LABEL[t.targetType]}</div>
                </Td>
                <Td className="text-xs">
                  {OAUTH_PROVIDERS[provider].label}: {accountName}
                </Td>
                <Td>
                  <StatusBadge status={t.enabled ? status : "disabled"} />
                  {lastError && <div className="mt-1 max-w-64 text-xs text-red-600">{lastError}</div>}
                </Td>
                <Td>
                  {manage && (
                    <form action={integrationAction}>
                      {hidden()}
                      <input type="hidden" name="targetId" value={t.id} />
                      <SubmitButton name="op" value="unlink" size="sm" variant="ghost" confirm="Stop publishing to this destination?">
                        Unlink
                      </SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        {discovered && (
          <Card title="Choose what to link">
            {discovered.error ? (
              <Alert tone="red">{discovered.error}</Alert>
            ) : discovered.targets.length === 0 ? (
              <p className="text-sm text-slate-500">This account has no pages, locations or channels you can manage.</p>
            ) : (
              <Table head={["Name", "Type", ""]}>
                {discovered.targets.map((t) => (
                  <tr key={`${t.targetType}|${t.externalId}`}>
                    <Td>{t.externalName}</Td>
                    <Td className="text-xs">{TARGET_LABEL[t.targetType]}</Td>
                    <Td>
                      {linkedKeys.has(`${t.targetType}|${t.externalId}`) ? (
                        <Badge tone="green">Linked</Badge>
                      ) : (
                        <form action={integrationAction}>
                          {hidden()}
                          <input type="hidden" name="integrationId" value={discovered.integrationId} />
                          <input type="hidden" name="targetType" value={t.targetType} />
                          <input type="hidden" name="externalId" value={t.externalId} />
                          <input type="hidden" name="externalName" value={t.externalName} />
                          <SubmitButton name="op" value="link" size="sm" pendingText="Linking…">
                            Link to this business
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

        <Card title="Connected accounts" description="Accounts are shared across the organization. Disconnect them in organization settings.">
          {connections.length > 0 && (
            <Table head={["Account", "Status", "Last checked", ""]}>
              {connections.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <div className="font-medium">{c.externalAccountName}</div>
                    <div className="text-xs text-slate-500">
                      {OAUTH_PROVIDERS[c.provider].label}
                      {c.connectedVia === "client_invite" && " · connected by client"}
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                    {c.lastError && <div className="mt-1 max-w-64 text-xs text-red-600">{c.lastError}</div>}
                  </Td>
                  <Td className="text-xs">{formatDateTime(c.lastHealthCheckAt)}</Td>
                  <Td>
                    {manage && c.status === "active" && (
                      <Link href={`${base}?discover=${c.id}`} className="text-sm text-blue-700 underline">
                        Choose pages
                      </Link>
                    )}
                    {manage && c.status !== "active" && c.status !== "revoked" && isProviderConfigured(c.provider) && (
                      <a href={`/api/oauth/${c.provider}/start?businessId=${businessId}&redirect=${encodeURIComponent(base)}`} className="text-sm text-blue-700 underline">
                        Reconnect
                      </a>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {manage && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATION_PROVIDERS.map((p) => {
                const cfg = OAUTH_PROVIDERS[p];
                const ready = isProviderConfigured(p);
                return (
                  <div key={p} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="font-medium">{cfg.label}</div>
                    <p className="mt-1 text-xs text-slate-500">Permissions: {cfg.scopes.filter((s) => !["openid", "email", "profile"].includes(s)).map((s) => s.replace("https://www.googleapis.com/auth/", "")).join(", ")}</p>
                    {ready ? (
                      <LinkButton href={`/api/oauth/${p}/start?businessId=${businessId}&redirect=${encodeURIComponent(base)}`} size="sm" className="mt-2" prefetch={false}>
                        Connect
                      </LinkButton>
                    ) : (
                      <p className="mt-2 text-xs text-amber-700">
                        Not available: the server needs {cfg.envVars.join(" and ")}. <a href={cfg.docsUrl} target="_blank" rel="noreferrer" className="underline">Provider docs</a>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {manage && (
          <Card title="Ask the business owner to connect" description="Sends a secure, single-use link. The owner signs in with the provider directly; you never see their password.">
            <form action={integrationAction} className="flex flex-wrap items-end gap-2">
              {hidden()}
              <Field label="Account">
                <Select name="provider">
                  {INTEGRATION_PROVIDERS.filter((p) => isProviderConfigured(p)).map((p) => (
                    <option key={p} value={p}>
                      {OAUTH_PROVIDERS[p].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Owner's email (optional)">
                <Input name="recipientEmail" type="email" placeholder="owner@example.com" />
              </Field>
              <SubmitButton name="op" value="invite" size="sm" variant="secondary" disabled={!INTEGRATION_PROVIDERS.some((p) => isProviderConfigured(p))}>
                Create invite
              </SubmitButton>
            </form>
            {invites.length > 0 && (
              <div className="mt-4">
                <Table head={["Account", "Sent to", "Status", ""]}>
                  {invites.map((i) => {
                    const state = i.usedAt ? "used" : i.revokedAt ? "revoked" : i.expiresAt < new Date() ? "expired" : "pending";
                    return (
                      <tr key={i.id}>
                        <Td>{OAUTH_PROVIDERS[i.provider].label}</Td>
                        <Td className="text-xs">{i.recipientEmail ?? "Link only"}</Td>
                        <Td>
                          <StatusBadge status={state} />
                        </Td>
                        <Td>
                          {state === "pending" && (
                            <form action={integrationAction}>
                              {hidden()}
                              <input type="hidden" name="inviteId" value={i.id} />
                              <SubmitButton name="op" value="revoke-invite" size="sm" variant="ghost">
                                Revoke
                              </SubmitButton>
                            </form>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
