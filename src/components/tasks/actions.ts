"use server";

import { formAction, optStr, str } from "@/server/actions";
import { localToDate } from "@/server/forms";
import { actOnTaskAsUser, assignTask } from "@/server/services/tasks";
import type { TaskAction } from "@/lib/approval-policy";

const ALLOWED: TaskAction[] = ["approve", "reject", "skip", "edit", "complete", "cancel", "reopen"];

export async function taskAction(form: FormData) {
  const action = str(form, "action") as TaskAction;
  await formAction(
    form,
    async (actor) => {
      if (!ALLOWED.includes(action)) throw new Error("Unknown action");
      const body = form.has("body") ? str(form, "body") : undefined;
      await actOnTaskAsUser(actor, str(form, "taskId"), action, { edits: body !== undefined ? { body } : undefined, reason: optStr(form, "reason") ?? undefined });
    },
    { approve: "Approved", reject: "Rejected", skip: "Skipped", edit: "Changes saved", complete: "Marked complete", cancel: "Cancelled", reopen: "Reopened", expire: "Expired" }[action] ?? "Done",
  );
}

export async function assignTaskAction(form: FormData) {
  await formAction(
    form,
    (actor) => {
      const due = str(form, "dueAt");
      return assignTask(actor, str(form, "taskId"), { assigneeUserId: optStr(form, "assigneeUserId"), assigneeEmail: optStr(form, "assigneeEmail"), dueAt: due ? localToDate(due, str(form, "tz") || "UTC") : null, notify: form.get("notify") === "on" });
    },
    "Task assigned",
  );
}
