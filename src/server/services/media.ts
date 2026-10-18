import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import exifr from "exifr";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { businessLocations, integrations, mediaAssets, mediaUsages, mediaVariants, uploadLinks, type BrandingOptions } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { AppError, invalid, notFound } from "../errors";
import { randomToken, sha256 } from "../security/crypto";
import { storage } from "../storage";
import { enqueue } from "../jobs/queue";
import { loadBusinessContext } from "../ai/context";
import { describeImage } from "../ai/tasks";
import { recordAiUsage } from "./usage";
import { notifyOrgUsers } from "./notifications";
import { safeFetch } from "../security/safe-fetch";
import { getAccessToken } from "../integrations/oauth";
import * as companycam from "../integrations/companycam";
import * as gbp from "../integrations/google/gbp";
import { escapeHtml, slugify } from "@/lib/text";

const run = promisify(execFile);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

/** Detects type from magic bytes; the client-supplied mime type is never trusted. */
export function sniffMime(buf: Buffer): { kind: "image" | "video" | "audio"; mime: string; ext: string } | null {
  const hex = buf.subarray(0, 16).toString("hex");
  const ascii = buf.subarray(0, 16).toString("latin1");
  if (hex.startsWith("ffd8ff")) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (hex.startsWith("89504e470d0a1a0a")) return { kind: "image", mime: "image/png", ext: "png" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (ascii.slice(4, 8) === "ftyp") {
    const brand = ascii.slice(8, 12);
    if (["heic", "heix", "mif1", "heis"].includes(brand)) return { kind: "image", mime: "image/heic", ext: "heic" };
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    if (brand.startsWith("M4A")) return { kind: "audio", mime: "audio/mp4", ext: "m4a" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  if (hex.startsWith("1a45dfa3")) return { kind: "video", mime: "video/webm", ext: "webm" };
  if (ascii.startsWith("ID3") || hex.startsWith("fffb") || hex.startsWith("fff3")) return { kind: "audio", mime: "audio/mpeg", ext: "mp3" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { kind: "audio", mime: "audio/wav", ext: "wav" };
  return null;
}

/** Reads capture metadata that is genuinely present in the file. Nothing is inferred or synthesized. */
export async function readExif(buf: Buffer): Promise<{ lat: number | null; lng: number | null; takenAt: Date | null; raw: Record<string, unknown> | null }> {
  try {
    const data = (await exifr.parse(buf, { gps: true, pick: ["Make", "Model", "DateTimeOriginal", "CreateDate", "latitude", "longitude", "GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef", "Orientation", "Software"] })) as Record<string, unknown> | undefined;
    if (!data) return { lat: null, lng: null, takenAt: null, raw: null };
    const lat = typeof data.latitude === "number" && Number.isFinite(data.latitude) ? data.latitude : null;
    const lng = typeof data.longitude === "number" && Number.isFinite(data.longitude) ? data.longitude : null;
    const t = (data.DateTimeOriginal ?? data.CreateDate) as Date | undefined;
    const raw: Record<string, unknown> = {};
    for (const k of ["Make", "Model", "Software", "Orientation"]) if (data[k] != null) raw[k] = data[k];
    if (t instanceof Date && !Number.isNaN(t.getTime())) raw.DateTimeOriginal = t.toISOString();
    return { lat, lng, takenAt: t instanceof Date && !Number.isNaN(t.getTime()) ? t : null, raw };
  } catch {
    return { lat: null, lng: null, takenAt: null, raw: null };
  }
}

const VARIANTS = [
  { variant: "thumb" as const, width: 360, height: 360, fit: "inside" as const },
  { variant: "web" as const, width: 1600, height: 1600, fit: "inside" as const },
  { variant: "square" as const, width: 1080, height: 1080, fit: "cover" as const },
];

/** Public variants are re-encoded without metadata, so EXIF (including GPS) never leaves through them. */
async function buildImageVariants(asset: MediaAsset, buf: Buffer) {
  for (const v of VARIANTS) {
    const out = await sharp(buf, { failOn: "error" }).rotate().resize({ width: v.width, height: v.height, fit: v.fit, withoutEnlargement: v.fit === "inside" }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const key = `media/${asset.businessId}/${asset.id}/${v.variant}.jpg`;
    await storage().put(key, out.data, "image/jpeg");
    await db
      .insert(mediaVariants)
      .values({ assetId: asset.id, variant: v.variant, storageKey: key, mime: "image/jpeg", width: out.info.width, height: out.info.height, bytes: out.info.size })
      .onConflictDoUpdate({ target: [mediaVariants.assetId, mediaVariants.variant], set: { storageKey: key, width: out.info.width, height: out.info.height, bytes: out.info.size } });
  }
}

export async function probeVideo(file: string): Promise<{ durationMs: number | null; width: number | null; height: number | null }> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeout: 30_000 });
    const j = JSON.parse(stdout) as { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } };
    const vs = j.streams?.find((s) => s.codec_type === "video");
    return { durationMs: j.format?.duration ? Math.round(Number(j.format.duration) * 1000) : null, width: vs?.width ?? null, height: vs?.height ?? null };
  } catch {
    return { durationMs: null, width: null, height: null };
  }
}

async function videoThumbnail(asset: MediaAsset, file: string) {
  const dir = path.dirname(file);
  const thumb = path.join(dir, "thumb.jpg");
  try {
    await run("ffmpeg", ["-y", "-ss", "0.5", "-i", file, "-frames:v", "1", "-vf", "scale=720:-2", thumb], { timeout: 60_000 });
    await buildImageVariants(asset, await readFile(thumb));
  } catch {
    /* A missing thumbnail is cosmetic; the asset stays usable. */
  }
}

export type IngestInput = {
  businessId: string;
  data: Buffer;
  filename?: string | null;
  source: MediaAsset["source"];
  uploadedByUserId?: string | null;
  contributorName?: string | null;
  contributorEmail?: string | null;
  consent?: MediaAsset["consent"];
  moderationStatus?: MediaAsset["moderationStatus"];
  attribution?: string | null;
  externalRef?: string | null;
  tags?: string[];
  caption?: string | null;
  isAiGenerated?: boolean;
  parentAssetId?: string | null;
  describe?: boolean;
};

/** Validates, de-duplicates and stores a file, then builds variants. */
export async function ingestMedia(input: IngestInput): Promise<{ asset: MediaAsset; duplicate: boolean }> {
  const sniff = sniffMime(input.data);
  if (!sniff) throw invalid("Unsupported file type. Upload JPEG, PNG, WebP, GIF, HEIC, MP4, MOV, WebM, MP3, M4A or WAV.");
  const limit = sniff.kind === "image" ? MAX_IMAGE_BYTES : sniff.kind === "video" ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (input.data.byteLength > limit) throw invalid(`File is larger than the ${Math.round(limit / 1024 / 1024)} MB limit for ${sniff.kind}s`);
  const hash = sha256(input.data);
  const [dup] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.businessId, input.businessId), eq(mediaAssets.sha256, hash))).limit(1);
  if (dup) {
    if (dup.deletedAt) {
      const [restored] = await db.update(mediaAssets).set({ deletedAt: null }).where(eq(mediaAssets.id, dup.id)).returning();
      return { asset: restored, duplicate: true };
    }
    return { asset: dup, duplicate: true };
  }

  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let exif: Awaited<ReturnType<typeof readExif>> = { lat: null, lng: null, takenAt: null, raw: null };
  let data = input.data;
  let mime = sniff.mime;
  let ext = sniff.ext;

  if (sniff.kind === "image") {
    exif = await readExif(input.data);
    try {
      const meta = await sharp(input.data, { failOn: "error" }).metadata();
      if (!meta.width || !meta.height) throw new Error("no dimensions");
      if (meta.width * meta.height > 80_000_000) throw invalid("Image dimensions are too large");
      const rotated = (meta.orientation ?? 1) >= 5;
      width = rotated ? meta.height : meta.width;
      height = rotated ? meta.width : meta.height;
      if (sniff.mime === "image/heic") {
        // Store a JPEG master for HEIC so every consumer can read it; original EXIF is preserved in the JPEG.
        data = await sharp(input.data).rotate().jpeg({ quality: 92 }).withMetadata().toBuffer();
        mime = "image/jpeg";
        ext = "jpg";
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw invalid("The image could not be read; it may be corrupted");
    }
  }

  const base = slugify(path.parse(input.filename ?? "").name || `${sniff.kind}`, 50) || sniff.kind;
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      businessId: input.businessId,
      kind: sniff.kind,
      source: input.source,
      storageKey: "pending",
      mime,
      bytes: data.byteLength,
      width,
      height,
      sha256: hash,
      originalFilename: input.filename ?? null,
      description: input.caption ?? null,
      descriptionSource: input.caption ? "user" : "none",
      exifLat: exif.lat,
      exifLng: exif.lng,
      exifTakenAt: exif.takenAt,
      exif: exif.raw,
      uploadedByUserId: input.uploadedByUserId ?? null,
      contributorName: input.contributorName ?? null,
      contributorEmail: input.contributorEmail ?? null,
      consent: input.consent ?? null,
      moderationStatus: input.moderationStatus ?? "approved",
      attribution: input.attribution ?? null,
      externalRef: input.externalRef ?? null,
      tags: input.tags ?? [],
      isAiGenerated: input.isAiGenerated ?? false,
      parentAssetId: input.parentAssetId ?? null,
      useForGoogleMedia: !(input.isAiGenerated ?? false),
    })
    .onConflictDoNothing({ target: [mediaAssets.businessId, mediaAssets.sha256] })
    .returning();
  if (!asset) {
    const [again] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.businessId, input.businessId), eq(mediaAssets.sha256, hash))).limit(1);
    return { asset: again, duplicate: true };
  }
  const key = `media/${input.businessId}/${asset.id}/original.${ext}`;
  await storage().put(key, data, mime);

  if (sniff.kind === "image") {
    await buildImageVariants(asset, data);
  } else if (sniff.kind === "video" || sniff.kind === "audio") {
    const dir = await mkdtemp(path.join(tmpdir(), "lp-media-"));
    const file = path.join(dir, `in.${ext}`);
    await writeFile(file, data);
    const p = await probeVideo(file);
    durationMs = p.durationMs;
    width = p.width;
    height = p.height;
    if (sniff.kind === "video") await videoThumbnail(asset, file);
    await rm(dir, { recursive: true, force: true });
  }
  const [saved] = await db.update(mediaAssets).set({ storageKey: key, durationMs, width, height }).where(eq(mediaAssets.id, asset.id)).returning();
  if (sniff.kind === "image" && input.describe !== false) {
    await enqueue("media.describe", { assetId: asset.id }, { idempotencyKey: `media-describe:${asset.id}`, businessId: input.businessId });
  }
  return { asset: saved, duplicate: false };
}

/** Fills SEO filename, alt text and description with AI only where a person has not. */
export async function describeAsset(assetId: string) {
  const [a] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!a || a.deletedAt) return;
  if (a.seoFilename && a.altText && a.descriptionSource === "user") return;
  const ctx = await loadBusinessContext(a.businessId, ["general"]);
  const { data, meta } = await describeImage(ctx, { originalFilename: a.originalFilename, userCaption: a.descriptionSource === "user" ? a.description : null, tags: a.tags });
  await db
    .update(mediaAssets)
    .set({
      seoFilename: a.seoFilename ?? slugify(data.seoFilename, 60),
      altText: a.altText ?? data.altText.slice(0, 125),
      description: a.descriptionSource === "user" ? a.description : data.description,
      descriptionSource: a.descriptionSource === "user" ? "user" : "ai",
    })
    .where(eq(mediaAssets.id, a.id));
  await recordAiUsage(ctx.business.orgId, a.businessId, meta);
}

/* ---------------- Library ---------------- */

export type MediaFilters = { kind?: "image" | "video" | "audio" | "all"; source?: string; moderation?: "pending" | "approved" | "rejected" | "all"; q?: string; usage?: "posts" | "website" | "videos" | "google" };

export async function listMedia(actor: Actor, businessId: string, f: MediaFilters = {}, limit = 200) {
  await requireBusiness(actor, businessId);
  const conds: SQL[] = [eq(mediaAssets.businessId, businessId), isNull(mediaAssets.deletedAt)];
  if (f.kind && f.kind !== "all") conds.push(eq(mediaAssets.kind, f.kind));
  if (f.source) conds.push(eq(mediaAssets.source, f.source as MediaAsset["source"]));
  if (f.moderation && f.moderation !== "all") conds.push(eq(mediaAssets.moderationStatus, f.moderation));
  if (f.q) conds.push(or(ilike(mediaAssets.originalFilename, `%${f.q}%`), ilike(mediaAssets.altText, `%${f.q}%`), ilike(mediaAssets.description, `%${f.q}%`))!);
  if (f.usage === "posts") conds.push(eq(mediaAssets.useForPosts, true));
  if (f.usage === "website") conds.push(eq(mediaAssets.useForWebsite, true));
  if (f.usage === "videos") conds.push(eq(mediaAssets.useForVideos, true));
  if (f.usage === "google") conds.push(eq(mediaAssets.useForGoogleMedia, true));
  const rows = await db.select().from(mediaAssets).where(and(...conds)).orderBy(desc(mediaAssets.createdAt)).limit(limit);
  const ids = rows.map((r) => r.id);
  const usage = ids.length
    ? await db.select({ assetId: mediaUsages.assetId, count: sql<number>`count(*)::int`, last: sql<Date>`max(${mediaUsages.usedAt})` }).from(mediaUsages).where(inArray(mediaUsages.assetId, ids)).groupBy(mediaUsages.assetId)
    : [];
  const byId = new Map(usage.map((u) => [u.assetId, u]));
  return rows.map((r) => ({ ...r, usageCount: byId.get(r.id)?.count ?? 0, lastUsedAt: byId.get(r.id)?.last ?? null }));
}

export async function getMedia(actor: Actor, businessId: string, assetId: string) {
  await requireBusiness(actor, businessId);
  const [a] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.businessId, businessId))).limit(1);
  if (!a) throw notFound("Media");
  const usages = await db.select().from(mediaUsages).where(eq(mediaUsages.assetId, a.id)).orderBy(desc(mediaUsages.usedAt)).limit(50);
  return { asset: a, usages };
}

export type MediaUpdate = Partial<Pick<MediaAsset, "altText" | "seoFilename" | "description" | "assocLabel" | "assocLat" | "assocLng" | "useForPosts" | "useForWebsite" | "useForVideos" | "useForGoogleMedia" | "tags" | "attribution">>;

export async function updateMedia(actor: Actor, businessId: string, assetId: string, patch: MediaUpdate) {
  await requireBusiness(actor, businessId, "media.manage");
  const set: Partial<MediaAsset> = { ...patch };
  if (patch.description !== undefined) set.descriptionSource = patch.description ? "user" : "none";
  if (patch.seoFilename) set.seoFilename = slugify(patch.seoFilename, 60);
  if (patch.altText) set.altText = patch.altText.slice(0, 250);
  if ((patch.assocLat == null) !== (patch.assocLng == null)) throw invalid("Provide both latitude and longitude for the associated location");
  const [a] = await db.update(mediaAssets).set(set).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.businessId, businessId))).returning();
  if (!a) throw notFound("Media");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "media.updated", target: { type: "media", id: a.id }, detail: { fields: Object.keys(patch) } });
  return a;
}

export async function moderateMedia(actor: Actor, businessId: string, assetId: string, decision: "approved" | "rejected", notes?: string) {
  await requireBusiness(actor, businessId, "media.approve");
  const [a] = await db.update(mediaAssets).set({ moderationStatus: decision, moderationNotes: notes ?? null }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.businessId, businessId))).returning();
  if (!a) throw notFound("Media");
  const { completeTaskForRef } = await import("./tasks");
  await completeTaskForRef("media_asset", a.id, { decision }, "completed");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: `media.${decision}`, target: { type: "media", id: a.id } });
  return a;
}

export async function deleteMedia(actor: Actor, businessId: string, assetId: string) {
  await requireBusiness(actor, businessId, "media.manage");
  const [a] = await db.update(mediaAssets).set({ deletedAt: new Date(), useForPosts: false, useForWebsite: false, useForVideos: false, useForGoogleMedia: false }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.businessId, businessId))).returning();
  if (!a) throw notFound("Media");
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "media.deleted", target: { type: "media", id: a.id } });
}

export async function recordMediaUsage(assetId: string, businessId: string, usageType: (typeof mediaUsages.$inferInsert)["usageType"], refId: string | null) {
  await db.insert(mediaUsages).values({ assetId, businessId, usageType, refId });
}

/**
 * Chooses an image for a post: approved, allowed for posts, not used for a
 * post within the reuse window, least recently used first. Returns null when
 * nothing qualifies rather than reusing against the rule.
 */
export async function selectImageForPost(businessId: string, opts: { sources: MediaAsset["source"][]; reuseDays: number; excludeIds?: string[] }) {
  const since = new Date(Date.now() - opts.reuseDays * 24 * 3600 * 1000);
  const recentlyUsed = db.select({ id: mediaUsages.assetId }).from(mediaUsages).where(and(eq(mediaUsages.businessId, businessId), eq(mediaUsages.usageType, "post"), gte(mediaUsages.usedAt, since)));
  const lastUse = sql<Date | null>`(select max(${mediaUsages.usedAt}) from ${mediaUsages} where ${mediaUsages.assetId} = ${mediaAssets.id} and ${mediaUsages.usageType} = 'post')`;
  const conds: SQL[] = [
    eq(mediaAssets.businessId, businessId),
    eq(mediaAssets.kind, "image"),
    isNull(mediaAssets.deletedAt),
    eq(mediaAssets.moderationStatus, "approved"),
    eq(mediaAssets.useForPosts, true),
    inArray(mediaAssets.source, opts.sources),
  ];
  if (opts.reuseDays > 0) conds.push(notInArray(mediaAssets.id, recentlyUsed));
  if (opts.excludeIds?.length) conds.push(notInArray(mediaAssets.id, opts.excludeIds));
  const [pick] = await db.select().from(mediaAssets).where(and(...conds)).orderBy(sql`${lastUse} asc nulls first`, asc(mediaAssets.createdAt)).limit(1);
  return pick ?? null;
}

/* ---------------- Branded images ---------------- */

export const CTA_LABELS: Record<string, string> = { LEARN_MORE: "Learn more", CALL: "Call now", BOOK: "Book today", ORDER: "Order online", SHOP: "Shop now", SIGN_UP: "Sign up" };

/**
 * Composites a branded version of a photo (gradient, CTA text, logo). The
 * result is a new asset linked to its parent; the original is untouched.
 */
export async function createBrandedImage(sourceAssetId: string, branding: BrandingOptions) {
  const [src] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, sourceAssetId)).limit(1);
  if (!src || src.kind !== "image") throw invalid("Branded images need a source photo");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, src.businessId)).limit(1);
  const W = 1200;
  const H = 900;
  const base = await sharp(await storage().get(src.storageKey)).rotate().resize(W, H, { fit: "cover" }).toBuffer();
  const color = b.brand?.primaryColor ?? "#1d4ed8";
  const text = escapeHtml((branding.customCta || CTA_LABELS[branding.cta] || branding.cta).slice(0, 40));
  const name = escapeHtml(b.name.slice(0, 48));
  const opacity = Math.min(0.85, Math.max(0, branding.overlayOpacity));
  const bandY = branding.textPosition === "top" ? 0 : branding.textPosition === "center" ? H / 2 - 120 : H - 240;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="${branding.textPosition === "top" ? 0 : 1}" x2="0" y2="${branding.textPosition === "top" ? 1 : 0}"><stop offset="0" stop-color="#000" stop-opacity="${opacity}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect x="0" y="${bandY}" width="${W}" height="240" fill="url(#g)"/>
    <text x="60" y="${bandY + 110}" font-family="DejaVu Sans, Arial, sans-serif" font-size="58" font-weight="700" fill="#fff">${name}</text>
    <rect x="60" y="${bandY + 138}" rx="12" width="${Math.max(220, text.length * 24 + 60)}" height="66" fill="${escapeHtml(color)}"/>
    <text x="90" y="${bandY + 183}" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" font-weight="700" fill="#fff">${text}</text>
  </svg>`;
  const layers: OverlayOptions[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (branding.logoPosition !== "none" && b.logoAssetId) {
    const [logo] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, b.logoAssetId)).limit(1);
    if (logo) {
      const lb = await sharp(await storage().get(logo.storageKey)).resize(200, 120, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
      const pad = 40;
      const left = branding.logoPosition.endsWith("left") ? pad : W - lb.info.width - pad;
      const top = branding.logoPosition.startsWith("top") ? pad : H - lb.info.height - pad;
      layers.push({ input: lb.data, top, left });
    }
  }
  const out = await sharp(base).composite(layers).jpeg({ quality: 88 }).toBuffer();
  const { asset } = await ingestMedia({
    businessId: src.businessId,
    data: out,
    filename: `${src.seoFilename ?? "photo"}-branded.jpg`,
    source: "branded",
    parentAssetId: src.id,
    tags: [...src.tags, "branded"],
    caption: src.description,
    describe: false,
  });
  if (!asset.altText && src.altText) await db.update(mediaAssets).set({ altText: src.altText, seoFilename: src.seoFilename ? `${src.seoFilename}-branded` : null, useForGoogleMedia: false }).where(eq(mediaAssets.id, asset.id));
  return asset;
}

/* ---------------- Upload links (Photo uploads from staff or customers) ---------------- */

export async function createUploadLink(actor: Actor, businessId: string, input: { label: string; requireApproval: boolean; expiresInDays: number }) {
  await requireBusiness(actor, businessId, "media.manage");
  const token = randomToken(24);
  const [link] = await db
    .insert(uploadLinks)
    .values({ businessId, tokenHash: sha256(token), label: input.label.slice(0, 80), requireApproval: input.requireApproval, expiresAt: new Date(Date.now() + Math.min(Math.max(input.expiresInDays, 1), 90) * 86400_000), createdByUserId: actor.userId })
    .returning();
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "upload_link.created", target: { type: "upload_link", id: link.id } });
  return { link, token };
}

export async function listUploadLinks(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(uploadLinks).where(eq(uploadLinks.businessId, businessId)).orderBy(desc(uploadLinks.createdAt));
}

export async function revokeUploadLink(actor: Actor, businessId: string, linkId: string) {
  await requireBusiness(actor, businessId, "media.manage");
  await db.update(uploadLinks).set({ revokedAt: new Date() }).where(and(eq(uploadLinks.id, linkId), eq(uploadLinks.businessId, businessId)));
}

export async function lookupUploadLink(token: string) {
  const [link] = await db.select().from(uploadLinks).where(eq(uploadLinks.tokenHash, sha256(token))).limit(1);
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  const [b] = await db.select({ id: businessLocations.id, name: businessLocations.name, orgId: businessLocations.orgId }).from(businessLocations).where(eq(businessLocations.id, link.businessId)).limit(1);
  return { link, business: b };
}

export async function uploadViaLink(token: string, files: { data: Buffer; filename: string }[], contributor: { name?: string | null; email?: string | null; consent: boolean; caption?: string | null }) {
  const found = await lookupUploadLink(token);
  if (!found) throw new AppError("This upload link is invalid or has expired", "not_found");
  if (!contributor.consent) throw invalid("Please confirm you have the right to share these photos");
  if (files.length > 20) throw invalid("Upload up to 20 files at a time");
  const results = [];
  for (const f of files) {
    const { asset, duplicate } = await ingestMedia({
      businessId: found.link.businessId,
      data: f.data,
      filename: f.filename,
      source: "upload_link",
      contributorName: contributor.name ?? null,
      contributorEmail: contributor.email ?? null,
      caption: contributor.caption ?? null,
      consent: { marketingUse: true, capturedAt: new Date().toISOString(), text: "Contributor confirmed they have the right to share these photos for this business's marketing." },
      moderationStatus: found.link.requireApproval ? "pending" : "approved",
    });
    results.push({ id: asset.id, duplicate });
  }
  await db.update(uploadLinks).set({ uploadsCount: sql`${uploadLinks.uploadsCount} + ${results.length}` }).where(eq(uploadLinks.id, found.link.id));
  if (found.link.requireApproval && results.some((r) => !r.duplicate)) {
    await notifyOrgUsers(found.business.orgId, found.business.id, { type: "media.pending", title: `${results.length} photo(s) uploaded for review`, body: `Via upload link "${found.link.label}".`, link: `/b/${found.business.id}/media?moderation=pending` });
  }
  return results;
}

/* ---------------- Imports ---------------- */

export async function importFromCompanyCam(businessId: string, integrationId: string, sinceDays = 30) {
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, integrationId)).limit(1);
  if (!integ || integ.provider !== "companycam") throw invalid("CompanyCam is not connected");
  const token = await getAccessToken(integ);
  const photos = await companycam.listRecentPhotos(token, Math.floor(Date.now() / 1000) - sinceDays * 86400);
  let imported = 0;
  for (const p of photos.slice(0, 50)) {
    const uri = companycam.bestPhotoUri(p);
    if (!uri) continue;
    const ref = `companycam:${p.id}`;
    const [exists] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.externalRef, ref))).limit(1);
    if (exists) continue;
    const res = await safeFetch(uri, { maxBytes: MAX_IMAGE_BYTES, accept: "image/*" });
    if (res.status !== 200) continue;
    await ingestMedia({ businessId, data: res.body, filename: `companycam-${p.id}.jpg`, source: "companycam", externalRef: ref, caption: p.description ?? null, attribution: "Imported from CompanyCam" });
    imported++;
  }
  return { imported, seen: photos.length };
}

export async function importFromGoogle(businessId: string) {
  const { googleContext } = await import("./integrations");
  const g = await googleContext(businessId);
  const res = await gbp.listMedia(g.token, g.v4Name);
  let imported = 0;
  for (const m of (res.mediaItems ?? []).filter((x) => x.mediaFormat === "PHOTO").slice(0, 60)) {
    const ref = `gbp:${m.name}`;
    const [exists] = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.externalRef, ref))).limit(1);
    if (exists || !m.googleUrl) continue;
    const r = await safeFetch(m.googleUrl, { maxBytes: MAX_IMAGE_BYTES, accept: "image/*" });
    if (r.status !== 200) continue;
    await ingestMedia({ businessId, data: r.body, filename: `google-photo.jpg`, source: "gbp", externalRef: ref, caption: m.description ?? null, attribution: "Imported from Google Business Profile" });
    imported++;
  }
  await logActivity({ orgId: g.business.orgId, businessId, actor: systemActor, action: "media.imported_gbp", detail: { imported } });
  return { imported };
}

/** Adds an approved photo to the Google Business Profile photo gallery. */
export async function pushPhotoToGoogle(assetId: string) {
  const [a] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!a || a.kind !== "image" || a.deletedAt) return { skipped: "missing" };
  if (a.moderationStatus !== "approved" || !a.useForGoogleMedia) return { skipped: "not allowed for Google" };
  if (a.isAiGenerated) return { skipped: "AI-generated images are not uploaded to the Google photo gallery" };
  const { googleContext } = await import("./integrations");
  const g = await googleContext(a.businessId);
  const { publicMediaUrl } = await import("../storage");
  const url = publicMediaUrl(a.id, "web", true);
  if (/\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new AppError("APP_URL must be a public address for Google to fetch photos", "not_configured");
  const res = await gbp.createMedia(g.token, g.v4Name, { sourceUrl: url, category: "ADDITIONAL", format: "PHOTO", description: a.altText ?? undefined });
  await recordMediaUsage(a.id, a.businessId, "gbp_media", null);
  await db.update(mediaAssets).set({ externalRef: a.externalRef ?? `gbp:${res.name}` }).where(eq(mediaAssets.id, a.id));
  return { name: res.name };
}
