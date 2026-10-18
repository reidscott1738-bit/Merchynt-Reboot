import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { approvalTokens, tasks } from "@/server/db/schema";
import { actOnTaskAsUser, actWithApprovalToken, createTask, inspectApprovalToken, issueApprovalToken, registerTaskHandler } from "@/server/services/tasks";
import { AppError, invalid } from "@/server/errors";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

const approved: string[] = [];
let failNext = false;
registerTaskHandler("test_item", {
  editable: true,
  async preview(t) {
    return { title: t.title, body: "Preview body" };
  },
  async onApprove(t) {
    if (failNext) {
      failNext = false;
      throw invalid("Still fails validation");
    }
    approved.push(t.refId);
    return { published: true };
  },
});

async function newTask() {
  const owner = await makeOrg();
  const b = await makeBusiness(owner);
  const task = await createTask({ orgId: owner.orgId, businessId: b.id, type: "faq", title: "Approve me", refType: "test_item", refId: randomUUID(), sendEmails: false });
  return { owner, b, task };
}

beforeAll(resetDb);
afterAll(closeDb);

describe("single-use approval links", () => {
  it("viewing a link changes nothing", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "client@example.test", ["approve", "reject"]);
    const first = await inspectApprovalToken(token);
    await inspectApprovalToken(token);
    expect(first.state).toBe("valid");
    const [t] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(t.status).toBe("open");
  });

  it("acts once and cannot be replayed; sibling links are revoked", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "a@example.test", ["approve", "reject"]);
    const other = await issueApprovalToken(task.id, "b@example.test", ["approve"]);
    await actWithApprovalToken(token, "approve");
    expect(approved).toContain(task.refId);
    await expect(actWithApprovalToken(token, "approve")).rejects.toThrow(/no longer valid/);
    expect((await inspectApprovalToken(other)).state).toBe("revoked");
  });

  it("concurrent clicks on the same link run the workflow once", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "a@example.test", ["approve"]);
    const before = approved.filter((x) => x === task.refId).length;
    const results = await Promise.allSettled([actWithApprovalToken(token, "approve"), actWithApprovalToken(token, "approve"), actWithApprovalToken(token, "approve")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(approved.filter((x) => x === task.refId).length - before).toBe(1);
  });

  it("refuses actions the link does not allow and keeps it usable", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "a@example.test", ["approve"]);
    const err = await actWithApprovalToken(token, "reject").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("forbidden");
    const [row] = await db.select().from(approvalTokens).where(eq(approvalTokens.taskId, task.id));
    expect(row.usedAt).toBeNull();
    await expect(actWithApprovalToken(token, "approve", { body: "edited" })).rejects.toThrow();
  });

  it("leaves the task open and the link usable when approval fails a precondition", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "a@example.test", ["approve"]);
    failNext = true;
    await expect(actWithApprovalToken(token, "approve")).rejects.toThrow(/Still fails/);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(t.status).toBe("open");
    expect((await inspectApprovalToken(token)).state).toBe("valid");
  });

  it("expired links cannot act", async () => {
    const { task } = await newTask();
    const token = await issueApprovalToken(task.id, "a@example.test", ["approve"]);
    await db.update(approvalTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(approvalTokens.taskId, task.id));
    expect((await inspectApprovalToken(token)).state).toBe("expired");
    await expect(actWithApprovalToken(token, "approve")).rejects.toThrow(/no longer valid/);
  });

  it("only lets members of the same org act from the dashboard", async () => {
    const { task } = await newTask();
    const stranger = await makeOrg();
    await expect(actOnTaskAsUser(stranger, task.id, "approve")).rejects.toMatchObject({ code: "not_found" });
  });
});
