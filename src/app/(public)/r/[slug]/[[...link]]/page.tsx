import { notFound } from "next/navigation";
import { Checkbox, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { getPublicReviewPage, recordLinkEvent } from "@/server/services/campaigns";
import type { SP } from "@/server/page-context";
import { continueToGoogleAction, photoBoostAction } from "../../../actions";

export const metadata = { title: "Leave a review", referrer: "no-referrer" };

/** Same page and same Google button for every visitor: no rating question decides who is sent to Google. */
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ slug: string; link?: string[] }>; searchParams: SP }) {
  const { slug, link } = await params;
  const sp = await searchParams;
  const linkSlug = link?.[0] ?? null;
  if (link && link.length > 1) notFound();
  const page = await getPublicReviewPage(slug, linkSlug, sp.c ?? null);
  if (!page) notFound();
  if (!sp.ok && !sp.err) await recordLinkEvent(page.business.id, page.link?.id ?? null, page.contact?.id ?? null, "open");
  const back = `/r/${slug}${linkSlug ? `/${linkSlug}` : ""}${sp.c ? `?c=${encodeURIComponent(sp.c)}` : ""}`;
  const hidden = () => (
    <>
      <input type="hidden" name="slug" value={slug} />
      {linkSlug && <input type="hidden" name="link" value={linkSlug} />}
      {sp.c && <input type="hidden" name="c" value={sp.c} />}
      <input type="hidden" name="_back" value={back} />
    </>
  );
  const color = page.business.color;
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {page.business.logoUrl && <img src={page.business.logoUrl} alt="" className="mx-auto mb-3 h-16 w-16 rounded-full object-cover" />}
        <h1 className="text-2xl font-semibold">{page.contact?.firstName ? `Thanks, ${page.contact.firstName}!` : `Thanks for choosing ${page.business.name}`}</h1>
        <p className="mt-2 text-slate-600">Would you share your experience on Google? It takes a minute and helps others find us.</p>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={continueToGoogleAction}>
        {hidden()}
        <button type="submit" className="w-full rounded-xl px-6 py-4 text-lg font-semibold text-white shadow" style={{ background: color }}>
          Leave a review on Google
        </button>
      </form>
      {page.photoBoostEnabled && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Add photos of the finished work (optional)</h2>
          <p className="mt-1 text-sm text-slate-600">Google does not let other sites attach photos to your review, so photos you add here go to {page.business.name}, who may add them to their Google profile.</p>
          <form action={photoBoostAction} className="mt-4 space-y-3">
            {hidden()}
            <input type="file" name="files" accept="image/*" multiple required className="block w-full text-sm" />
            <Input name="name" placeholder="Your first name (optional)" maxLength={80} />
            <Input name="caption" placeholder="What was the job? (optional)" maxLength={200} />
            <Checkbox name="consent" required label={`I took these photos and ${page.business.name} may use them in its marketing.`} />
            <SubmitButton variant="secondary" pendingText="Uploading…">
              Send photos
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
