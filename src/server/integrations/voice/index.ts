import { env } from "../../env";
import { AppError, TransientError } from "../../errors";

export const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Calm, warm female" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Soft, friendly female" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep, confident male" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Well-rounded male" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "Young, energetic male" },
];

export function voiceProviderStatus() {
  return env().ELEVENLABS_API_KEY ? { configured: true, label: `ElevenLabs (${env().ELEVENLABS_MODEL})` } : { configured: false, label: "Not configured: videos render without narration audio" };
}

/** Applies pronunciation overrides like "Merchynt → Mer-chint" before synthesis. */
export function applyPronunciation(text: string, overrides: { term: string; say: string }[] | null | undefined): string {
  let out = text;
  for (const o of overrides ?? []) {
    if (!o.term.trim()) continue;
    out = out.replace(new RegExp(`\\b${o.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), o.say);
  }
  return out;
}

export async function synthesize(input: { text: string; voiceId: string; deliveryInstruction?: string | null }): Promise<Buffer> {
  const key = env().ELEVENLABS_API_KEY;
  if (!key) throw new AppError("No voice provider configured. Set ELEVENLABS_API_KEY.", "not_configured");
  const model = env().ELEVENLABS_MODEL;
  // Audio tags for delivery direction are only understood by v3 models.
  const text = input.deliveryInstruction && /v3/.test(model) ? `[${input.deliveryInstruction}] ${input.text}` : input.text;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) throw new TransientError(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
    throw new AppError(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`, res.status === 401 ? "not_configured" : "external");
  }
  return Buffer.from(await res.arrayBuffer());
}
