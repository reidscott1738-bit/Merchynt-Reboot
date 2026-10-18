import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { env } from "../../env";
import { httpJson } from "../http";
import { TransientError } from "../../errors";

/**
 * AI-search adapters. Each records the exact query and the response it got.
 * Answers are nondeterministic; a result is an observation of one response,
 * not a ranking.
 */
export type AiSearchAnswer = { text: string; sources: { url: string; title?: string }[]; model: string };

export interface AiSearchProvider {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  readonly support: "supported" | "limited" | "unsupported";
  readonly notes: string;
  ask(query: string, location: { city: string | null; region: string | null; country: string | null }): Promise<AiSearchAnswer>;
}

class AnthropicSearch implements AiSearchProvider {
  readonly id = "anthropic";
  readonly label = "Claude (Anthropic API with web search)";
  readonly isDemo = false;
  readonly support = "supported" as const;
  readonly notes = "Uses the Messages API with the server-side web search tool, so answers include cited sources.";
  constructor(private key: string, private model: string) {}
  async ask(query: string, loc: { city: string | null; region: string | null; country: string | null }) {
    const client = new Anthropic({ apiKey: this.key, maxRetries: 2 });
    try {
      const res = await client.messages.create({
        model: this.model,
        max_tokens: 4000,
        output_config: { effort: "low" },
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: 3,
            ...(loc.city ? { user_location: { type: "approximate" as const, city: loc.city, region: loc.region ?? undefined, country: loc.country ?? "US" } } : {}),
          },
        ],
        messages: [{ role: "user", content: query }],
      });
      const sources: { url: string; title?: string }[] = [];
      let text = "";
      for (const block of res.content) {
        if (block.type === "text") {
          text += block.text;
          for (const c of block.citations ?? []) if ("url" in c && c.url) sources.push({ url: c.url, title: "title" in c ? (c.title ?? undefined) : undefined });
        }
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.push({ url: r.url, title: r.title });
        }
      }
      return { text, sources: dedupe(sources), model: res.model };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) throw new TransientError(`Anthropic: ${e.message}`);
      throw e;
    }
  }
}

class OpenAiSearch implements AiSearchProvider {
  readonly id = "openai";
  readonly label = "ChatGPT model via OpenAI API (web search tool)";
  readonly isDemo = false;
  readonly support = "limited" as const;
  readonly notes = "API answers can differ from the ChatGPT consumer app. Verify the model name in AI_VISIBILITY_OPENAI_MODEL.";
  constructor(private key: string, private model: string) {}
  async ask(query: string) {
    type R = { output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[]; model: string };
    const res = await httpJson<R>("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}` },
      timeoutMs: 90_000,
      body: { model: this.model, input: query, tools: [{ type: "web_search" }] },
    });
    let text = "";
    const sources: { url: string; title?: string }[] = [];
    for (const o of res.output ?? []) for (const c of o.content ?? []) {
      if (c.type === "output_text" && c.text) text += c.text;
      for (const a of c.annotations ?? []) if (a.url) sources.push({ url: a.url, title: a.title });
    }
    return { text, sources: dedupe(sources), model: res.model };
  }
}

class GeminiSearch implements AiSearchProvider {
  readonly id = "gemini";
  readonly label = "Gemini via Google AI API (Search grounding)";
  readonly isDemo = false;
  readonly support = "limited" as const;
  readonly notes = "Grounded API answers can differ from the Gemini app.";
  constructor(private key: string, private model: string) {}
  async ask(query: string) {
    type R = { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri: string; title?: string } }[] } }[]; modelVersion?: string };
    const res = await httpJson<R>(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.key },
      timeoutMs: 90_000,
      body: { contents: [{ parts: [{ text: query }] }], tools: [{ google_search: {} }] },
    });
    const c = res.candidates?.[0];
    return {
      text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      sources: dedupe((c?.groundingMetadata?.groundingChunks ?? []).flatMap((g) => (g.web ? [{ url: g.web.uri, title: g.web.title }] : []))),
      model: res.modelVersion ?? this.model,
    };
  }
}

class PerplexitySearch implements AiSearchProvider {
  readonly id = "perplexity";
  readonly label = "Perplexity (Sonar API)";
  readonly isDemo = false;
  readonly support = "supported" as const;
  readonly notes = "Sonar returns citations with each answer.";
  constructor(private key: string, private model: string) {}
  async ask(query: string) {
    type R = { model: string; choices: { message: { content: string } }[]; citations?: string[]; search_results?: { url: string; title?: string }[] };
    const res = await httpJson<R>("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}` },
      timeoutMs: 90_000,
      body: { model: this.model, messages: [{ role: "user", content: query }] },
    });
    const sources = res.search_results?.length ? res.search_results : (res.citations ?? []).map((url) => ({ url }));
    return { text: res.choices[0]?.message.content ?? "", sources: dedupe(sources), model: res.model };
  }
}

class DemoSearch implements AiSearchProvider {
  readonly isDemo = true;
  readonly support = "supported" as const;
  readonly notes = "Synthetic answers for demonstration. Not a real AI response.";
  constructor(readonly id: string, readonly label: string, private target: string) {}
  async ask(query: string) {
    const h = createHash("sha256").update(`${this.id}|${query}`).digest();
    const names = ["Demo Listing North", "Demo Listing South", "Demo Listing East", "Demo Listing West"];
    const list = names.slice(0, 3);
    if (h[0] % 3 !== 0) list.splice(h[1] % 4, 0, this.target);
    return {
      text: `[DEMO RESPONSE — not from a real AI service]\nHere are some options:\n${list.map((n, i) => `${i + 1}. **${n}** - a local provider.`).join("\n")}`,
      sources: [],
      model: "demo",
    };
  }
}

class Unsupported implements AiSearchProvider {
  readonly isDemo = false;
  readonly support = "unsupported" as const;
  constructor(readonly id: string, readonly label: string, readonly notes: string) {}
  async ask(): Promise<AiSearchAnswer> {
    throw new Error(this.notes);
  }
}

function dedupe(s: { url: string; title?: string }[]) {
  const seen = new Set<string>();
  return s.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

export const AI_SEARCH_PROVIDER_IDS = ["anthropic", "openai", "gemini", "perplexity", "llama"] as const;

export function getAiSearchProvider(id: string, targetName: string): AiSearchProvider {
  const e = env();
  switch (id) {
    case "anthropic":
      if (e.ANTHROPIC_API_KEY) return new AnthropicSearch(e.ANTHROPIC_API_KEY, e.AI_MODEL);
      break;
    case "openai":
      if (e.OPENAI_API_KEY) return new OpenAiSearch(e.OPENAI_API_KEY, e.AI_VISIBILITY_OPENAI_MODEL);
      break;
    case "gemini":
      if (e.GEMINI_API_KEY) return new GeminiSearch(e.GEMINI_API_KEY, e.AI_VISIBILITY_GEMINI_MODEL);
      break;
    case "perplexity":
      if (e.PERPLEXITY_API_KEY) return new PerplexitySearch(e.PERPLEXITY_API_KEY, e.AI_VISIBILITY_PERPLEXITY_MODEL);
      break;
    case "llama":
      return new Unsupported("llama", "Llama (Meta AI)", "Meta AI has no public API for web-grounded answers, so this provider cannot be audited reliably.");
  }
  const labels: Record<string, string> = { anthropic: "Claude", openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };
  if (e.DEMO_MODE) return new DemoSearch(id, `${labels[id] ?? id} (demo)`, targetName);
  const keyName: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", perplexity: "PERPLEXITY_API_KEY" };
  return new Unsupported(id, labels[id] ?? id, `Not configured. Set ${keyName[id] ?? "an API key"} to audit ${labels[id] ?? id}.`);
}
