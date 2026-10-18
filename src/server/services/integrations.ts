import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  businessLocations,
  businessServices,
  connectionInvites,
  integrations,
  integrationTargets,
  type IntegrationProvider,
} from "../db/schema";
import { assertCan, requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { AppError, invalid, notFound } from "../errors";
import { encryptSecret, randomToken, sha256 } from "../security/crypto";
import { consumeOAuthState, exchangeCode, getAccessToken, markIntegration, OAUTH_PROVIDERS, revokeRemote, type IntegrationRow } from "../integrations/oauth";
import * as gbp from "../integrations/google/gbp";
import * as meta from "../integrations/social/meta";
import * as linkedin from "../integrations/social/linkedin";
import * as youtube from "../integrations/social/youtube";
import * as companycam from "../integrations/companycam";
import { ProviderAuthError } from "../integrations/http";
import { env } from "../env";
import { notifyOrgUsers } from "./notifications";
import { queueEmail } from "../email";
import { button, layout, paragraph } from "../email/templates";

export type DiscoveredTarget = { targetType: (typeof integrationTargets.$inferInsert)["targetType"]; externalId: string; externalName: string; detail?: Record<string, unknown> };

/** Handles the OAuth redirect: stores encrypted tokens and discovers publishable targets. */
export async function completeOAuth(provider: IntegrationProvider, code: string, state: string) {
  const st = await consumeOAuthState(state, provider);
  const tokens = await exchangeCode(provider, code, st.codeVerifier);
  let accessToken = tokens.access_token;
  let expiresIn = tokens.expires_in;
  let account: { id: string; name: string };

  switch (provider) {
    case "google":
    case "youtube": {
      const info = await gbp.getUserInfo(accessToken);
      account = { id: info.sub, name: info.email ?? info.name ?? info.sub };
      break;
    }
    case "facebook":
    case "instagram": {
      const ll = await meta.exchangeLongLivedToken(env().META_APP_ID ?? "", env().META_APP_SECRET ?? "", accessToken);
      accessToken = ll.access_token;
      expiresIn = ll.expires_in ?? 60 * 24 * 3600;
      const me = await meta.getMe(accessToken);
      account = { id: me.id, name: me.name };
      break;
    }
    case "linkedin":
      account = { id: `li-${sha256(accessToken).slice(0, 12)}`, name: "LinkedIn member" };
      break;
    case "companycam": {
      const u = await companycam.getCurrentUser(accessToken);
      account = { id: String(u.company_id ?? u.id), name: u.email_address ?? `CompanyCam ${u.id}` };
      break;
    }
  }

  let clientId: string | null = null;
  if (st.connectionInviteId) {
    const [inv] = await db.select().from(connectionInvites).where(eq(connectionInvites.id, st.connectionInviteId)).limit(1);
    clientId = inv?.clientId ?? null;
  }

  const values = {
    orgId: st.orgId,
    clientId,
    provider,
    externalAccountId: account.id,
    externalAccountName: account.name,
    scopes: (tokens.scope ?? OAUTH_PROVIDERS[provider].scopes.join(" ")).split(/[\s,]+/).filter(Boolean),
    accessTokenEnc: encryptSecret(accessToken),
    refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    status: "active" as const,
    lastError: null,
    lastHealthCheckAt: new Date(),
    lastSuccessAt: new Date(),
    connectedByUserId: st.userId,
    connectedVia: st.connectionInviteId ? ("client_invite" as const) : ("user" as const),
  };
  const [integration] = await db
    .insert(integrations)
    .values(values)
    .onConflictDoUpdate({
      target: [integrations.orgId, integrations.provider, integrations.externalAccountId],
      set: { ...values, refreshTokenEnc: values.refreshTokenEnc ?? sql`${integrations.refreshTokenEnc}`, updatedAt: new Date() },
    })
    .returning();

  if (st.connectionInviteId) {
    await db.update(connectionInvites).set({ usedAt: new Date(), outcome: "connected" }).where(eq(connectionInvites.id, st.connectionInviteId));
    await notifyOrgUsers(st.orgId, st.businessId, { type: "integration.connected", title: `${OAUTH_PROVIDERS[provider].label} connected by client`, body: `${account.name} authorized a connection.`, link: st.businessId ? `/b/${st.businessId}/integrations` : "/settings?tab=integrations" });
  }
  await logActivity({ orgId: st.orgId, businessId: st.businessId, actor: st.userId ? userActor(st.userId) : systemActor, action: "integration.connected", target: { type: "integration", id: integration.id }, detail: { provider, account: account.name } });
  return { integration, businessId: st.businessId, redirectTo: st.redirectTo, viaInvite: Boolean(st.connectionInviteId) };
}

/** Lists the pages/locations/channels an integration can publish to. */
export async function discoverTargets(integration: IntegrationRow): Promise<DiscoveredTarget[]> {
  const token = await getAccessToken(integration);
  switch (integration.provider) {
    case "google": {
      const accounts = await gbp.listAccounts(token);
      const out: DiscoveredTarget[] = [];
      for (const a of accounts) {
        const locs = await gbp.listLocations(token, a.name);
        for (const l of locs)
          out.push({
            targetType: "gbp_location",
            externalId: `${a.name}/${l.name}`,
            externalName: `${l.title}${l.storefrontAddress?.locality ? ` · ${l.storefrontAddress.locality}` : ""}`,
            detail: { accountName: a.name, accountLabel: a.accountName, locationName: l.name },
          });
      }
      return out;
    }
    case "facebook":
      return (await meta.listPages(token)).map((p) => ({ targetType: "facebook_page" as const, externalId: p.id, externalName: p.name }));
    case "instagram":
      return (await meta.listPages(token))
        .filter((p) => p.instagram_business_account)
        .map((p) => ({ targetType: "instagram_account" as const, externalId: p.instagram_business_account!.id, externalName: `@${p.instagram_business_account!.username ?? p.instagram_business_account!.id} (via ${p.name})`, detail: { pageId: p.id } }));
    case "linkedin":
      return (await linkedin.listAdminOrganizations(token)).map((o) => ({ targetType: "linkedin_organization" as const, externalId: o.urn, externalName: `Organization ${o.id}` }));
    case "youtube": {
      const ch = await youtube.getMyChannel(token);
      return ch ? [{ targetType: "youtube_channel", externalId: ch.id, externalName: ch.snippet.title }] : [];
    }
    case "companycam":
      return [{ targetType: "companycam_project_source", externalId: integration.externalAccountId, externalName: integration.externalAccountName ?? "CompanyCam photos" }];
  }
}

export async function listIntegrations(actor: Actor) {
  const rows = await db.select().from(integrations).where(eq(integrations.orgId, actor.orgId)).orderBy(desc(integrations.createdAt));
  // Client-scoped users only see connections their clients authorized.
  const visible = actor.clientIds === null ? rows : rows.filter((r) => r.clientId && actor.clientIds!.includes(r.clientId));
  return visible.map(({ accessTokenEnc: _a, refreshTokenEnc: _r, ...safe }) => safe);
}

export async function listTargets(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db
    .select({ target: integrationTargets, provider: integrations.provider, status: integrations.status, accountName: integrations.externalAccountName, lastError: integrations.lastError })
    .from(integrationTargets)
    .innerJoin(integrations, eq(integrations.id, integrationTargets.integrationId))
    .where(eq(integrationTargets.businessId, businessId));
}

async function requireIntegration(actor: Actor, integrationId: string) {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.orgId, actor.orgId))).limit(1);
  if (!row) throw notFound("Connection");
  return row;
}

export async function discoverForActor(actor: Actor, integrationId: string) {
  assertCan(actor, "integrations.manage");
  const integ = await requireIntegration(actor, integrationId);
  try {
    const targets = await discoverTargets(integ);
    await markIntegration(integ.id, "active", null);
    return targets;
  } catch (e) {
    if (e instanceof ProviderAuthError) await markIntegration(integ.id, "expired", e.message);
    throw e;
  }
}

/** Links a discovered target to a business. For Google, also imports profile data. */
export async function linkTarget(actor: Actor, businessId: string, integrationId: string, target: DiscoveredTarget) {
  const b = await requireBusiness(actor, businessId, "integrations.manage");
  const integ = await requireIntegration(actor, integrationId);
  const expectedProvider: Record<string, IntegrationProvider> = { gbp_location: "google", facebook_page: "facebook", instagram_account: "instagram", linkedin_organization: "linkedin", youtube_channel: "youtube", companycam_project_source: "companycam" };
  if (expectedProvider[target.targetType] !== integ.provider) throw invalid("That target does not belong to this connection");
  // Re-verify the target is actually reachable with this connection; never trust client-supplied ids.
  const available = await discoverTargets(integ);
  const match = available.find((t) => t.targetType === target.targetType && t.externalId === target.externalId);
  if (!match) throw invalid("That page or location is not available to this connection");
  const [row] = await db
    .insert(integrationTargets)
    .values({ businessId, integrationId, targetType: match.targetType, externalId: match.externalId, externalName: match.externalName, enabled: true })
    .onConflictDoUpdate({ target: [integrationTargets.businessId, integrationTargets.targetType, integrationTargets.externalId], set: { integrationId, externalName: match.externalName, enabled: true } })
    .returning();
  if (match.targetType === "gbp_location") {
    const accountName = match.externalId.split("/locations/")[0];
    const locationName = `locations/${match.externalId.split("/locations/")[1]}`;
    await db.update(businessLocations).set({ gbpAccountName: accountName, gbpLocationName: locationName, googleIntegrationId: integ.id, updatedAt: new Date() }).where(eq(businessLocations.id, b.id));
    await importGoogleProfile(b.id);
  }
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "integration.target_linked", target: { type: "integration_target", id: row.id }, detail: { targetType: match.targetType, name: match.externalName } });
  return row;
}

export async function unlinkTarget(actor: Actor, businessId: string, targetId: string) {
  await requireBusiness(actor, businessId, "integrations.manage");
  const [t] = await db.delete(integrationTargets).where(and(eq(integrationTargets.id, targetId), eq(integrationTargets.businessId, businessId))).returning();
  if (t?.targetType === "gbp_location") await db.update(businessLocations).set({ gbpAccountName: null, gbpLocationName: null, googleIntegrationId: null }).where(eq(businessLocations.id, businessId));
}

/** Pulls current profile data from Google into the business record. Profile data is what Google shows publicly. */
export async function importGoogleProfile(businessId: string) {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  if (!b?.gbpLocationName || !b.googleIntegrationId) throw invalid("Google Business Profile is not linked");
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, b.googleIntegrationId)).limit(1);
  const token = await getAccessToken(integ);
  const loc = await gbp.getLocation(token, b.gbpLocationName);
  const addr = loc.storefrontAddress;
  await db
    .update(businessLocations)
    .set({
      name: loc.title || b.name,
      website: loc.websiteUri ?? b.website,
      phone: loc.phoneNumbers?.primaryPhone ?? b.phone,
      primaryCategory: loc.categories?.primaryCategory?.displayName ?? b.primaryCategory,
      secondaryCategories: loc.categories?.additionalCategories?.map((c) => c.displayName) ?? b.secondaryCategories,
      description: loc.profile?.description ?? b.description,
      addressLine1: addr?.addressLines?.[0] ?? b.addressLine1,
      addressLine2: addr?.addressLines?.[1] ?? b.addressLine2,
      city: addr?.locality ?? b.city,
      region: addr?.administrativeArea ?? b.region,
      postalCode: addr?.postalCode ?? b.postalCode,
      country: addr?.regionCode ?? b.country,
      latitude: loc.latlng?.latitude ?? b.latitude,
      longitude: loc.latlng?.longitude ?? b.longitude,
      isServiceAreaBusiness: loc.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY" || (!addr && Boolean(loc.serviceArea)),
      hideAddress: !addr,
      serviceArea: loc.serviceArea?.places?.placeInfos ? { places: loc.serviceArea.places.placeInfos.map((p) => p.placeName) } : b.serviceArea,
      hours: Object.keys(gbp.toWeeklyHours(loc)).length ? gbp.toWeeklyHours(loc) : b.hours,
      googleReviewUrl: loc.metadata?.newReviewUri ?? b.googleReviewUrl,
      googlePlaceId: loc.metadata?.placeId ?? b.googlePlaceId,
      updatedAt: new Date(),
    })
    .where(eq(businessLocations.id, businessId));
  try {
    const attrs = await gbp.getAttributes(token, b.gbpLocationName);
    const meta_ = await gbp.listAvailableAttributes(token, b.gbpLocationName);
    const { businessAttributes } = await import("../db/schema");
    for (const m of meta_.filter((x) => !x.deprecated && x.valueType === "BOOL").slice(0, 60)) {
      const current = attrs.find((a) => a.name.endsWith(m.parent.replace("attributes/", "")));
      const has = current?.values?.[0] === true;
      await db
        .insert(businessAttributes)
        .values({ businessId, attributeKey: m.parent, displayName: m.displayName, groupName: m.groupDisplayName ?? null, value: has ? true : null, status: has ? "current" : "suggested", source: "gbp" })
        .onConflictDoNothing();
    }
  } catch (e) {
    await logActivity({ orgId: b.orgId, businessId, actor: systemActor, action: "gbp.attributes_unavailable", detail: { error: (e as Error).message } });
  }
  await logActivity({ orgId: b.orgId, businessId, actor: systemActor, action: "gbp.profile_imported" });
}

export async function disconnectIntegration(actor: Actor, integrationId: string) {
  assertCan(actor, "integrations.manage");
  const integ = await requireIntegration(actor, integrationId);
  await revokeRemote(integ);
  await db.update(integrations).set({ status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, updatedAt: new Date() }).where(eq(integrations.id, integ.id));
  await db.update(integrationTargets).set({ enabled: false }).where(eq(integrationTargets.integrationId, integ.id));
  await db.update(businessLocations).set({ googleIntegrationId: null }).where(eq(businessLocations.googleIntegrationId, integ.id));
  await logActivity({ orgId: actor.orgId, actor: userActor(actor.userId), action: "integration.disconnected", target: { type: "integration", id: integ.id }, detail: { provider: integ.provider } });
}

export async function healthCheck(integration: IntegrationRow): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getAccessToken(integration);
    switch (integration.provider) {
      case "google":
        await gbp.listAccounts(token);
        break;
      case "youtube":
        await youtube.getMyChannel(token);
        break;
      case "facebook":
      case "instagram":
        await meta.getMe(token);
        break;
      case "linkedin":
        await linkedin.listAdminOrganizations(token);
        break;
      case "companycam":
        await companycam.getCurrentUser(token);
        break;
    }
    await db.update(integrations).set({ status: "active", lastError: null, lastHealthCheckAt: new Date(), lastSuccessAt: new Date() }).where(eq(integrations.id, integration.id));
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    const status = e instanceof ProviderAuthError ? "expired" : "error";
    const wasActive = integration.status === "active";
    await markIntegration(integration.id, status, err.message);
    if (wasActive) {
      await notifyOrgUsers(integration.orgId, null, {
        type: "integration.unhealthy",
        title: `${OAUTH_PROVIDERS[integration.provider].label} needs attention`,
        body: `${integration.externalAccountName ?? "A connected account"}: ${err.message}. Reconnect it to resume publishing.`,
        link: "/settings?tab=integrations",
      });
    }
    return { ok: false, error: err.message };
  }
}

export async function runHealthChecksForOrg(orgId: string) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), sql`${integrations.status} <> 'revoked'`));
  const results = [];
  for (const r of rows) results.push({ id: r.id, provider: r.provider, ...(await healthCheck(r)) });
  return results;
}

/* ---------------- Client connection invites ---------------- */

export const CONNECTION_INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export async function createConnectionInvite(actor: Actor, input: { provider: IntegrationProvider; businessId: string; recipientEmail?: string | null }) {
  const b = await requireBusiness(actor, input.businessId, "integrations.manage");
  const token = randomToken(32);
  const [inv] = await db
    .insert(connectionInvites)
    .values({ orgId: actor.orgId, clientId: b.clientId, businessId: b.id, provider: input.provider, tokenHash: sha256(token), recipientEmail: input.recipientEmail ?? null, expiresAt: new Date(Date.now() + CONNECTION_INVITE_TTL_MS), createdByUserId: actor.userId })
    .returning();
  const url = `${env().APP_URL.replace(/\/$/, "")}/connect/${token}`;
  if (input.recipientEmail) {
    const { organizationBranding } = await import("../db/schema");
    const [brand] = await db.select().from(organizationBranding).where(eq(organizationBranding.orgId, actor.orgId)).limit(1);
    const bi = { name: brand?.displayName ?? actor.orgName, color: brand?.primaryColor ?? "#2563eb", logoUrl: brand?.logoUrl };
    await queueEmail({
      orgId: actor.orgId,
      to: input.recipientEmail,
      subject: `${bi.name} is requesting access to your ${OAUTH_PROVIDERS[input.provider].label}`,
      html: layout(bi, `Connect ${OAUTH_PROVIDERS[input.provider].label}`, paragraph(`${bi.name} would like to publish on behalf of ${b.name}. You sign in with ${OAUTH_PROVIDERS[input.provider].label} directly; your password is never shared.`) + button(url, "Review and connect", bi.color) + paragraph("This link expires in 7 days.")),
      text: `Connect ${OAUTH_PROVIDERS[input.provider].label} for ${b.name}: ${url}`,
      template: "connection_invite",
      related: { type: "connection_invite", id: inv.id },
    });
  }
  await logActivity({ orgId: actor.orgId, businessId: b.id, actor: userActor(actor.userId), action: "connection_invite.created", target: { type: "connection_invite", id: inv.id }, detail: { provider: input.provider } });
  return { invite: inv, url };
}

export async function lookupConnectionInvite(token: string) {
  const [inv] = await db.select().from(connectionInvites).where(eq(connectionInvites.tokenHash, sha256(token))).limit(1);
  if (!inv) return { state: "invalid" as const };
  if (inv.revokedAt) return { state: "revoked" as const };
  if (inv.usedAt) return { state: "used" as const };
  if (inv.expiresAt < new Date()) return { state: "expired" as const };
  const [b] = inv.businessId ? await db.select().from(businessLocations).where(eq(businessLocations.id, inv.businessId)).limit(1) : [null];
  return { state: "valid" as const, invite: inv, businessName: b?.name ?? null };
}

export async function listConnectionInvites(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(connectionInvites).where(eq(connectionInvites.businessId, businessId)).orderBy(desc(connectionInvites.createdAt)).limit(20);
}

export async function revokeConnectionInvite(actor: Actor, inviteId: string) {
  assertCan(actor, "integrations.manage");
  await db.update(connectionInvites).set({ revokedAt: new Date() }).where(and(eq(connectionInvites.id, inviteId), eq(connectionInvites.orgId, actor.orgId), isNull(connectionInvites.usedAt)));
}

/* ---------------- Google write-back jobs ---------------- */

export async function googleContext(businessId: string) {
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  if (!b) throw notFound("Business");
  if (!b.gbpLocationName || !b.gbpAccountName || !b.googleIntegrationId) throw new AppError("Google Business Profile is not connected for this business", "not_configured");
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, b.googleIntegrationId)).limit(1);
  if (!integ) throw new AppError("Google connection was removed", "not_configured");
  const token = await getAccessToken(integ);
  return { business: b, integration: integ, token, locationName: b.gbpLocationName, v4Name: gbp.v4Location(b.gbpAccountName, b.gbpLocationName) };
}

/** Writes one recorded profile change to Google, then reads it back to verify. */
export async function pushProfileChange(changeId: string) {
  const { profileChanges } = await import("../db/schema");
  const [change] = await db.select().from(profileChanges).where(eq(profileChanges.id, changeId)).limit(1);
  if (!change || !["pending", "failed"].includes(change.syncStatus)) return { skipped: true };
  const g = await googleContext(change.businessId);
  const value = change.after as unknown;
  const patches: Record<string, { patch: Partial<gbp.GbpLocation>; mask: string[] }> = {
    name: { patch: { title: String(value ?? "") }, mask: ["title"] },
    description: { patch: { profile: { description: String(value ?? "") } }, mask: ["profile.description"] },
    phone: { patch: { phoneNumbers: { primaryPhone: String(value ?? "") } }, mask: ["phoneNumbers.primaryPhone"] },
    website: { patch: { websiteUri: String(value ?? "") }, mask: ["websiteUri"] },
    hours: { patch: { regularHours: gbp.fromWeeklyHours((value ?? {}) as Record<string, { open: string; close: string }[]>) as gbp.GbpLocation["regularHours"] }, mask: ["regularHours"] },
  };
  const p = patches[change.field];
  if (!p) {
    await db.update(profileChanges).set({ syncStatus: "unsupported", syncError: `Syncing ${change.field} is not supported through the API` }).where(eq(profileChanges.id, changeId));
    return { unsupported: true };
  }
  try {
    await gbp.updateLocation(g.token, g.locationName, p.patch, p.mask);
    const after = await gbp.getLocation(g.token, g.locationName);
    const verified =
      change.field === "description" ? after.profile?.description === String(value) : change.field === "website" ? after.websiteUri === String(value) : change.field === "name" ? after.title === String(value) : change.field === "phone" ? after.phoneNumbers?.primaryPhone === String(value) : true;
    await db.update(profileChanges).set({ syncStatus: verified ? "verified" : "synced", syncedAt: new Date(), syncError: verified ? null : "Google accepted the update but returned a different value; it may be under review" }).where(eq(profileChanges.id, changeId));
    return { synced: true, verified };
  } catch (e) {
    await db.update(profileChanges).set({ syncStatus: "failed", syncError: (e as Error).message }).where(eq(profileChanges.id, changeId));
    throw e;
  }
}

/**
 * Google's Business Information API manages services through the location's
 * serviceItems field, which only some categories support. Unsupported
 * locations are marked rather than silently ignored.
 */
export async function pushServices(businessId: string) {
  const g = await googleContext(businessId);
  const svcs = await db.select().from(businessServices).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
  const loc = await gbp.getLocation(g.token, g.locationName);
  if (loc.metadata && loc.metadata.canModifyServiceList === false) {
    await db.update(businessServices).set({ syncStatus: "unsupported", lastError: "Google does not allow editing services for this location's category" }).where(eq(businessServices.businessId, businessId));
    return { unsupported: true };
  }
  const serviceItems = svcs.map((s) => ({ freeFormServiceItem: { category: loc.categories?.primaryCategory?.name, label: { displayName: s.name, description: s.description ?? undefined, languageCode: "en" } } }));
  try {
    await gbp.updateLocation(g.token, g.locationName, { serviceItems } as unknown as Partial<gbp.GbpLocation>, ["serviceItems"]);
    await db.update(businessServices).set({ syncStatus: "synced", lastSyncedAt: new Date(), lastError: null }).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
    return { synced: svcs.length };
  } catch (e) {
    await db.update(businessServices).set({ syncStatus: "failed", lastError: (e as Error).message }).where(and(eq(businessServices.businessId, businessId), eq(businessServices.status, "active")));
    throw e;
  }
}

export async function pushAttributes(businessId: string) {
  const g = await googleContext(businessId);
  const { businessAttributes } = await import("../db/schema");
  const rows = await db.select().from(businessAttributes).where(and(eq(businessAttributes.businessId, businessId), eq(businessAttributes.status, "confirmed"), eq(businessAttributes.syncStatus, "pending")));
  if (!rows.length) return { synced: 0 };
  try {
    await gbp.updateAttributes(g.token, g.locationName, rows.map((r) => ({ name: r.attributeKey, valueType: "BOOL", values: [Boolean(r.value)] })));
    for (const r of rows) await db.update(businessAttributes).set({ syncStatus: "synced", lastError: null }).where(eq(businessAttributes.id, r.id));
    return { synced: rows.length };
  } catch (e) {
    for (const r of rows) await db.update(businessAttributes).set({ syncStatus: "failed", lastError: (e as Error).message }).where(eq(businessAttributes.id, r.id));
    throw e;
  }
}
