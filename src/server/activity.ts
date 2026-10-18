import { db, type DbOrTx } from "./db";
import { activityEvents } from "./db/schema";

export type ActivityInput = {
  orgId: string;
  businessId?: string | null;
  actor: { type: "user" | "system" | "approval_link" | "public"; id?: string | null };
  action: string;
  target?: { type: string; id: string };
  detail?: Record<string, unknown>;
  ip?: string | null;
};

/** Append-only audit log of important writes. */
export async function logActivity(input: ActivityInput, tx: DbOrTx = db) {
  await tx.insert(activityEvents).values({
    orgId: input.orgId,
    businessId: input.businessId ?? null,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: input.action,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    detail: input.detail ?? null,
    ip: input.ip ?? null,
  });
}

export const userActor = (userId: string) => ({ type: "user" as const, id: userId });
export const systemActor = { type: "system" as const, id: null };
