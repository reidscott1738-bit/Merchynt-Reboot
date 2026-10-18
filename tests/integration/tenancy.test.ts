import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { integrations, memberships, users } from "@/server/db/schema";
import { requireBusiness, resolveActor, accessibleBusinesses } from "@/server/authz";
import { listIntegrations } from "@/server/services/integrations";
import { listReviews } from "@/server/services/reviews";
import { saveClient } from "@/server/services/agency";
import { updateBusiness } from "@/server/services/business";
import { encryptSecret } from "@/server/security/crypto";
import { AppError } from "@/server/errors";
import { closeDb, makeBusiness, makeOrg, resetDb } from "./helpers";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
};

beforeAll(resetDb);
afterAll(closeDb);

describe("tenant isolation", () => {
  it("hides one organization's businesses from another as not found", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const biz = await makeBusiness(a);
    expect(await code(requireBusiness(b, biz.id))).toBe("not_found");
    expect(await code(listReviews(b, biz.id))).toBe("not_found");
    expect(await code(updateBusiness(b, biz.id, { name: "Hijacked" }))).toBe("not_found");
    expect(await code(requireBusiness(a, "not-a-uuid"))).toBe("not_found");
    expect(await code(requireBusiness(a, biz.id))).toBe("ok");
  });

  it("limits client approvers to their clients' businesses and to approval permissions", async () => {
    const agency = await makeOrg();
    const c1 = await saveClient(agency, { name: "Client One" });
    const c2 = await saveClient(agency, { name: "Client Two" });
    const b1 = await makeBusiness(agency, { name: "One Co", clientId: c1.id });
    const b2 = await makeBusiness(agency, { name: "Two Co", clientId: c2.id });
    const [u] = await db.insert(users).values({ email: "approver@example.test", name: "Approver" }).returning();
    await db.insert(memberships).values({ orgId: agency.orgId, userId: u.id, role: "client_approver", clientIds: [c1.id] });
    const approver = (await resolveActor(u.id, agency.orgId))!;
    expect((await accessibleBusinesses(approver)).map((x) => x.id)).toEqual([b1.id]);
    expect(await code(requireBusiness(approver, b2.id))).toBe("not_found");
    expect(await code(requireBusiness(approver, b1.id, "content.approve"))).toBe("ok");
    expect(await code(requireBusiness(approver, b1.id, "business.edit"))).toBe("forbidden");
  });

  it("treats a client approver with no clients as seeing nothing", async () => {
    const agency = await makeOrg();
    await makeBusiness(agency);
    const [u] = await db.insert(users).values({ email: "empty@example.test", name: "Empty" }).returning();
    await db.insert(memberships).values({ orgId: agency.orgId, userId: u.id, role: "client_approver", clientIds: [] });
    const approver = (await resolveActor(u.id, agency.orgId))!;
    expect(approver.clientIds).toEqual([]);
    expect(await accessibleBusinesses(approver)).toEqual([]);
  });

  it("never returns stored tokens from the integrations list", async () => {
    const a = await makeOrg();
    await db.insert(integrations).values({ orgId: a.orgId, provider: "google", externalAccountId: "acct-1", externalAccountName: "owner@example.test", accessTokenEnc: encryptSecret("secret-access"), refreshTokenEnc: encryptSecret("secret-refresh") });
    const rows = await listIntegrations(a);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/secret-|accessTokenEnc|refreshTokenEnc/);
    const [stored] = await db.select().from(integrations).where(eq(integrations.orgId, a.orgId));
    expect(stored.accessTokenEnc).not.toContain("secret-access");
  });
});
