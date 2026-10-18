import { Client } from "pg";

/** Clears the test database before the browser suite. Refuses any other database. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localpilot:localpilot@localhost:5432/localpilot_test";
  if (!/localpilot_test/.test(url)) throw new Error(`Refusing to reset ${url}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  if (rows.length) await c.query(`truncate ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} restart identity cascade`);
  await c.end();
}
