import Link from "next/link";
import { Alert, Card, Flash, LinkButton, PageHeader, buttonClass, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { businessPage, type SP } from "@/server/page-context";
import { ONBOARDING_STEPS, listKnowledge, listServices, recommendedPlan } from "@/server/services/business";
import { getPolicies, listTemplates } from "@/server/services/reviews";
import { isProviderConfigured } from "@/server/integrations/oauth";
import { env } from "@/server/env";
import { BusinessFields } from "../../../businesses/business-form";
import { importGoogleAction, onboardingStepAction, updateBusinessAction } from "../business-actions";
import { KnowledgePanel, ReviewPolicyForm, ServicesPanel, TrustPlan } from "../panels";

export const metadata = { title: "Setup" };

const LINKS: Record<string, { href: string; label: string; text: string }> = {
  keywords: { href: "/keywords", label: "Open Keywords", text: "Add the searches you want to rank for and set the area each ranking audit covers. Suggestions are based on your categories and services; search volume is shown only when a keyword data provider is configured." },
  posting: { href: "/automations", label: "Open Automations", text: "Choose how often posts are drafted, which days and times they go out, and whether they need approval. Posting starts in approval mode." },
  images: { href: "/media", label: "Open Media", text: "Upload photos of your work, team and location, or connect CompanyCam. Posts use your own photos first. Location metadata is read from photos when it is really there; it is never invented." },
  social: { href: "/integrations", label: "Open Integrations", text: "Connect Facebook, Instagram, LinkedIn or YouTube if you want posts and videos shared there too." },
  approvals: { href: "/automations", label: "Open Automations", text: "Choose who receives approval emails. Each email contains single-use links that approve, edit or skip one item." },
  website: { href: "/seo", label: "Open Website & AI SEO", text: "Run a website audit, generate schema markup and FAQs, and check how AI assistants describe your business." },
};

export default async function Onboarding({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business, can } = await businessPage(businessId);
  const steps = [...ONBOARDING_STEPS, { key: "trust", label: "Recommended settings" } as const];
  const current = steps.find((s) => s.key === sp.step)?.key ?? steps.find((s) => s.key !== "trust" && !["done", "skipped"].includes(business.onboarding.steps?.[s.key as (typeof ONBOARDING_STEPS)[number]["key"]]?.status ?? ""))?.key ?? "trust";
  const base = `/b/${businessId}`;
  const back = `${base}/onboarding?step=${current}`;
  const idx = steps.findIndex((s) => s.key === current);
  const nextKey = steps[idx + 1]?.key;
  const h = { businessId, back };
  const canEdit = can("business.edit");

  const stepButtons = (step: string) =>
    canEdit ? (
      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <form action={onboardingStepAction}>
          <input type="hidden" name="businessId" value={businessId} />
          <input type="hidden" name="_back" value={nextKey ? `${base}/onboarding?step=${nextKey}` : `${base}/onboarding`} />
          <input type="hidden" name="step" value={step} />
          <SubmitButton name="status" value="done">
            Mark done and continue
          </SubmitButton>{" "}
          <SubmitButton name="status" value="skipped" variant="secondary">
            Skip for now
          </SubmitButton>
        </form>
      </div>
    ) : null;

  let body: React.ReactNode = null;
  if (current === "connect") {
    const configured = isProviderConfigured("google");
    body = (
      <>
        <p className="text-sm text-slate-600">Connecting lets {env().APP_NAME} read your profile, reviews and performance, and — when you approve — publish replies, posts and photos. Access uses Google’s business.manage permission only.</p>
        {business.gbpLocationName ? (
          <div className="mt-4 space-y-3">
            <Alert tone="green" title="Connected">This business is linked to a Google Business Profile location.</Alert>
            <form action={importGoogleAction}>
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="_back" value={back} />
              <SubmitButton variant="secondary">Re-import profile data</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {!configured && <Alert tone="yellow" title="Google is not configured on this server">An administrator must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. You can continue setup and connect later.</Alert>}
            <div className="flex flex-wrap gap-2">
              {configured && can("integrations.manage") && (
                <a className={buttonClass()} href={`/api/oauth/google/start?businessId=${businessId}&redirect=${encodeURIComponent(back)}`}>
                  Connect Google Business Profile
                </a>
              )}
              <LinkButton variant="secondary" href={`${base}/integrations`}>
                Invite the profile owner to connect
              </LinkButton>
            </div>
          </div>
        )}
      </>
    );
  } else if (current === "details") {
    body = (
      <form action={updateBusinessAction} className="space-y-6">
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="_back" value={nextKey ? `${base}/onboarding?step=${nextKey}` : back} />
        <input type="hidden" name="origin" value="onboarding" />
        <input type="hidden" name="completeStep" value="details" />
        <BusinessFields b={business} sections={["basics", "contact", "address", "hours", "brand"]} />
        {canEdit && <SubmitButton>Save and continue</SubmitButton>}
      </form>
    );
  } else if (current === "knowledge") {
    body = (
      <>
        <KnowledgePanel rows={await listKnowledge(actor, businessId)} canEdit={canEdit} {...h} />
        {stepButtons("knowledge")}
      </>
    );
  } else if (current === "services") {
    body = (
      <>
        <ServicesPanel rows={await listServices(actor, businessId)} canEdit={canEdit} {...h} />
        {stepButtons("services")}
      </>
    );
  } else if (current === "reviews") {
    const [policies, templates] = await Promise.all([getPolicies(businessId), listTemplates(actor, businessId)]);
    body = <ReviewPolicyForm policies={policies} templates={templates} completeStep="reviews" {...h} back={nextKey ? `${base}/onboarding?step=${nextKey}` : back} />;
  } else if (current === "trust") {
    body = can("automations.manage") ? <TrustPlan items={recommendedPlan().automations} applied={Boolean(business.onboarding.trustDefaultsApplied)} {...h} /> : <p className="text-sm text-slate-500">Ask an admin to choose automation settings.</p>;
  } else {
    const l = LINKS[current];
    body = (
      <>
        <p className="text-sm text-slate-600">{l?.text}</p>
        {l && (
          <LinkButton className="mt-4" variant="secondary" href={`${base}${l.href}`}>
            {l.label}
          </LinkButton>
        )}
        {stepButtons(current)}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Set up this business" description="Work through each step in any order. Skipped steps stay on this list." />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <ol className="space-y-1 text-sm">
          {steps.map((s, i) => {
            const st = s.key === "trust" ? (business.onboarding.trustDefaultsApplied ? "done" : "todo") : (business.onboarding.steps?.[s.key as (typeof ONBOARDING_STEPS)[number]["key"]]?.status ?? "todo");
            return (
              <li key={s.key}>
                <Link href={`${base}/onboarding?step=${s.key}`} className={cx("flex items-center gap-2 rounded-md px-2 py-1.5", s.key === current ? "bg-blue-50 font-medium text-blue-800" : "text-slate-600 hover:bg-slate-100")}>
                  <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", st === "done" ? "bg-emerald-600 text-white" : st === "skipped" ? "bg-slate-300 text-white" : "bg-slate-100 text-slate-600")}>{st === "done" ? "✓" : st === "skipped" ? "–" : i + 1}</span>
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ol>
        <Card title={steps[idx]?.label}>{body}</Card>
      </div>
    </>
  );
}
