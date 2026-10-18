import type { TaskStatus } from "@/server/db/schema";

export type PostApprovalMode = "none" | "all" | "branded_or_ai";

export function postRequiresApproval(mode: PostApprovalMode, post: { imageMode: "none" | "raw" | "branded"; imageSource: "none" | "uploaded" | "gbp" | "ai_generated" }): { required: boolean; reason: string | null } {
  if (mode === "all") return { required: true, reason: "Every post requires approval" };
  if (mode === "branded_or_ai") {
    if (post.imageSource === "ai_generated") return { required: true, reason: "Post uses an AI-generated image" };
    if (post.imageMode === "branded") return { required: true, reason: "Post uses a branded image" };
    return { required: false, reason: null };
  }
  return { required: false, reason: null };
}

/** Content that failed validation always needs a person, regardless of mode. */
export function finalApprovalDecision(policy: { required: boolean; reason: string | null }, validation: { ok: boolean; issues: { severity: string; message: string }[] }) {
  if (!validation.ok) {
    const first = validation.issues.find((i) => i.severity === "error");
    return { required: true, reason: `Needs review: ${first?.message ?? "validation failed"}` };
  }
  return policy;
}

export type TaskAction = "approve" | "reject" | "skip" | "edit" | "complete" | "cancel" | "expire" | "reopen";

const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  open: { approve: "approved", reject: "rejected", skip: "skipped", complete: "completed", cancel: "cancelled", expire: "expired", edit: "open" },
  approved: { complete: "completed" },
  rejected: { reopen: "open" },
  skipped: { reopen: "open" },
  completed: {},
  expired: { reopen: "open" },
  cancelled: {},
};

export function nextTaskStatus(current: TaskStatus, action: TaskAction): TaskStatus | null {
  return TRANSITIONS[current]?.[action] ?? null;
}
