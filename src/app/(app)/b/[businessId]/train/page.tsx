import { Card, Flash, PageHeader, Tabs, Textarea, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { listKnowledge, listTraining } from "@/server/services/business";
import { TRAINING_CATEGORIES } from "@/server/db/schema";
import { trainingAction } from "../business-actions";
import { KnowledgePanel } from "../panels";

export const metadata = { title: "Train AI" };

const LABELS: Record<string, { label: string; hint: string }> = {
  general: { label: "General", hint: "Applies to everything the AI writes for this business." },
  google_posts: { label: "Google posts", hint: "Topics to favor or avoid, offers to mention, tone." },
  review_replies: { label: "Review replies", hint: "How to address reviewers, sign-off, what never to say." },
  service_descriptions: { label: "Service descriptions", hint: "How services should be described." },
  website_content: { label: "Website content", hint: "Tone and structure for generated website copy." },
  faqs: { label: "FAQs", hint: "Questions customers really ask." },
  image_generation: { label: "Images", hint: "Branding notes for branded images." },
  video_scripts: { label: "Video scripts", hint: "Pacing, calls to action, phrases to use." },
  voice_pronunciation: { label: "Pronunciation", hint: "One per line: term = how to say it." },
  suggested_reviews: { label: "Review requests", hint: "What to say when asking customers for a review. Never offers incentives." },
};

export default async function TrainPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, can } = await businessPage(businessId);
  const tab = sp.tab ?? "instructions";
  const base = `/b/${businessId}/train`;
  const back = `${base}?tab=${tab}`;
  const canEdit = can("training.edit");
  return (
    <>
      <PageHeader title="Train AI" description="Instructions and verified facts shape every draft. Instructions cannot override validation: drafts that contradict verified facts or break platform rules still wait for a person." />
      <Flash ok={sp.ok} err={sp.err} />
      <Tabs
        current={tab}
        items={[
          { key: "instructions", label: "Instructions", href: `${base}?tab=instructions` },
          { key: "knowledge", label: "Business knowledge", href: `${base}?tab=knowledge` },
        ]}
      />
      {tab === "knowledge" ? (
        <KnowledgePanel rows={await listKnowledge(actor, businessId)} canEdit={can("business.edit")} businessId={businessId} back={back} />
      ) : (
        <Instructions businessId={businessId} back={back} canEdit={canEdit} byCat={await listTraining(actor, businessId)} />
      )}
    </>
  );
}

function Instructions({ businessId, back, canEdit, byCat }: { businessId: string; back: string; canEdit: boolean; byCat: Awaited<ReturnType<typeof listTraining>> }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {TRAINING_CATEGORIES.map((c) => {
        const versions = byCat[c] ?? [];
        const active = versions.find((v) => v.isActive);
        return (
          <Card key={c} title={LABELS[c]?.label ?? c} description={LABELS[c]?.hint}>
            <form action={trainingAction} className="space-y-2">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={back} />
              <input type="hidden" name="category" value={c} />
              <Textarea name="content" rows={4} maxLength={4000} defaultValue={active?.content ?? ""} disabled={!canEdit} />
              {canEdit && (
                <SubmitButton size="sm" name="op" value="save">
                  Save
                </SubmitButton>
              )}
            </form>
            {versions.length > 1 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500">Version history ({versions.length})</summary>
                <ul className="mt-2 space-y-2">
                  {versions.map((v) => (
                    <li key={v.id} className="rounded bg-slate-50 p-2">
                      <div className="flex items-center justify-between">
                        <span>
                          v{v.version} · {formatDateTime(v.createdAt)} {v.isActive && "· active"}
                        </span>
                        {canEdit && !v.isActive && (
                          <form action={trainingAction}>
                            <input type="hidden" name="businessId" value={businessId} />
                            <input type="hidden" name="_back" value={back} />
                            <input type="hidden" name="versionId" value={v.id} />
                            <SubmitButton size="sm" variant="ghost" name="op" value="restore">
                              Restore
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-slate-600">{v.content || "(empty)"}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
