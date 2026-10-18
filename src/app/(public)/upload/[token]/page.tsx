import { Checkbox, Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { lookupUploadLink } from "@/server/services/media";
import type { SP } from "@/server/page-context";
import { uploadLinkAction } from "../../actions";
import { brandFor, PublicFrame } from "../../brand";

export const metadata = { title: "Upload photos", referrer: "no-referrer" };

export default async function UploadPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const sp = await searchParams;
  const found = /^[A-Za-z0-9_-]{16,128}$/.test(token) ? await lookupUploadLink(token) : null;
  const brand = await brandFor(found?.business.orgId);
  if (!found) {
    return (
      <PublicFrame brand={brand} title="This upload link can't be used">
        <p className="text-slate-600">It expired or was turned off. Ask for a new link.</p>
      </PublicFrame>
    );
  }
  return (
    <PublicFrame brand={brand} title={`Share photos with ${found.business.name}`}>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={uploadLinkAction} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="_back" value={`/upload/${token}`} />
        <input type="file" name="files" multiple required accept="image/*,video/*" className="block w-full text-sm" />
        <Field label="Your name (optional)">
          <Input name="name" maxLength={80} />
        </Field>
        <Field label="Email (optional)">
          <Input name="email" type="email" />
        </Field>
        <Field label="What do the photos show? (optional)">
          <Input name="caption" maxLength={200} />
        </Field>
        <Checkbox name="consent" required label={`I have the right to share these files, and ${found.business.name} may use them in its marketing.`} />
        <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
        {found.link.requireApproval && <p className="text-xs text-slate-500">The team reviews uploads before using them.</p>}
      </form>
    </PublicFrame>
  );
}
