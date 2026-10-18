import Link from "next/link";
import { Alert, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listVideoProjects } from "@/server/services/videos";
import { listMedia } from "@/server/services/media";
import { voiceProviderStatus } from "@/server/integrations/voice";
import { publicMediaUrl } from "@/server/storage";
import { createVideoAction } from "./actions";

export const metadata = { title: "Video Studio" };

export default async function VideosPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const [projects, photos] = await Promise.all([listVideoProjects(actor, businessId), listMedia(actor, businessId, { kind: "image", moderation: "approved", usage: "videos" }, 40)]);
  const voice = voiceProviderStatus();
  const back = `/b/${businessId}/videos`;
  return (
    <>
      <PageHeader title="Video Studio" description="Slideshow videos built from your approved photos with an AI-written script, optional narration and synthesized background music. Rendering runs on the server with FFmpeg." />
      <Flash ok={sp.ok} err={sp.err} />
      {!voice.configured && (
        <div className="mb-4">
          <Alert tone="yellow">{voice.label}. Add ELEVENLABS_API_KEY for voice-over.</Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card padded={false} title="Videos">
          {projects.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No videos yet">Choose at least two approved photos below to draft one.</EmptyState>
            </div>
          ) : (
            <Table head={["Title", "Format", "Status", "Updated"]}>
              {projects.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`${back}/${p.id}`} className="font-medium text-blue-800 hover:underline">
                      {p.title}
                    </Link>
                  </Td>
                  <Td>{p.format}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td className="text-xs">{formatDateTime(p.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {can("content.create") && (
          <Card title="New video">
            {photos.length < 2 ? (
              <p className="text-sm text-slate-500">Approve at least two photos marked for video use in Media first.</p>
            ) : (
              <form action={createVideoAction} className="space-y-4">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="_back" value={back} />
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Title">
                    <Input name="title" placeholder="Spring cleanup highlights" />
                  </Field>
                  <Field label="Format">
                    <Select name="format" defaultValue="vertical">
                      <option value="vertical">Vertical 9:16 (Shorts, Reels)</option>
                      <option value="horizontal">Horizontal 16:9</option>
                    </Select>
                  </Field>
                  <Field label="What should it be about? (optional)">
                    <Input name="brief" maxLength={400} />
                  </Field>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">Photos, in order (leave all unchecked to use the newest six)</p>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                    {photos.map((a) => (
                      <label key={a.id} className="block cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={publicMediaUrl(a.id, "thumb")} alt={a.altText ?? ""} className="aspect-square w-full rounded-lg object-cover" />
                        <span className="mt-1 flex items-center gap-1 text-xs">
                          <input type="checkbox" name="assetIds" value={a.id} /> Use
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  {["google", "youtube", "facebook", "instagram", "linkedin"].map((d) => (
                    <Checkbox key={d} name="destinations" value={d} label={<span className="capitalize">Publish to {d}</span>} />
                  ))}
                </div>
                <SubmitButton pendingText="Writing script…">Draft video</SubmitButton>
              </form>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
