import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "../env";
import { AppError, notConfigured, TransientError } from "../errors";
import { httpJson, ProviderAuthError } from "../integrations/http";

export type Effort = "low" | "medium" | "high";

export type TextRequest = {
  task: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
};

export type JsonRequest<T> = TextRequest & {
  schema: z.ZodType<T>;
  /** Deterministic output used only by the labeled demo provider. */
  demo: () => T;
};

export type Usage = { inputTokens: number; outputTokens: number };
export type GenerationMeta = { provider: string; model: string; isDemo: boolean; task: string; generatedAt: string; usage?: Usage };

export interface AiProvider {
  readonly id: "anthropic" | "gemini" | "demo";
  readonly isDemo: boolean;
  readonly model: string;
  json<T>(req: JsonRequest<T>): Promise<{ data: T; meta: GenerationMeta }>;
}

const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
  readonly isDemo = false;
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async json<T>(req: JsonRequest<T>) {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        betas: [SERVER_FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema as z.ZodType) },
        messages: [{ role: "user", content: req.prompt }],
      });
      if (res.stop_reason === "refusal") throw new AppError("The AI model declined to generate this content. Edit the request or instructions and try again.", "invalid");
      if (res.stop_reason === "max_tokens") throw new TransientError("AI response was cut off before completion");
      if (res.parsed_output == null) throw new TransientError("AI response did not match the expected format");
      return {
        data: res.parsed_output as T,
        meta: {
          provider: "anthropic",
          model: res.model,
          isDemo: false,
          task: req.task,
          generatedAt: new Date().toISOString(),
          usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        },
      };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new TransientError("AI provider rate limit reached", 60_000);
      if (e instanceof Anthropic.AuthenticationError) throw new AppError("The AI provider rejected the API key. Check ANTHROPIC_API_KEY.", "not_configured");
      if (e instanceof Anthropic.BadRequestError) throw new AppError(`AI request was rejected: ${e.message}`, "invalid");
      if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) throw new TransientError(`AI provider unavailable: ${e.message}`);
      throw e;
    }
  }
}

/** JSON Schema for Gemini's structured output, without the meta keyword it does not accept. */
function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  void _ignored;
  return rest;
}

/**
 * Google Gemini through the Gemini API. Its free tier makes it the low-cost
 * option; output uses JSON mode constrained by the same zod schema.
 */
export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  readonly isDemo = false;
  constructor(private apiKey: string, readonly model: string) {}

  async json<T>(req: JsonRequest<T>) {
    type R = {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    let res: R;
    try {
      res = await httpJson<R>(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey },
        timeoutMs: 120_000,
        body: {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { maxOutputTokens: req.maxTokens ?? 16000, responseMimeType: "application/json", responseJsonSchema: geminiSchema(req.schema) },
        },
      });
    } catch (e) {
      if (e instanceof ProviderAuthError) throw new AppError("The AI provider rejected the API key. Check GEMINI_API_KEY.", "not_configured");
      throw e;
    }
    const c = res.candidates?.[0];
    if (res.promptFeedback?.blockReason || c?.finishReason === "SAFETY" || c?.finishReason === "PROHIBITED_CONTENT") {
      throw new AppError("The AI model declined to generate this content. Edit the request or instructions and try again.", "invalid");
    }
    if (c?.finishReason === "MAX_TOKENS") throw new TransientError("AI response was cut off before completion");
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new TransientError("AI response was not valid JSON");
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new TransientError("AI response did not match the expected format");
    return {
      data: parsed.data,
      meta: {
        provider: "gemini",
        model: res.modelVersion ?? this.model,
        isDemo: false,
        task: req.task,
        generatedAt: new Date().toISOString(),
        usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
      },
    };
  }
}

class DemoProvider implements AiProvider {
  readonly id = "demo" as const;
  readonly isDemo = true;
  readonly model = "demo-template-generator";
  async json<T>(req: JsonRequest<T>) {
    const data = req.schema.parse(req.demo());
    return { data, meta: { provider: "demo", model: this.model, isDemo: true, task: req.task, generatedAt: new Date().toISOString() } };
  }
}

let override: AiProvider | null = null;
/** Tests can swap in an explicit mock provider. */
export function setAiProviderForTests(p: AiProvider | null) {
  override = p;
}

export function getAi(): AiProvider {
  if (override) return override;
  const e = env();
  if (e.ANTHROPIC_API_KEY) return new AnthropicProvider(e.ANTHROPIC_API_KEY, e.AI_MODEL);
  if (e.GEMINI_API_KEY) return new GeminiProvider(e.GEMINI_API_KEY, e.AI_GEMINI_MODEL);
  if (e.DEMO_MODE) return new DemoProvider();
  throw notConfigured("No AI provider is configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY, or enable DEMO_MODE for labeled sample output.");
}

export function aiStatus(): { configured: boolean; provider: string; isDemo: boolean; model: string | null } {
  const e = env();
  if (e.ANTHROPIC_API_KEY) return { configured: true, provider: "Anthropic", isDemo: false, model: e.AI_MODEL };
  if (e.GEMINI_API_KEY) return { configured: true, provider: "Google Gemini", isDemo: false, model: e.AI_GEMINI_MODEL };
  if (e.DEMO_MODE) return { configured: true, provider: "Demo templates", isDemo: true, model: null };
  return { configured: false, provider: "None", isDemo: false, model: null };
}
