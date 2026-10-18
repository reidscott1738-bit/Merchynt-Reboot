import "server-only";
import "./services/register";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "./errors";
import { safeRedirectPath } from "./security/redirects";
import { requireActor } from "./auth/session";
import type { Actor } from "./authz";

/** Only same-origin relative paths are accepted as redirect targets. */
export function safeBack(raw: FormDataEntryValue | null | undefined, fallback = "/dashboard") {
  return safeRedirectPath(typeof raw === "string" ? raw : null, fallback);
}

function withParam(path: string, key: string, value: string) {
  const [base, hash] = path.split("#");
  const url = new URL(base, "http://x");
  url.searchParams.delete("ok");
  url.searchParams.delete("err");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}

function messageFor(err: unknown) {
  if (err instanceof AppError) return err.message;
  console.error(err);
  return "Something went wrong. The error was logged; try again or contact support.";
}

/**
 * Runs a form action for the signed-in user and redirects back with a
 * success or error message. `fn` may return a path to redirect to instead.
 */
export async function formAction(form: FormData, fn: (actor: Actor) => Promise<string | void | { redirect: string; ok?: string } | unknown>, ok = "Saved") {
  const actor = await requireActor();
  const back = safeBack(form.get("_back"));
  let target: string;
  try {
    const r = await fn(actor);
    if (typeof r === "string") target = r.startsWith("/") ? r : withParam(back, "ok", r);
    else if (r && typeof r === "object" && "redirect" in r && typeof (r as { redirect: unknown }).redirect === "string") {
      const rr = r as { redirect: string; ok?: string };
      target = rr.ok ? withParam(rr.redirect, "ok", rr.ok) : rr.redirect;
    } else target = withParam(back, "ok", ok);
  } catch (err) {
    target = withParam(back, "err", messageFor(err));
  }
  revalidatePath("/", "layout");
  redirect(target);
}

/** Same as formAction, for public pages with no signed-in user. */
export async function publicFormAction(form: FormData, fn: () => Promise<string | void | unknown>, ok = "Done") {
  const back = safeBack(form.get("_back"), "/");
  let target: string;
  try {
    const r = await fn();
    target = typeof r === "string" && r.startsWith("/") ? r : withParam(back, "ok", typeof r === "string" ? r : ok);
  } catch (err) {
    target = withParam(back, "err", messageFor(err));
  }
  redirect(target);
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (f: FormData, k: string) => str(f, k) || null;
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
export const list = (f: FormData, k: string) =>
  str(f, k)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
export const all = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0);

export async function filesFrom(f: FormData, k = "files") {
  const out: { data: Buffer; filename: string }[] = [];
  for (const v of f.getAll(k)) {
    if (typeof v === "object" && "arrayBuffer" in v && v.size > 0) out.push({ data: Buffer.from(await v.arrayBuffer()), filename: v.name || "upload" });
  }
  return out;
}
