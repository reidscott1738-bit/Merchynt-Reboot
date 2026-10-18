/**
 * Demo seed. Every record it creates is demo data: reviews are flagged
 * is_demo/source "demo", and the business name says "(Demo)". Nothing here
 * represents a real business or real Google data.
 *
 * Usage: DEMO_MODE=true npm run db:seed
 * The password is read from SEED_PASSWORD or generated and printed once.
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, getPool } from "./index";
import { reviews, users } from "./schema";
import { signUp } from "../auth/store";
import { resolveActor } from "../authz";
import { addService, createBusiness, upsertKnowledge } from "../services/business";
import { addKeyword } from "../services/rankings";
import { saveClient } from "../services/agency";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") throw new Error("Refusing to seed demo data in production");
  const email = (process.env.SEED_EMAIL ?? "demo@localpilot.test").toLowerCase();
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) {
    console.log(`Seed user ${email} already exists; nothing to do.`);
    return;
  }
  const password = process.env.SEED_PASSWORD ?? randomBytes(12).toString("base64url");
  const { user, org } = await signUp({ name: "Demo Owner", email, password, orgName: "Demo Agency", orgKind: "agency" });
  const actor = (await resolveActor(user.id, org.id))!;
  const client = await saveClient(actor, { name: "Demo Client", contactName: "Pat Example", contactEmail: "pat@example.test" });
  const b = await createBusiness(actor, {
    name: "Lakeside Plumbing (Demo)",
    primaryCategory: "Plumber",
    description: "Demo business used to explore the product. Not a real company.",
    phone: "(512) 555-0100",
    website: "https://example.com",
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US",
    addressLine1: "100 Example St",
    latitude: 30.2672,
    longitude: -97.7431,
    timezone: "America/Chicago",
    serviceAreaPlaces: ["Austin", "Round Rock", "Cedar Park"],
    hours: { mon: [{ open: "08:00", close: "17:00" }], tue: [{ open: "08:00", close: "17:00" }], wed: [{ open: "08:00", close: "17:00" }], thu: [{ open: "08:00", close: "17:00" }], fri: [{ open: "08:00", close: "16:00" }], sat: [], sun: [] },
    googleReviewUrl: "https://example.com/demo-review-link",
    clientId: client.id,
  });
  for (const s of [
    { name: "Drain cleaning", description: "Clearing kitchen, bath and main line clogs." },
    { name: "Water heater repair", description: "Repair and replacement of tank and tankless water heaters." },
    { name: "Leak detection", description: "Finding and fixing hidden leaks." },
  ])
    await addService(actor, b.id, s);
  for (const f of [
    { category: "identity", key: "Founded", value: "Family owned since 2009" },
    { category: "credential", key: "License", value: "Licensed and insured in Texas" },
    { category: "policy", key: "Estimates", value: "Free estimates on replacements" },
  ])
    await upsertKnowledge(actor, b.id, f);
  for (const k of ["plumber", "drain cleaning", "water heater repair"]) await addKeyword(actor, b.id, { phrase: k, city: "Austin" });
  const day = 86400_000;
  await db.insert(reviews).values(
    [
      { rating: 5, text: "Came out the same afternoon and cleared our kitchen drain. Friendly and tidy.", reviewerName: "Demo Reviewer A" },
      { rating: 4, text: "Good work on the water heater, a little later than the window they gave.", reviewerName: "Demo Reviewer B" },
      { rating: 2, text: "Fixed the leak but the price was higher than I expected.", reviewerName: "Demo Reviewer C" },
      { rating: 5, text: "Explained everything clearly and the repair has held up.", reviewerName: "Demo Reviewer D" },
    ].map((r, i) => ({ ...r, businessId: b.id, source: "demo" as const, externalId: `demo-${i}`, publishedAt: new Date(Date.now() - (i + 1) * 2 * day), isDemo: true })),
  );
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  console.log("Demo data created. Every review and record is labeled demo.");
  console.log(`Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
  console.log(`  email:    ${email}`);
  if (!process.env.SEED_PASSWORD) console.log(`  password: ${password}  (generated; shown only now)`);
}

main()
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e);
    await getPool().end();
    process.exit(1);
  });
