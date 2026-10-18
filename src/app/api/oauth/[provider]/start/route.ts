import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { requireBusiness } from "@/server/authz";
import { can } from "@/lib/permissions";
import { beginOAuth } from "@/server/integrations/oauth";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/server/db/schema";
import { safeRedirectPath } from "@/server/security/redirects";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";

/** Starts an OAuth connection for the signed-in user. Credentials stay server-side. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const base = env().APP_URL.replace(/\/$/, "");
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(`${base}/login`);
  const back = safeRedirectPath(url.searchParams.get("redirect"), "/settings?tab=integrations");
  const fail = (msg: string) => NextResponse.redirect(`${base}${back}${back.includes("?") ? "&" : "?"}err=${encodeURIComponent(msg)}`);
  if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(provider)) return fail("Unknown provider");
  if (!can(actor.role, "integrations.manage")) return fail("You do not have permission to connect accounts");
  const businessId = url.searchParams.get("businessId");
  try {
    if (businessId) await requireBusiness(actor, businessId, "integrations.manage");
    const authUrl = await beginOAuth({ provider: provider as IntegrationProvider, orgId: actor.orgId, userId: actor.userId, businessId, redirectTo: back });
    return NextResponse.redirect(authUrl);
  } catch (e) {
    return fail(e instanceof AppError ? e.message : "Could not start the connection");
  }
}
