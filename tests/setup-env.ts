// Tests always run against the dedicated test database, never the dev one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localpilot:localpilot@localhost:5432/localpilot_test";
process.env.APP_URL = "http://localhost:3000";
process.env.DEMO_MODE = "true";
process.env.STORAGE_DIR = "./storage-test";
// Provider credentials are cleared so no test can reach a real API.
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "META_APP_ID", "META_APP_SECRET", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "COMPANYCAM_CLIENT_ID", "COMPANYCAM_CLIENT_SECRET", "DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "ELEVENLABS_API_KEY", "SMTP_URL"]) delete process.env[k];
