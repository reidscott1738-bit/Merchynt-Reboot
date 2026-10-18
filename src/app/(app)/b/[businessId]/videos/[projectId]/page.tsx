import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, Card, Checkbox, Field, Flash, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Publications } from "@/components/publications";
import { businessPage, type SP } from "@/server/page-context";
import { getVideoProject, MUSIC_TRACKS } from "@/server/services/videos";
import { listMedia } from "@/server/services/media";
import { VOICES, voiceProviderStatus } from "@/server/integrations/voice";
import { publicMediaUrl } from "@/server/storage";
import { AppError } from "@/server/errors";
import { videoAction } from "../actions";

export const metadata = { title: "Video" };

export default async function VideoEditor({ params, searchParams }: { params: Promise<{ businessId: string; projectId: string }>; searchParams: SP }) {
  const { businessId, projectId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  let data: Awaited<ReturnType<typeof getVideoProject>>;
  try {
    data = await getVideoProject(actor, businessId, projectId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { project: p, scenes, publications } = data;
  const photos = await listMedia(actor, businessId, { kind: "image", moderation: "approved" }, 60);
  const back = `/b/${businessId}/videos/${p.id}`;
  const editable = can("content.create") && ["draft", "rendered", "failed", "pending_approval"].includes(p.status);
  const stale = p.renderedRevision != null && p.renderedRevision !== p.revision;
  const voice = voiceProviderStatus();
  const H = ({ sceneId }: { sceneId?: string }) => (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="projectId" value={p.id} />
      {sceneId && <input type="hidden" name="sceneId" value={sceneId} />}
    </>
  );
  const s = p.settings;
  return (
    <>
      <PageHeader
        title={p.title}
        back={{ href: `/b/${businessId}/videos`, label: "Video Studio" }}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={p.status} /> {p.format} · revision {p.revision}
            {p.taskId && p.status === "pending_approval" && (
              <Link href={`/tasks/${p.taskId}`} className="text-blue-700 underline">
                approval task
              </Link>
            )}
          </span>
        }
        actions={
          can("content.create") && (
            <form action={videoAction} className="flex gap-2">
              <H />
              {p.status !== "rendering" && p.status !== "publishing" && p.status !== "published" && (
                <SubmitButton name="op" value="render" variant={p.outputAssetId && !stale ? "secondary" : "primary"}>
                  {p.outputAssetId ? "Re-render" : "Render video"}
                </SubmitButton>
              )}
              {["rendered", "pending_approval"].includes(p.status) && !stale && can("content.approve") && (
                <SubmitButton name="op" value="approve" confirm="Approve and publish to the selected destinations?">
                  Approve and publish
                </SubmitButton>
              )}
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-4 space-y-2">
        {p.status === "rendering" && <Alert>Rendering in the background. Refresh to check progress.</Alert>}
        {p.renderError && <Alert tone="red" title="Render failed">{p.renderError}</Alert>}
        {stale && <Alert tone="yellow">You edited the video after the last render. Re-render before approving.</Alert>}
        {!voice.configured && <Alert tone="yellow">No voice provider is configured, so narration is used for captions only and the video has music without voice-over.</Alert>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {scenes.map((sc, i) => (
            <Card key={sc.id} title={`Scene ${i + 1}`}>
              <form action={videoAction} className="grid gap-4 md:grid-cols-[9rem_1fr]">
                <H sceneId={sc.id} />
                <div className="space-y-2">
                  {sc.mediaAssetId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={publicMediaUrl(sc.mediaAssetId, "thumb")} alt="" className="aspect-square w-full rounded-lg object-cover" />
                  )}
                  {editable && (
                    <Select name="mediaAssetId" defaultValue={sc.mediaAssetId ?? ""} aria-label="Photo">
                      {photos.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.altText || a.originalFilename || a.id.slice(0, 8)}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <div className="space-y-3">
                  <Field label="Narration">
                    <Textarea name="narration" rows={3} defaultValue={sc.narration} disabled={!editable} />
                  </Field>
                  <Field label="On-screen text">
                    <Input name="overlayText" maxLength={60} defaultValue={sc.overlayText ?? ""} disabled={!editable} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Voice">
                      <Select name="voiceId" defaultValue={sc.voiceId ?? VOICES[0].id} disabled={!editable}>
                        {VOICES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Seconds" hint="Extends to fit narration.">
                      <Input name="seconds" type="number" min={1.5} max={15} step={0.5} defaultValue={sc.durationMs / 1000} disabled={!editable} />
                    </Field>
                    <Field label="Motion">
                      <Select name="effect" defaultValue={sc.effect} disabled={!editable}>
                        <option value="none">None</option>
                        <option value="zoom_in">Zoom in</option>
                        <option value="zoom_out">Zoom out</option>
                        <option value="pan">Pan</option>
                      </Select>
                    </Field>
                    <Field label="Transition">
                      <Select name="transition" defaultValue={sc.transition} disabled={!editable}>
                        <option value="fade">Fade</option>
                        <option value="cut">Cut</option>
                        <option value="slide">Slide</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Delivery direction (optional)" hint="e.g. “excited”, “warm and slow”. Used by voice models that support it.">
                    <Input name="deliveryInstruction" maxLength={120} defaultValue={sc.deliveryInstruction ?? ""} disabled={!editable} />
                  </Field>
                  {editable && (
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="op" value="scene" size="sm" variant="secondary">
                        Save scene
                      </SubmitButton>
                      <SubmitButton name="op" value="up" size="sm" variant="ghost" disabled={i === 0}>
                        Move up
                      </SubmitButton>
                      <SubmitButton name="op" value="down" size="sm" variant="ghost" disabled={i === scenes.length - 1}>
                        Move down
                      </SubmitButton>
                      <SubmitButton name="op" value="remove" size="sm" variant="ghost" confirm="Remove this scene?">
                        Remove
                      </SubmitButton>
                    </div>
                  )}
                </div>
              </form>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card title="Preview">
            {p.outputAssetId ? <video src={publicMediaUrl(p.outputAssetId, "original")} controls className={p.format === "vertical" ? "mx-auto max-h-[480px] rounded-lg bg-black" : "w-full rounded-lg bg-black"} /> : <p className="text-sm text-slate-500">Not rendered yet.</p>}
            <Publications rows={publications} />
          </Card>
          <Card title="Settings">
            <form action={videoAction} className="space-y-3">
              <H />
              <Field label="Title">
                <Input name="title" defaultValue={p.title} disabled={!editable} />
              </Field>
              <Checkbox name="textOverlay" defaultChecked={s.textOverlay} label="Show on-screen text" disabled={!editable} />
              <Checkbox name="imageEffects" defaultChecked={s.imageEffects} label="Image motion" disabled={!editable} />
              <Checkbox name="logoWatermark" defaultChecked={s.logoWatermark} label="Logo watermark" disabled={!editable} />
              <Checkbox name="introLogo" defaultChecked={s.introLogo} label="Logo intro" disabled={!editable} />
              <Field label="Music">
                <Select name="music" defaultValue={s.music} disabled={!editable}>
                  <option value="auto">Automatic</option>
                  <option value="none">None</option>
                  {MUSIC_TRACKS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Music volume (%)">
                <Input name="musicVolume" type="number" min={0} max={100} defaultValue={Math.round(s.musicVolume * 100)} disabled={!editable} />
              </Field>
              <Field label="Ending card text">
                <Input name="endingText" maxLength={80} defaultValue={s.endingText ?? ""} disabled={!editable} />
              </Field>
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">Publish to</p>
                {["google", "youtube", "facebook", "instagram", "linkedin"].map((d) => (
                  <Checkbox key={d} name="destinations" value={d} defaultChecked={p.destinations.includes(d)} label={<span className="capitalize">{d}</span>} disabled={!editable} />
                ))}
              </div>
              {editable && (
                <SubmitButton name="op" value="settings" size="sm" variant="secondary">
                  Save settings
                </SubmitButton>
              )}
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
