"use server";

import { redirect } from "next/navigation";
import { authenticate, signUp } from "@/server/auth/store";
import { startSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/security/client-ip";
import { safeBack, str } from "@/server/actions";

export async function loginAction(form: FormData) {
  const email = str(form, "email");
  const next = safeBack(form.get("next"));
  let err: string | null = null;
  try {
    await consumeRateLimit(`login:${await clientIp()}`, 20, 15 * 60);
    await consumeRateLimit(`login-email:${email.toLowerCase()}`, 10, 15 * 60);
    const { user, orgId } = await authenticate(email, str(form, "password"));
    await startSession(user.id, orgId);
  } catch (e) {
    err = e instanceof AppError ? e.message : "Sign-in failed";
  }
  if (err) redirect(`/login?err=${encodeURIComponent(err)}&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signupAction(form: FormData) {
  let err: string | null = null;
  try {
    await consumeRateLimit(`signup:${await clientIp()}`, 10, 3600);
    const kind = str(form, "orgKind") === "agency" ? "agency" : "business";
    const { user, org } = await signUp({ name: str(form, "name"), email: str(form, "email"), password: str(form, "password"), orgName: str(form, "orgName"), orgKind: kind });
    await startSession(user.id, org.id);
  } catch (e) {
    err = e instanceof AppError ? e.message : "Sign-up failed";
  }
  if (err) redirect(`/signup?err=${encodeURIComponent(err)}`);
  redirect("/businesses/new?welcome=1");
}
