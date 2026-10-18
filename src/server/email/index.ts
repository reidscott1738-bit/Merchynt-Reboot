import nodemailer, { type Transporter } from "nodemailer";
import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { emailMessages, organizationBranding, suppressions } from "../db/schema";
import { env } from "../env";
import { enqueue } from "../jobs/queue";
import { normalizeEmail } from "@/lib/text";
import { TransientError } from "../errors";

export type EmailInput = {
  orgId: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  related?: { type: string; id: string };
  /** Transactional mail (approvals, invites) is not subject to marketing suppression. */
  marketing?: boolean;
};

export async function queueEmail(input: EmailInput, tx: DbOrTx = db) {
  const to = normalizeEmail(input.to);
  let fromName: string | null = null;
  let fromEmail: string | null = null;
  if (input.orgId) {
    const [b] = await tx.select().from(organizationBranding).where(eq(organizationBranding.orgId, input.orgId)).limit(1);
    fromName = b?.senderName ?? b?.displayName ?? null;
    // Only use a custom sender address once it has been verified.
    if (b?.senderEmail && b.senderVerifiedAt) fromEmail = b.senderEmail;
  }
  let status: "queued" | "suppressed" = "queued";
  if (input.marketing && input.orgId) {
    const [s] = await tx.select().from(suppressions).where(and(eq(suppressions.orgId, input.orgId), eq(suppressions.emailNormalized, to))).limit(1);
    if (s) status = "suppressed";
  }
  const [msg] = await tx
    .insert(emailMessages)
    .values({
      orgId: input.orgId,
      to,
      fromName,
      fromEmail,
      subject: input.subject,
      html: input.html,
      text: input.text,
      template: input.template,
      status,
      relatedType: input.related?.type ?? null,
      relatedId: input.related?.id ?? null,
    })
    .returning();
  if (status === "queued") await enqueue("email.send", { emailId: msg.id }, { idempotencyKey: `email:${msg.id}`, maxAttempts: 6, backoffBaseMs: 60_000, orgId: input.orgId }, tx);
  return msg;
}

let transport: Transporter | null = null;
function getTransport() {
  const url = env().SMTP_URL;
  if (!url) return null;
  if (!transport) transport = nodemailer.createTransport(url);
  return transport;
}

/** Job handler. Without SMTP configured, mail is recorded as not delivered. */
export async function sendQueuedEmail(emailId: string) {
  const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.id, emailId)).limit(1);
  if (!msg || msg.status !== "queued") return { skipped: true };
  const t = getTransport();
  if (!t) {
    await db.update(emailMessages).set({ status: "logged_only", provider: "none", error: "SMTP_URL not configured; message stored but not delivered", attempts: msg.attempts + 1 }).where(eq(emailMessages.id, msg.id));
    return { delivered: false, reason: "no_provider" };
  }
  const defaultFrom = env().EMAIL_FROM;
  const from = msg.fromEmail ? `${msg.fromName ?? ""} <${msg.fromEmail}>`.trim() : msg.fromName ? `${msg.fromName} <${defaultFrom.match(/<(.+)>/)?.[1] ?? defaultFrom}>` : defaultFrom;
  try {
    const info = await t.sendMail({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    await db.update(emailMessages).set({ status: "sent", provider: "smtp", providerMessageId: info.messageId, sentAt: new Date(), attempts: msg.attempts + 1 }).where(eq(emailMessages.id, msg.id));
    return { delivered: true };
  } catch (e) {
    const err = e as Error & { responseCode?: number };
    const permanent = err.responseCode != null && err.responseCode >= 500 && err.responseCode < 600 && err.responseCode !== 554;
    await db.update(emailMessages).set({ status: permanent ? "failed" : "queued", error: err.message, attempts: msg.attempts + 1 }).where(eq(emailMessages.id, msg.id));
    if (!permanent) throw new TransientError(`SMTP send failed: ${err.message}`);
    return { delivered: false, reason: err.message };
  }
}
