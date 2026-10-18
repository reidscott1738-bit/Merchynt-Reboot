import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "@/server/ai/provider";

const schema = z.object({ title: z.string(), bullets: z.array(z.string()) });
const req = { task: "test", system: "Be factual.", prompt: "Write it.", schema, demo: () => ({ title: "x", bullets: [] }) };

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini provider", () => {
  it("sends the schema as structured output and parses the reply", async () => {
    const fetch = mockFetch({ candidates: [{ content: { parts: [{ text: '{"title":"Drain cleaning","bullets":["Same day"]}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, modelVersion: "gemini-2.5-flash" });
    const { data, meta } = await new GeminiProvider("k", "gemini-2.5-flash").json(req);
    expect(data).toEqual({ title: "Drain cleaning", bullets: ["Same day"] });
    expect(meta).toMatchObject({ provider: "gemini", isDemo: false, usage: { inputTokens: 10, outputTokens: 5 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    expect(body.generationConfig.responseJsonSchema.properties.title.type).toBe("string");
    expect(body.systemInstruction.parts[0].text).toBe("Be factual.");
  });

  it("rejects replies that do not match the schema instead of using them", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: '{"title":5}' }] }, finishReason: "STOP" }] });
    await expect(new GeminiProvider("k", "m").json(req)).rejects.toThrow(/expected format/);
  });

  it("reports a refused prompt and a bad key clearly", async () => {
    mockFetch({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(new GeminiProvider("k", "m").json(req)).rejects.toThrow(/declined/);
    mockFetch({ error: { message: "API key not valid" } }, 403);
    await expect(new GeminiProvider("k", "m").json(req)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
