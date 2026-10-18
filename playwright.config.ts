import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
const env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://localpilot:localpilot@localhost:5432/localpilot_test",
  APP_URL: `http://localhost:${PORT}`,
  DEMO_MODE: "true",
  STORAGE_DIR: "./storage-e2e",
  PORT: String(PORT),
  // `next start` runs in production mode, which requires a real key; a throwaway one is generated per run.
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

/** Runs against a production build (`npm run build` first) and the test database. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: env.APP_URL, trace: "retain-on-failure", launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined },
  webServer: { command: `npx next start -p ${PORT}`, url: `${env.APP_URL}/api/health`, reuseExistingServer: false, timeout: 120_000, env },
  globalSetup: "./tests/e2e/global-setup.ts",
});
