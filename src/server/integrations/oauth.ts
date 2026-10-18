import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { integrations, oauthStates, type IntegrationProvider } from "../db/schema";
import { env } from "../env";
import { decryptSecret, encryptSecret, randomToken } from "../security/crypto";
import { httpJson, ProviderAuthError } from "./http";
import { AppError, notConfigured } from "../errors";

type ProviderConfig = {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  pkce: boolean;
  extraAuthParams?: Record<string, string>;
  envVars: string[];
  docsUrl: string;
};

export const OAUTH_PROVIDERS: Record<IntegrationProvider, ProviderConfig> = {
  google: {
    label: "Google Business Profile",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/business.manage"],
    clientId: () => env().GOOGLE_CLIENT_ID,
    clientSecret: () => env().GOOGLE_CLIENT_SECRET,
    pkce: true,
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/my-business/content/prereqs",
  },
  youtube: {
    label: "YouTube",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    clientId: () => env().GOOGLE_CLIENT_ID,
    clientSecret: () => env().GOOGLE_CLIENT_SECRET,
    pkce: true,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
  },
  facebook: {
    label: "Facebook Pages",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    clientId: () => env().META_APP_ID,
    clientSecret: () => env().META_APP_SECRET,
    pkce: false,
    envVars: ["META_APP_ID", "META_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
  },
  instagram: {
    label: "Instagram (business accounts via Facebook)",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "instagram_basic", "instagram_content_publish", "business_management"],
    clientId: () => env().META_APP_ID,
    clientSecret: () => env().META_APP_SECRET,
    pkce: false,
    envVars: ["META_APP_ID", "META_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  },
  linkedin: {
    label: "LinkedIn Pages",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["w_organization_social", "r_organization_social", "rw_organization_admin"],
    clientId: () => env().LINKEDIN_CLIENT_ID,
    clientSecret: () => env().LINKEDIN_CLIENT_SECRET,
    pkce: false,
    envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
  },
  companycam: {
    label: "CompanyCam",
    authorizeUrl: "https://app.companycam.com/oauth/authorize",
    tokenUrl: "https://app.companycam.com/oauth/token",
    scopes: ["read"],
    clientId: () => env().COMPANYCAM_CLIENT_ID,
    clientSecret: () => env().COMPANYCAM_CLIENT_SECRET,
    pkce: false,
    envVars: ["COMPANYCAM_CLIENT_ID", "COMPANYCAM_CLIENT_SECRET"],
    docsUrl: "https://docs.companycam.com/docs/authentication",
  },
};

export function isProviderConfigured(p: IntegrationProvider) {
  const c = OAUTH_PROVIDERS[p];
  return Boolean(c.clientId() && c.clientSecret());
}

export function redirectUri(provider: IntegrationProvider) {
  return `${env().APP_URL.replace(/\/$/, "")}/api/oauth/${provider}/callback`;
}

export async function beginOAuth(input: { provider: IntegrationProvider; orgId: string; userId: string | null; businessId?: string | null; connectionInviteId?: string | null; redirectTo?: string }) {
  const cfg = OAUTH_PROVIDERS[input.provider];
  const clientId = cfg.clientId();
  if (!clientId || !cfg.clientSecret()) throw notConfigured(`${cfg.label} is not configured on this server. Set ${cfg.envVars.join(" and ")}.`);
  const state = randomToken(24);
  const verifier = cfg.pkce ? randomToken(48) : null;
  await db.insert(oauthStates).values({
    id: state,
    orgId: input.orgId,
    userId: input.userId,
    provider: input.provider,
    businessId: input.businessId ?? null,
    connectionInviteId: input.connectionInviteId ?? null,
    codeVerifier: verifier,
    redirectTo: input.redirectTo ?? null,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(input.provider),
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
    ...(cfg.extraAuthParams ?? {}),
  });
  if (verifier) {
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  return `${cfg.authorizeUrl}?${params}`;
}

export async function consumeOAuthState(state: string, provider: IntegrationProvider) {
  const [row] = await db.select().from(oauthStates).where(and(eq(oauthStates.id, state), eq(oauthStates.provider, provider))).limit(1);
  if (!row) throw new AppError("This connection link is invalid or was already used. Start the connection again.", "invalid");
  await db.delete(oauthStates).where(eq(oauthStates.id, state));
  if (row.expiresAt < new Date()) throw new AppError("The connection attempt expired. Start it again.", "invalid");
  return row;
}

export type TokenSet = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };

export async function exchangeCode(provider: IntegrationProvider, code: string, verifier: string | null): Promise<TokenSet> {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    client_id: cfg.clientId() ?? "",
    client_secret: cfg.clientSecret() ?? "",
  });
  if (verifier) body.set("code_verifier", verifier);
  return httpJson<TokenSet>(cfg.tokenUrl, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
}

export type IntegrationRow = typeof integrations.$inferSelect;

/**
 * Returns a usable access token, refreshing it when expired. A refresh that
 * fails with invalid_grant marks the connection expired so the UI can prompt
 * the owner to reconnect.
 */
export async function getAccessToken(integration: IntegrationRow): Promise<string> {
  if (integration.status === "revoked") throw new ProviderAuthError("This connection was disconnected. Reconnect it to continue.");
  if (!integration.accessTokenEnc) throw new ProviderAuthError("Connection has no access token. Reconnect it.");
  const fresh = !integration.tokenExpiresAt || integration.tokenExpiresAt.getTime() - Date.now() > 60_000;
  if (fresh) return decryptSecret(integration.accessTokenEnc);
  if (!integration.refreshTokenEnc) {
    await markIntegration(integration.id, "expired", "Access token expired and no refresh token is available");
    throw new ProviderAuthError("The connection expired. Reconnect it to continue.");
  }
  const cfg = OAUTH_PROVIDERS[integration.provider];
  try {
    const tokens = await httpJson<TokenSet>(cfg.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret(integration.refreshTokenEnc), client_id: cfg.clientId() ?? "", client_secret: cfg.clientSecret() ?? "" }),
    });
    await db
      .update(integrations)
      .set({
        accessTokenEnc: encryptSecret(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : integration.refreshTokenEnc,
        tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        status: "active",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integration.id));
    return tokens.access_token;
  } catch (e) {
    if (e instanceof AppError && /invalid_grant|revoked|expired/i.test(e.message)) {
      await markIntegration(integration.id, "expired", e.message);
      throw new ProviderAuthError("Authorization was revoked or expired. Reconnect the account.");
    }
    throw e;
  }
}

export async function markIntegration(id: string, status: "active" | "expired" | "revoked" | "error", error: string | null) {
  await db.update(integrations).set({ status, lastError: error, lastHealthCheckAt: new Date(), updatedAt: new Date() }).where(eq(integrations.id, id));
}

export async function revokeRemote(integration: IntegrationRow) {
  if (!integration.accessTokenEnc) return;
  const token = decryptSecret(integration.accessTokenEnc);
  try {
    if (integration.provider === "google" || integration.provider === "youtube") {
      await httpJson(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    } else if (integration.provider === "facebook" || integration.provider === "instagram") {
      await httpJson(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    }
  } catch {
    // Remote revocation is best-effort; local tokens are always deleted.
  }
}
