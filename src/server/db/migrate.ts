import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, getPool } from "./index";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
