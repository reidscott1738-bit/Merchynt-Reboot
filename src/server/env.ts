import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("LocalPilot"),
  DATABASE_URL: z.string().default("postgres://localpilot:localpilot@localhost:5432/localpilot"),
  /** 32-byte key, base64. Encrypts OAuth tokens at rest. */
  ENCRYPTION_KEY: z.string().optional(),
  /** When true, providers without credentials use clearly labeled demo adapters. */
  DEMO_MODE: bool,
  CRON_SECRET: z.string().optional(),
  STORAGE_DIR: z.string().default("./storage"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  /** Used for AI writing when ANTHROPIC_API_KEY is unset and GEMINI_API_KEY is set. */
  AI_GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  COMPANYCAM_CLIENT_ID: z.string().optional(),
  COMPANYCAM_CLIENT_SECRET: z.string().optional(),

  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  AI_VISIBILITY_OPENAI_MODEL: z.string().default("gpt-4.1"),
  AI_VISIBILITY_GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  AI_VISIBILITY_PERPLEXITY_MODEL: z.string().default("sonar"),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default("eleven_multilingual_v2"),

  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("LocalPilot <no-reply@localhost>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** For tests that mutate process.env. */
export function resetEnvCache() {
  cached = null;
}
