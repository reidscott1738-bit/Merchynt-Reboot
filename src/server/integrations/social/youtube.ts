import { httpJson } from "../http";
import { AppError, TransientError } from "../../errors";

export async function getMyChannel(token: string) {
  const res = await httpJson<{ items?: { id: string; snippet: { title: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${token}` } });
  return res.items?.[0] ?? null;
}

/** Resumable upload. Vertical videos under 60s are surfaced by YouTube as Shorts. */
export async function uploadVideo(token: string, file: Buffer, meta: { title: string; description: string; privacy: "public" | "unlisted" | "private"; isShort: boolean }) {
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-upload-content-type": "video/mp4", "x-upload-content-length": String(file.length) },
    body: JSON.stringify({
      snippet: { title: meta.title.slice(0, 100), description: `${meta.description}${meta.isShort ? "\n#Shorts" : ""}`.slice(0, 5000), categoryId: "22" },
      status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) {
    const t = await init.text();
    if (init.status >= 500 || init.status === 429) throw new TransientError(`YouTube upload init failed: ${init.status}`);
    throw new AppError(`YouTube upload init failed (${init.status}): ${t.slice(0, 200)}`, init.status === 401 || init.status === 403 ? "not_configured" : "external");
  }
  const location = init.headers.get("location");
  if (!location) throw new TransientError("YouTube did not return an upload URL");
  const up = await fetch(location, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(file) });
  if (!up.ok) throw new TransientError(`YouTube upload failed: ${up.status}`);
  const v = (await up.json()) as { id: string };
  return { providerId: v.id, url: meta.isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}` };
}
