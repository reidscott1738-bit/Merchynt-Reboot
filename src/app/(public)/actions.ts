"use server";

import { redirect } from "next/navigation";
import { bool, filesFrom, optStr, publicFormAction, str } from "@/server/actions";
import { AppError, invalid } from "@/server/errors";
import { clientIp } from "@/server/security/client-ip";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { actWithApprovalToken } from "@/server/services/tasks";
import { getPublicReviewPage, optOut, recordLinkEvent, submitPhotoBoost } from "@/server/services/campaigns";
import { uploadViaLink } from "@/server/services/media";
import { lookupConnectionInvite } from "@/server/services/integrations";
import { beginOAuth } from "@/server/integrations/oauth";
import { acceptInvitation } from "@/server/services/agency";
import { getSession, startSession, switchOrg } from "@/server/auth/session";

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const token = (f: FormData) => {
  const t = str(f, "token");
  if (!TOKEN.test(t)) throw invalid("This link is not valid");
  return t;
};

export async function approvalAction(form: FormData) {
  await publicFormAction(form, async () => {
    const t = token(form);
    await consumeRateLimit(`approve:${await clientIp()}`, 30, 600);
    const op = str(form, "op");
    if (op !== "approve" && op !== "reject" && op !== "skip") throw invalid("Unknown action");
    const body = optStr(form, "body");
    const original = optStr(form, "original");
    const edits = body && body !== original ? { body } : undefined;
    await actWithApprovalToken(t, op, edits, optStr(form, "reason") ?? undefined);
    return op === "approve" ? "Approved. Thank you." : op === "reject" ? "Rejected. The team has been told." : "Skipped.";
  });
}

/** Sends every visitor to Google the same way; there is no rating gate in front of it. */
export async function continueToGoogleAction(form: FormData) {
  const page = await getPublicReviewPage(str(form, "slug"), optStr(form, "link"), optStr(form, "c"));
  const raw = page?.business.googleReviewUrl ?? "";
  const url = URL.canParse(raw) ? new URL(raw) : null;
  // Only https destinations; a misconfigured link never becomes a javascript: or open redirect.
  if (!url || url.protocol !== "https:") {
    const back = new URL(str(form, "_back").startsWith("/r/") ? str(form, "_back") : "/", "http://x");
    back.searchParams.set("err", "The review link for this business is not set up yet.");
    redirect(`${back.pathname}${back.search}`);
  }
  await recordLinkEvent(page!.business.id, page!.link?.id ?? null, page!.contact?.id ?? null, "continue_to_google");
  redirect(url.toString());
}

export async function photoBoostAction(form: FormData) {
  await publicFormAction(form, async () => {
    await consumeRateLimit(`photo-boost:${await clientIp()}`, 10, 3600);
    const files = await filesFrom(form);
    const r = await submitPhotoBoost(str(form, "slug"), optStr(form, "link"), optStr(form, "c"), files, { name: optStr(form, "name"), consent: bool(form, "consent"), caption: optStr(form, "caption") });
    return `Thank you! ${r.uploaded} photo${r.uploaded === 1 ? "" : "s"} received.`;
  });
}

export async function uploadLinkAction(form: FormData) {
  await publicFormAction(form, async () => {
    const t = token(form);
    await consumeRateLimit(`upload-link:${await clientIp()}`, 20, 3600);
    const files = await filesFrom(form);
    if (!files.length) throw invalid("Choose at least one file");
    const r = await uploadViaLink(t, files, { name: optStr(form, "name"), email: optStr(form, "email"), consent: bool(form, "consent"), caption: optStr(form, "caption") });
    const dup = r.filter((x) => x.duplicate).length;
    return `Uploaded ${r.length - dup} file${r.length - dup === 1 ? "" : "s"}${dup ? ` (${dup} already received)` : ""}. Thank you!`;
  });
}

/** Starts OAuth for a client using a single-use connection invite; the invite is marked used only after a successful callback. */
export async function connectInviteAction(form: FormData) {
  const back = `/connect/${encodeURIComponent(str(form, "token"))}`;
  let authUrl: string;
  try {
    const t = token(form);
    await consumeRateLimit(`connect:${await clientIp()}`, 20, 600);
    const inv = await lookupConnectionInvite(t);
    if (inv.state !== "valid") throw invalid("This connection link is no longer valid");
    authUrl = await beginOAuth({ provider: inv.invite.provider, orgId: inv.invite.orgId, userId: null, businessId: inv.invite.businessId, connectionInviteId: inv.invite.id });
  } catch (e) {
    redirect(`${back}?err=${encodeURIComponent(e instanceof AppError ? e.message : "The connection could not be started")}`);
  }
  redirect(authUrl);
}

export async function acceptInviteAction(form: FormData) {
  await publicFormAction(form, async () => {
    const t = token(form);
    await consumeRateLimit(`invite:${await clientIp()}`, 20, 600);
    const s = await getSession();
    const res = await acceptInvitation(t, { signedInUserId: s?.user.id ?? null, name: optStr(form, "name") ?? undefined, password: str(form, "password") || undefined });
    if (s?.user.id === res.userId) await switchOrg(res.orgId);
    else await startSession(res.userId, res.orgId);
    return "/dashboard";
  });
}

export async function unsubscribeAction(form: FormData) {
  await publicFormAction(form, async () => {
    const t = str(form, "token");
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(t)) throw invalid("This unsubscribe link is not valid");
    await consumeRateLimit(`unsub:${await clientIp()}`, 30, 600);
    const r = await optOut(t);
    if (!r) throw invalid("This unsubscribe link is not valid. Reply to the email and ask to be removed.");
    return `You will not receive more review requests from ${r.businessName}.`;
  });
}
