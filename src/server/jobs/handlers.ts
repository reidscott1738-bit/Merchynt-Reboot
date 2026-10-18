import "../services/register";
import type { JobRow } from "./queue";
import { sendQueuedEmail } from "../email";
import { runPublication } from "../services/publishing";
import { pushAttributes, pushProfileChange, pushServices } from "../services/integrations";
import { describeAsset, pushPhotoToGoogle } from "../services/media";
import { executeAudit } from "../services/rankings";
import { executeSeoAudit } from "../services/seo";
import { executeAiVisibilityAudit } from "../services/ai-visibility";
import { generateReport } from "../services/reports";
import { renderVideo } from "../services/videos";
import { executeAutomation } from "../services/automations";

type Ctx = { job: JobRow; isFinalAttempt: boolean };
type Handler = (payload: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

const str = (p: Record<string, unknown>, k: string) => {
  const v = p[k];
  if (typeof v !== "string" || !v) throw new Error(`Job payload is missing ${k}`);
  return v;
};

export const JOB_HANDLERS: Record<string, Handler> = {
  "email.send": (p) => sendQueuedEmail(str(p, "emailId")),
  "publish.run": (p, c) => runPublication(str(p, "publicationId"), c.job.attempts, c.isFinalAttempt),
  "gbp.pushProfileChange": (p) => pushProfileChange(str(p, "changeId")),
  "gbp.pushServices": (p) => pushServices(str(p, "businessId")),
  "gbp.pushAttributes": (p) => pushAttributes(str(p, "businessId")),
  "media.describe": (p) => describeAsset(str(p, "assetId")),
  "media.pushGoogle": (p) => pushPhotoToGoogle(str(p, "assetId")),
  "ranking.audit": (p) => executeAudit(str(p, "auditId")),
  "seo.audit": (p) => executeSeoAudit(str(p, "auditId")),
  "aiVisibility.audit": (p) => executeAiVisibilityAudit(str(p, "auditId")),
  "report.generate": (p, c) => generateReport(str(p, "reportId"), c.isFinalAttempt),
  "video.render": (p) => renderVideo(str(p, "projectId")),
  "automation.run": (p, c) => executeAutomation(str(p, "executionId"), c.isFinalAttempt),
};

export async function runJob(job: JobRow) {
  const handler = JOB_HANDLERS[job.name];
  if (!handler) throw new Error(`No handler for job "${job.name}"`);
  const result = await handler(job.payload, { job, isFinalAttempt: job.attempts >= job.maxAttempts });
  return (result && typeof result === "object" ? result : { result }) as Record<string, unknown>;
}
