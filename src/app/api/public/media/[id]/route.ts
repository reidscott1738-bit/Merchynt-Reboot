import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { mediaAssets, mediaVariants } from "@/server/db/schema";
import { storage, verifyMediaSignature } from "@/server/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves media by signed URL. Images are always served from a re-encoded
 * variant, never the original upload, so camera metadata (EXIF/GPS) is not exposed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const v = url.searchParams.get("v") ?? "web";
  if (!UUID.test(id) || !["web", "thumb", "square", "original"].includes(v) || !verifyMediaSignature(id, v, url.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  const [asset] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt))).limit(1);
  if (!asset || asset.storageKey === "pending") return new Response("Not found", { status: 404 });

  let key = asset.storageKey;
  let mime = asset.mime;
  if (asset.kind === "image") {
    const variant = v === "original" ? "web" : (v as "web" | "thumb" | "square");
    const [row] = await db.select().from(mediaVariants).where(and(eq(mediaVariants.assetId, id), eq(mediaVariants.variant, variant))).limit(1);
    if (!row) return new Response("Not found", { status: 404 });
    key = row.storageKey;
    mime = row.mime;
  }
  let data: Buffer;
  try {
    data = await storage().get(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "content-type": mime,
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  // Range support lets browsers seek in videos.
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    const size = data.length;
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
