import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { businessLocations, integrations, integrationTargets, mediaAssets, publicationJobs, videoProjects, videoScenes, type VideoSettings } from "../db/schema";
import { requireBusiness, type Actor } from "../authz";
import { logActivity, systemActor, userActor } from "../activity";
import { AppError, invalid, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { storage, publicMediaUrl } from "../storage";
import { loadBusinessContext } from "../ai/context";
import { generateVideoScript } from "../ai/tasks";
import { applyPronunciation, synthesize, VOICES, voiceProviderStatus } from "../integrations/voice";
import { getAccessToken } from "../integrations/oauth";
import * as youtube from "../integrations/social/youtube";
import * as meta from "../integrations/social/meta";
import * as gbp from "../integrations/google/gbp";
import { env } from "../env";
import { ingestMedia, probeVideo, recordMediaUsage } from "./media";
import { createTask, registerTaskHandler } from "./tasks";
import { queuePublication, registerPublicationRunner, type PublicationRow } from "./publishing";
import { assertWithinLimit, recordAiUsage, recordUsage } from "./usage";

const run = promisify(execFile);
export type VideoProject = typeof videoProjects.$inferSelect;
export type VideoScene = typeof videoScenes.$inferSelect;

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { bRoll: false, bRollMax: 0, textOverlay: true, imageEffects: true, logoWatermark: true, introLogo: false, music: "auto", musicVolume: 0.15, voiceIds: [VOICES[0].id] };

/** Background tracks are synthesized locally so no unlicensed music is ever used. */
export const MUSIC_TRACKS = [
  { id: "warm", label: "Warm pad (synthesized)", expr: "0.05*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.04*sin(2*PI*277.18*t)+0.035*sin(2*PI*329.63*t)" },
  { id: "bright", label: "Bright pulse (synthesized)", expr: "0.05*sin(2*PI*261.63*t)*(0.5+0.5*sin(2*PI*2*t))+0.035*sin(2*PI*329.63*t)+0.03*sin(2*PI*392*t)" },
  { id: "calm", label: "Calm drone (synthesized)", expr: "0.045*sin(2*PI*196*t)+0.03*sin(2*PI*293.66*t)*(0.7+0.3*sin(2*PI*0.1*t))" },
];

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const DIMS = { vertical: { w: 720, h: 1280 }, horizontal: { w: 1280, h: 720 } };

export const settingsSchema = z.object({
  bRoll: z.boolean(),
  bRollMax: z.number().int().min(0).max(5),
  textOverlay: z.boolean(),
  imageEffects: z.boolean(),
  logoWatermark: z.boolean(),
  introLogo: z.boolean(),
  music: z.string(),
  musicVolume: z.number().min(0).max(1),
  voiceIds: z.array(z.string()).max(3),
  voiceDirection: z.string().max(120).optional(),
  endingText: z.string().max(80).optional(),
  approvalMode: z.enum(["none", "all"]).optional(),
});

export async function createVideoProject(actor: Actor | null, businessId: string, input: { title?: string; format?: "vertical" | "horizontal"; assetIds?: string[]; brief?: string | null; sceneCount?: number; destinations?: string[]; settings?: Partial<VideoSettings> }) {
  if (actor) await requireBusiness(actor, businessId, "content.create");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  const format = input.format ?? "vertical";
  let assets;
  if (input.assetIds?.length) {
    assets = await db.select().from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), inArray(mediaAssets.id, input.assetIds), eq(mediaAssets.kind, "image"), eq(mediaAssets.moderationStatus, "approved"), isNull(mediaAssets.deletedAt)));
    if (assets.length !== new Set(input.assetIds).size) throw invalid("Every photo must be an approved image from this business's library");
    assets.sort((a, c) => input.assetIds!.indexOf(a.id) - input.assetIds!.indexOf(c.id));
  } else {
    assets = await db.select().from(mediaAssets).where(and(eq(mediaAssets.businessId, businessId), eq(mediaAssets.kind, "image"), eq(mediaAssets.moderationStatus, "approved"), eq(mediaAssets.useForVideos, true), isNull(mediaAssets.deletedAt), eq(mediaAssets.isAiGenerated, false))).orderBy(desc(mediaAssets.createdAt)).limit(input.sceneCount ?? 6);
  }
  if (assets.length < 2) throw invalid("A video needs at least two approved photos marked for video use");
  const settings = settingsSchema.parse({ ...DEFAULT_VIDEO_SETTINGS, ...(input.settings ?? {}) });
  const ctx = await loadBusinessContext(businessId, ["video_scripts", "voice_pronunciation"]);
  const script = await generateVideoScript(ctx, { sceneCount: assets.length, imageDescriptions: assets.map((a) => a.description ?? a.altText), brief: input.brief, format });
  await recordAiUsage(b.orgId, businessId, script.meta);
  const [project] = await db
    .insert(videoProjects)
    .values({ businessId, title: input.title?.trim() || `${b.name} video`, format, settings: { ...settings, endingText: settings.endingText ?? script.data.endingText }, brief: input.brief ?? null, destinations: input.destinations ?? [], createdByUserId: actor?.userId ?? null })
    .returning();
  await db.insert(videoScenes).values(
    assets.map((a, i) => ({
      projectId: project.id,
      position: i,
      mediaAssetId: a.id,
      narration: script.data.scenes[i]?.narration ?? "",
      overlayText: script.data.scenes[i]?.overlay ?? null,
      voiceId: settings.voiceIds[i % Math.max(settings.voiceIds.length, 1)] ?? VOICES[0].id,
      deliveryInstruction: settings.voiceDirection ?? null,
      effect: settings.imageEffects ? (["zoom_in", "zoom_out", "pan"] as const)[i % 3] : ("none" as const),
    })),
  );
  for (const a of assets) await recordMediaUsage(a.id, businessId, "video", project.id);
  if (actor) await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "video.created", target: { type: "video", id: project.id } });
  return project;
}

async function requireProject(actor: Actor, businessId: string, id: string, permission: "business.view" | "content.create" = "business.view") {
  await requireBusiness(actor, businessId, permission);
  const [p] = await db.select().from(videoProjects).where(and(eq(videoProjects.id, id), eq(videoProjects.businessId, businessId))).limit(1);
  if (!p) throw notFound("Video");
  return p;
}

export async function getVideoProject(actor: Actor, businessId: string, id: string) {
  const p = await requireProject(actor, businessId, id);
  const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.position));
  const pubs = await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "video_project"), eq(publicationJobs.refId, id)));
  return { project: p, scenes, publications: pubs };
}

export async function listVideoProjects(actor: Actor, businessId: string) {
  await requireBusiness(actor, businessId);
  return db.select().from(videoProjects).where(eq(videoProjects.businessId, businessId)).orderBy(desc(videoProjects.createdAt)).limit(100);
}

const EDITABLE = ["draft", "rendered", "failed", "pending_approval"];

async function bumpRevision(projectId: string) {
  const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  await db.update(videoProjects).set({ revision: p.revision + 1, status: p.status === "pending_approval" ? "draft" : p.status === "rendered" ? "draft" : p.status, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
}

export async function updateScene(actor: Actor, businessId: string, projectId: string, sceneId: string, patch: Partial<Pick<VideoScene, "narration" | "overlayText" | "voiceId" | "deliveryInstruction" | "pronunciationOverrides" | "durationMs" | "transition" | "effect" | "mediaAssetId">>) {
  const p = await requireProject(actor, businessId, projectId, "content.create");
  if (!EDITABLE.includes(p.status)) throw invalid(`A ${p.status} video cannot be edited`);
  if (patch.voiceId && !VOICES.some((v) => v.id === patch.voiceId)) throw invalid("Unknown voice");
  if (patch.durationMs != null && (patch.durationMs < 1500 || patch.durationMs > 15000)) throw invalid("Scenes run 1.5 to 15 seconds");
  if (patch.mediaAssetId) {
    const [a] = await db.select().from(mediaAssets).where(and(eq(mediaAssets.id, patch.mediaAssetId), eq(mediaAssets.businessId, businessId), eq(mediaAssets.moderationStatus, "approved"))).limit(1);
    if (!a || a.kind !== "image") throw invalid("Choose an approved photo");
  }
  const [s] = await db.update(videoScenes).set({ ...patch, updatedAt: new Date() }).where(and(eq(videoScenes.id, sceneId), eq(videoScenes.projectId, projectId))).returning();
  if (!s) throw notFound("Scene");
  await bumpRevision(projectId);
  return s;
}

export async function updateVideoSettings(actor: Actor, businessId: string, projectId: string, patch: Partial<VideoSettings> & { title?: string; destinations?: string[] }) {
  const p = await requireProject(actor, businessId, projectId, "content.create");
  if (!EDITABLE.includes(p.status)) throw invalid(`A ${p.status} video cannot be edited`);
  const { title, destinations, ...rest } = patch;
  const settings = settingsSchema.parse({ ...p.settings, ...rest });
  if (settings.music !== "auto" && settings.music !== "none" && !MUSIC_TRACKS.some((m) => m.id === settings.music)) throw invalid("Unknown music track");
  await db.update(videoProjects).set({ settings, title: title?.trim() || p.title, destinations: destinations ?? p.destinations, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
  await bumpRevision(projectId);
}

export async function moveScene(actor: Actor, businessId: string, projectId: string, sceneId: string, dir: -1 | 1) {
  await requireProject(actor, businessId, projectId, "content.create");
  const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.position));
  const i = scenes.findIndex((s) => s.id === sceneId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scenes.length) return;
  await db.update(videoScenes).set({ position: scenes[j].position }).where(eq(videoScenes.id, scenes[i].id));
  await db.update(videoScenes).set({ position: scenes[i].position }).where(eq(videoScenes.id, scenes[j].id));
  await bumpRevision(projectId);
}

export async function removeScene(actor: Actor, businessId: string, projectId: string, sceneId: string) {
  await requireProject(actor, businessId, projectId, "content.create");
  const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId));
  if (scenes.length <= 2) throw invalid("A video needs at least two scenes");
  await db.delete(videoScenes).where(and(eq(videoScenes.id, sceneId), eq(videoScenes.projectId, projectId)));
  await bumpRevision(projectId);
}

export async function requestRender(actor: Actor | null, businessId: string, projectId: string) {
  const p = actor ? await requireProject(actor, businessId, projectId, "content.create") : (await db.select().from(videoProjects).where(eq(videoProjects.id, projectId)))[0];
  if (p.status === "rendering") return p;
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, businessId)).limit(1);
  await assertWithinLimit(b.orgId, "video_render", 1);
  await db.update(videoProjects).set({ status: "rendering", renderError: null }).where(eq(videoProjects.id, projectId));
  await enqueue("video.render", { projectId, revision: p.revision }, { idempotencyKey: `video-render:${projectId}:${p.revision}:${Date.now()}`, queue: "media", timeoutMs: 20 * 60_000, maxAttempts: 2, businessId, orgId: b.orgId });
  return p;
}

/* ---------------- Rendering ---------------- */

const h = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

async function ff(args: string[], cwd: string) {
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as Error & { stderr?: string };
    throw new Error(`FFmpeg failed: ${(err.stderr ?? err.message).slice(-600)}`);
  }
}

async function audioDurationMs(file: string) {
  const p = await probeVideo(file);
  return p.durationMs ?? 0;
}

function effectFilter(effect: VideoScene["effect"], frames: number, w: number, hgt: number) {
  const base = `scale=${w * 2}:${hgt * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${hgt * 2}`;
  switch (effect) {
    case "zoom_in":
      return `${base},zoompan=z='min(zoom+0.0009,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${hgt}:fps=30`;
    case "zoom_out":
      return `${base},zoompan=z='if(eq(on,0),1.15,max(zoom-0.0009,1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${hgt}:fps=30`;
    case "pan":
      return `${base},zoompan=z=1.12:x='(iw-iw/zoom)*on/${Math.max(frames, 1)}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${hgt}:fps=30`;
    default:
      return `scale=${w}:${hgt}:force_original_aspect_ratio=increase,crop=${w}:${hgt},fps=30`;
  }
}

/**
 * Renders a project with FFmpeg. Narration audio and per-scene segments are
 * cached by content hash, so editing one scene only re-renders that scene.
 */
export async function renderVideo(projectId: string) {
  const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  if (!p) return { skipped: "missing" };
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, p.businessId)).limit(1);
  const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.position));
  const { w, h: H } = DIMS[p.format];
  const dir = await mkdtemp(path.join(tmpdir(), "lp-render-"));
  const log: Record<string, unknown> = { scenes: [], voice: voiceProviderStatus(), startedAt: new Date().toISOString() };
  const ctx = await loadBusinessContext(p.businessId, ["voice_pronunciation"]);
  const pronunciations = ctx.instructions.voice_pronunciation
    ? ctx.instructions.voice_pronunciation.split(/\n+/).map((l) => l.split(/\s*(?:=|→|->)\s*/)).filter((x) => x.length === 2).map(([term, say]) => ({ term, say }))
    : [];
  try {
    const segFiles: string[] = [];
    let ttsChars = 0;
    for (const s of scenes) {
      const [asset] = s.mediaAssetId ? await db.select().from(mediaAssets).where(eq(mediaAssets.id, s.mediaAssetId)).limit(1) : [null];
      if (!asset || asset.deletedAt) throw new AppError(`Scene ${s.position + 1} has no usable photo`, "invalid");

      // Narration (cached by text + voice + delivery + model)
      let audioKey: string | null = null;
      let audioMs = 0;
      const spoken = applyPronunciation(s.narration, [...pronunciations, ...(s.pronunciationOverrides ?? [])]).trim();
      if (spoken && voiceProviderStatus().configured) {
        const ah = h({ spoken, v: s.voiceId, d: s.deliveryInstruction, m: env().ELEVENLABS_MODEL });
        audioKey = `renders/${p.businessId}/${p.id}/audio-${ah}.mp3`;
        if (s.audioHash !== ah || !(await storage().exists(audioKey))) {
          const buf = await synthesize({ text: spoken, voiceId: s.voiceId ?? VOICES[0].id, deliveryInstruction: s.deliveryInstruction });
          await storage().put(audioKey, buf, "audio/mpeg");
          ttsChars += spoken.length;
          await db.update(videoScenes).set({ audioHash: ah }).where(eq(videoScenes.id, s.id));
        }
        const af = path.join(dir, `a${s.position}.mp3`);
        await writeFile(af, await storage().get(audioKey));
        audioMs = await audioDurationMs(af);
      }
      const durationMs = Math.max(s.durationMs, audioMs ? audioMs + 400 : 0);
      const segHash = h({ img: asset.sha256, audioKey, durationMs, overlay: p.settings.textOverlay ? s.overlayText : null, effect: s.effect, transition: s.transition, fmt: p.format, v: 2 });
      const segKey = `renders/${p.businessId}/${p.id}/seg-${segHash}.mp4`;
      const segFile = path.join(dir, `s${s.position}.mp4`);
      const cached = s.segmentHash === segHash && (await storage().exists(segKey));
      if (cached) {
        await writeFile(segFile, await storage().get(segKey));
      } else {
        const img = path.join(dir, `i${s.position}.jpg`);
        const [web] = await db.execute<{ storage_key: string }>(
          // Prefer the web variant (already rotated and stripped of EXIF).
          sql`select storage_key from media_variants where asset_id = ${asset.id} and variant = 'web' limit 1`,
        ).then((r) => r.rows);
        await writeFile(img, await storage().get(web?.storage_key ?? asset.storageKey));
        const secs = (durationMs / 1000).toFixed(2);
        const frames = Math.round((durationMs / 1000) * 30);
        const filters = [`[0:v]${effectFilter(s.effect, frames, w, H)},format=yuv420p[v0]`];
        let last = "v0";
        if (p.settings.textOverlay && s.overlayText) {
          await writeFile(path.join(dir, `t${s.position}.txt`), s.overlayText.slice(0, 60));
          filters.push(`[${last}]drawtext=fontfile=${FONT}:textfile=t${s.position}.txt:fontcolor=white:fontsize=${Math.round(w / 16)}:box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=h-text_h-${Math.round(H * 0.12)}[v1]`);
          last = "v1";
        }
        if (s.transition === "fade") {
          filters.push(`[${last}]fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, durationMs / 1000 - 0.35).toFixed(2)}:d=0.35[vf]`);
          last = "vf";
        }
        const audioIn = audioKey ? ["-i", `a${s.position}.mp3`] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
        filters.push(`[1:a]apad,atrim=0:${secs},aformat=sample_rates=44100:channel_layouts=stereo[a]`);
        await ff(["-loop", "1", "-t", secs, "-i", `i${s.position}.jpg`, ...audioIn, "-filter_complex", filters.join(";"), "-map", `[${last}]`, "-map", "[a]", "-t", secs, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", `s${s.position}.mp4`], dir);
        await storage().put(segKey, await readFile(segFile), "video/mp4");
        await db.update(videoScenes).set({ segmentHash: segHash }).where(eq(videoScenes.id, s.id));
      }
      segFiles.push(path.basename(segFile));
      (log.scenes as unknown[]).push({ scene: s.position + 1, durationMs, narration: Boolean(audioKey), cached });
    }

    // Closing card with the ending text.
    if (p.settings.endingText) {
      await writeFile(path.join(dir, "end.txt"), p.settings.endingText.slice(0, 60));
      const color = (b.brand?.primaryColor ?? "#1d4ed8").replace("#", "0x");
      await ff(["-f", "lavfi", "-t", "2.5", "-i", `color=c=${color}:s=${w}x${H}:r=30`, "-f", "lavfi", "-t", "2.5", "-i", "anullsrc=r=44100:cl=stereo", "-filter_complex", `[0:v]drawtext=fontfile=${FONT}:textfile=end.txt:fontcolor=white:fontsize=${Math.round(w / 14)}:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p[v]`, "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "end.mp4"], dir);
      segFiles.push("end.mp4");
    }
    await writeFile(path.join(dir, "list.txt"), segFiles.map((f) => `file '${f}'`).join("\n"));
    await ff(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "joined.mp4"], dir);

    // Final pass: music bed and logo watermark.
    const finalArgs: string[] = ["-i", "joined.mp4"];
    const fc: string[] = [];
    let vOut = "0:v";
    let aOut = "0:a";
    const track = p.settings.music === "none" ? null : (MUSIC_TRACKS.find((m) => m.id === p.settings.music) ?? MUSIC_TRACKS[0]);
    const totalMs = await audioDurationMs(path.join(dir, "joined.mp4"));
    if (track) {
      finalArgs.push("-f", "lavfi", "-t", (totalMs / 1000).toFixed(2), "-i", `aevalsrc='${track.expr}':s=44100:c=stereo`);
      fc.push(`[1:a]volume=${p.settings.musicVolume.toFixed(2)},afade=t=in:d=1,afade=t=out:st=${Math.max(0, totalMs / 1000 - 1.5).toFixed(2)}:d=1.5[m]`, `[0:a][m]amix=inputs=2:duration=first:normalize=0[aout]`);
      aOut = "[aout]";
    }
    if (p.settings.logoWatermark && b.logoAssetId) {
      const [logo] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, b.logoAssetId)).limit(1);
      if (logo) {
        await writeFile(path.join(dir, "logo.img"), await storage().get(logo.storageKey));
        const idx = track ? 2 : 1;
        finalArgs.push("-i", "logo.img");
        fc.push(`[${idx}:v]scale=${Math.round(w / 5)}:-1,format=rgba,colorchannelmixer=aa=0.85[lg]`, `[0:v][lg]overlay=W-w-${Math.round(w / 24)}:${Math.round(w / 24)}[vout]`);
        vOut = "[vout]";
      }
    }
    if (fc.length) {
      await ff([...finalArgs, "-filter_complex", fc.join(";"), "-map", vOut, "-map", aOut, "-c:v", vOut === "0:v" ? "copy" : "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "final.mp4"], dir);
    } else {
      await ff(["-i", "joined.mp4", "-c", "copy", "-movflags", "+faststart", "final.mp4"], dir);
    }
    const out = await readFile(path.join(dir, "final.mp4"));
    const { asset } = await ingestMedia({ businessId: p.businessId, data: out, filename: `${p.title}.mp4`, source: "render", describe: false, tags: ["video"] });
    await db.update(mediaAssets).set({ useForPosts: false, useForWebsite: true, useForVideos: false, useForGoogleMedia: true, altText: p.title }).where(eq(mediaAssets.id, asset.id));
    log.finishedAt = new Date().toISOString();
    log.durationMs = totalMs;
    await recordUsage(b.orgId, b.id, "video_render", 1, "ffmpeg", { ttsChars });
    const requiresApproval = p.settings.approvalMode !== "none";
    await db.update(videoProjects).set({ status: requiresApproval ? "pending_approval" : "approved", outputAssetId: asset.id, renderedRevision: p.revision, renderLog: log, renderError: null, updatedAt: new Date() }).where(eq(videoProjects.id, p.id));
    if (requiresApproval) {
      const task = await createTask({ orgId: b.orgId, businessId: b.id, type: "video", title: `Approve video: ${p.title}`, summary: voiceProviderStatus().configured ? undefined : "No voice provider is configured, so this video has music but no narration.", refType: "video_project", refId: p.id });
      await db.update(videoProjects).set({ taskId: task.id }).where(eq(videoProjects.id, p.id));
    } else if (p.destinations.length) {
      await publishVideo(p.id);
    }
    return { assetId: asset.id, durationMs: totalMs };
  } catch (e) {
    await db.update(videoProjects).set({ status: "failed", renderError: (e as Error).message.slice(0, 1000), renderLog: log }).where(eq(videoProjects.id, p.id));
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ---------------- Publishing ---------------- */

export async function publishVideo(projectId: string) {
  const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  if (!p?.outputAssetId) throw invalid("Render the video first");
  if (p.renderedRevision !== p.revision) throw invalid("The video changed after it was rendered; render it again");
  const [b] = await db.select().from(businessLocations).where(eq(businessLocations.id, p.businessId)).limit(1);
  const dests = p.destinations.filter((d): d is "google" | "youtube" | "facebook" | "instagram" => ["google", "youtube", "facebook", "instagram"].includes(d));
  if (!dests.length) return [];
  await db.update(videoProjects).set({ status: "publishing" }).where(eq(videoProjects.id, p.id));
  const rows = [];
  for (const d of dests) rows.push(await queuePublication({ businessId: p.businessId, orgId: b.orgId, kind: "video", refType: "video_project", refId: p.id, destination: d, idempotencyKey: `video:${p.id}:${p.revision}:${d}` }));
  return rows;
}

async function target(businessId: string, type: (typeof integrationTargets.$inferSelect)["targetType"]) {
  const [row] = await db.select({ t: integrationTargets, i: integrations }).from(integrationTargets).innerJoin(integrations, eq(integrations.id, integrationTargets.integrationId)).where(and(eq(integrationTargets.businessId, businessId), eq(integrationTargets.targetType, type), eq(integrationTargets.enabled, true))).limit(1);
  return row && row.i.status !== "revoked" ? row : null;
}

function publicVideoUrl(assetId: string) {
  const url = publicMediaUrl(assetId, "original", true);
  if (/\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new AppError("APP_URL must be a public address so the platform can fetch the video", "not_configured");
  return url;
}

registerPublicationRunner("video", async (pub: PublicationRow) => {
  const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, pub.refId)).limit(1);
  if (!p?.outputAssetId) throw new AppError("Video output is missing", "not_configured");
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, p.outputAssetId)).limit(1);
  const description = p.brief ?? p.title;
  const demo = () => ({ providerId: null, providerUrl: null, isDemo: true, response: { demo: true, note: `Demo mode: this video was not uploaded to ${pub.destination}.` } });
  switch (pub.destination) {
    case "youtube": {
      const t = await target(pub.businessId, "youtube_channel");
      if (!t) {
        if (env().DEMO_MODE) return demo();
        throw new AppError("No YouTube channel is linked to this business", "not_configured");
      }
      const res = await youtube.uploadVideo(await getAccessToken(t.i), await storage().get(asset.storageKey), { title: p.title, description, privacy: "public", isShort: p.format === "vertical" && (asset.durationMs ?? 0) <= 60_000 });
      return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
    }
    case "facebook": {
      const t = await target(pub.businessId, "facebook_page");
      if (!t) {
        if (env().DEMO_MODE) return demo();
        throw new AppError("No Facebook Page is linked to this business", "not_configured");
      }
      const pageToken = await meta.getPageToken(await getAccessToken(t.i), t.t.externalId);
      const res = await meta.publishFacebookVideo(pageToken, t.t.externalId, { fileUrl: publicVideoUrl(asset.id), description, title: p.title });
      return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
    }
    case "instagram": {
      const t = await target(pub.businessId, "instagram_account");
      if (!t) {
        if (env().DEMO_MODE) return demo();
        throw new AppError("No Instagram account is linked to this business", "not_configured");
      }
      const page = (await meta.listPages(await getAccessToken(t.i))).find((x) => x.instagram_business_account?.id === t.t.externalId);
      if (!page) throw new AppError("The Instagram account is no longer linked to a Facebook Page you manage", "not_configured");
      const res = await meta.publishInstagram(page.access_token, t.t.externalId, { caption: description, videoUrl: publicVideoUrl(asset.id) });
      return { providerId: res.providerId, providerUrl: res.url, isDemo: false };
    }
    case "google": {
      const { googleContext } = await import("./integrations");
      let g;
      try {
        g = await googleContext(pub.businessId);
      } catch (e) {
        if (env().DEMO_MODE) return demo();
        throw e;
      }
      const res = await gbp.createMedia(g.token, g.v4Name, { sourceUrl: publicVideoUrl(asset.id), category: "ADDITIONAL", format: "VIDEO", description: p.title });
      return { providerId: res.name, providerUrl: res.googleUrl ?? null, isDemo: false };
    }
    default:
      throw new AppError(`Videos cannot be published to ${pub.destination}`, "not_configured");
  }
});

/** Rolls video publication outcomes into the project status. */
export async function settleVideoStatus(projectId: string) {
  const pubs = await db.select().from(publicationJobs).where(and(eq(publicationJobs.refType, "video_project"), eq(publicationJobs.refId, projectId)));
  if (!pubs.length || pubs.some((x) => ["queued", "in_progress"].includes(x.status))) return;
  const ok = pubs.filter((x) => x.status === "succeeded").length;
  await db.update(videoProjects).set({ status: ok ? "published" : "failed", renderError: ok ? null : pubs.map((x) => `${x.destination}: ${x.lastError}`).join("; ") }).where(eq(videoProjects.id, projectId));
}

registerTaskHandler("video_project", {
  async preview(task) {
    const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, task.refId)).limit(1);
    const scenes = p ? await db.select().from(videoScenes).where(eq(videoScenes.projectId, p.id)).orderBy(asc(videoScenes.position)) : [];
    return { title: task.title, body: scenes.map((s, i) => `${i + 1}. ${s.narration}`).join("\n") || "(No narration)", imageUrl: p?.outputAssetId ? publicMediaUrl(p.outputAssetId, "thumb", true) : null, meta: { Destinations: p?.destinations.join(", ") || "None (download only)", Video: p?.outputAssetId ? publicMediaUrl(p.outputAssetId, "original", true) : "Not rendered" } };
  },
  async onApprove(task) {
    const [p] = await db.select().from(videoProjects).where(eq(videoProjects.id, task.refId)).limit(1);
    if (!p) return { skipped: "deleted" };
    if (p.renderedRevision !== p.revision) throw invalid("The video was edited after rendering; render it again before approving");
    await db.update(videoProjects).set({ status: "approved" }).where(eq(videoProjects.id, p.id));
    const pubs = await publishVideo(p.id);
    return { queued: pubs.map((x) => x.destination) };
  },
  async onReject(task) {
    await db.update(videoProjects).set({ status: "draft" }).where(eq(videoProjects.id, task.refId));
  },
});

export async function approveVideoNow(actor: Actor, businessId: string, projectId: string) {
  const p = await requireProject(actor, businessId, projectId, "content.create");
  if (!["rendered", "pending_approval", "approved"].includes(p.status)) throw invalid("Render the video first");
  const { completeTaskForRef } = await import("./tasks");
  await completeTaskForRef("video_project", p.id, { approvedBy: actor.name });
  await db.update(videoProjects).set({ status: "approved" }).where(eq(videoProjects.id, p.id));
  await logActivity({ orgId: actor.orgId, businessId, actor: userActor(actor.userId), action: "video.approved", target: { type: "video", id: p.id } });
  return publishVideo(p.id);
}

export async function runVideoAutomation(businessId: string, cfg: { format: "vertical" | "horizontal"; approvalMode: "none" | "all"; destinations: string[] }) {
  const p = await createVideoProject(null, businessId, { format: cfg.format, destinations: cfg.destinations, settings: {} });
  await db.update(videoProjects).set({ settings: { ...p.settings, approvalMode: cfg.approvalMode } }).where(eq(videoProjects.id, p.id));
  await requestRender(null, businessId, p.id);
  await logActivity({ orgId: (await db.select({ o: businessLocations.orgId }).from(businessLocations).where(eq(businessLocations.id, businessId)))[0].o, businessId, actor: systemActor, action: "video.auto_created", target: { type: "video", id: p.id } });
  return { projectId: p.id };
}
