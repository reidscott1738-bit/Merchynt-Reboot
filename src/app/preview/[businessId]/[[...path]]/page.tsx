import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { getDraftSite, liveData } from "@/server/services/websites";
import { SitePage } from "@/components/site/render";
import { AppError } from "@/server/errors";

export const metadata = { robots: { index: false, follow: false } };

/** Signed-in preview of the draft website. Never cached or indexed. */
export default async function DraftPreview({ params }: { params: Promise<{ businessId: string; path?: string[] }> }) {
  const { businessId, path } = await params;
  const actor = await requireActor();
  let draft: Awaited<ReturnType<typeof getDraftSite>>;
  try {
    draft = await getDraftSite(actor, businessId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  if (!draft) notFound();
  const p = `/${(path ?? []).join("/")}`;
  const page = draft.pages.find((x) => x.path === p);
  if (!page) notFound();
  const base = `/preview/${businessId}`;
  const live = await liveData(draft.site.businessId, draft.pages, base, { includeDemo: true });
  return <SitePage name={draft.site.name} theme={draft.site.theme} pages={draft.pages} page={page} live={live} base={base} preview />;
}
