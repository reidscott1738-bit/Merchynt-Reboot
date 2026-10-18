import { NextResponse } from "next/server";
import { completeOAuth } from "@/server/services/integrations";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/server/db/schema";
import { safeRedirectPath } from "@/server/security/redirects";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";

/** Provider redirect target. The state parameter is single use and bound to the provider. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const base = env().APP_URL.replace(/\/$/, "");
  const withMsg = (path: string, key: "ok" | "err", msg: string) => `${base}${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;
  if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(provider)) return NextResponse.redirect(withMsg("/dashboard", "err", "Unknown provider"));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied || !code || !state) {
    return NextResponse.redirect(withMsg("/connect/done", "err", denied === "access_denied" ? "The connection was cancelled." : "The provider did not return an authorization code."));
  }
  try {
    const r = await completeOAuth(provider as IntegrationProvider, code, state);
    if (r.viaInvite) return NextResponse.redirect(withMsg("/connect/done", "ok", "Connected. You can close this page."));
    const fallback = r.businessId ? `/b/${r.businessId}/integrations` : "/settings?tab=integrations";
    const back = safeRedirectPath(r.redirectTo, fallback);
    const target = r.businessId && back.startsWith(`/b/${r.businessId}/integrations`) ? `/b/${r.businessId}/integrations?discover=${r.integration.id}` : back;
    return NextResponse.redirect(withMsg(target, "ok", "Account connected. Choose what to link."));
  } catch (e) {
    console.error("oauth callback failed", provider, e instanceof Error ? e.message : e);
    return NextResponse.redirect(withMsg("/connect/done", "err", e instanceof AppError ? e.message : "The connection could not be completed. Try again."));
  }
}
