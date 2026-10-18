import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Alert, Badge, Card, EmptyState, Flash, LinkButton, PageHeader, Stars, Stat, StatusBadge, formatDateTime } from "@/components/ui";
import { businessPage, type SP } from "@/server/page-context";
import { scoreHistory, listRecommendations } from "@/server/services/optimization";
import { reviewStats } from "@/server/services/reviews";
import { listTasks } from "@/server/services/tasks";
import { listAutomations } from "@/server/services/automations";
import { db } from "@/server/db";
import { reviews } from "@/server/db/schema";
import { ONBOARDING_STEPS } from "@/server/services/business";
import { aiStatus } from "@/server/ai/provider";

export const metadata = { title: "Dashboard" };

export default async function BusinessDashboard({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor, business } = await businessPage(businessId);
  const [scores, stats, recs, open, autos, recent] = await Promise.all([
    scoreHistory(actor, businessId),
    reviewStats(businessId),
    listRecommendations(actor, businessId),
    listTasks(actor, { businessId, status: "open" }, 6),
    listAutomations(actor, businessId),
    db.select().from(reviews).where(eq(reviews.businessId, businessId)).orderBy(desc(reviews.publishedAt)).limit(5),
  ]);
  const score = scores[0];
  const base = `/b/${businessId}`;
  const stepsDone = ONBOARDING_STEPS.filter((s) => ["done", "skipped"].includes(business.onboarding.steps?.[s.key]?.status ?? "")).length;
  const failing = autos.filter((a) => a.health === "failing" || a.health === "degraded");
  const ai = aiStatus();
  return (
    <>
      <PageHeader title={business.name} description={[business.primaryCategory, [business.city, business.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ")} />
      <Flash ok={sp.ok} err={sp.err} />
      <div className="mb-6 space-y-3">
        {!business.onboardingCompletedAt && (
          <Alert tone="yellow" title={`Setup is ${stepsDone} of ${ONBOARDING_STEPS.length} steps done`}>
            <Link href={`${base}/onboarding`} className="font-medium underline">
              Continue setup
            </Link>{" "}
            to connect Google, confirm your details and choose which automations run.
          </Alert>
        )}
        {!business.gbpLocationName && (
          <Alert tone="blue" title="Google Business Profile is not connected">
            Reviews, posts, photo uploads and profile edits stay local until you{" "}
            <Link href={`${base}/integrations`} className="font-medium underline">
              connect a profile
            </Link>
            .
          </Alert>
        )}
        {!ai.configured && <Alert tone="yellow" title="AI is not configured">Generated drafts are unavailable until an administrator sets ANTHROPIC_API_KEY, or enables demo mode for labeled samples.</Alert>}
        {failing.length > 0 && (
          <Alert tone="red" title="Automations need attention">
            {failing.map((a) => a.meta.label).join(", ")} failed on recent runs.{" "}
            <Link href={`${base}/automations`} className="font-medium underline">
              Review automations
            </Link>
          </Alert>
        )}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Profile score" value={score ? `${score.score}/100` : "—"} hint={score ? `Computed ${formatDateTime(score.computedAt)}` : "Not computed yet"} />
        <Stat label="Average rating" value={stats.average ? `${stats.average}★` : "—"} hint={`${stats.total} reviews synced`} demo={stats.demoCount > 0} />
        <Stat label="Reply rate" value={stats.responseRate == null ? "—" : `${Math.round(stats.responseRate * 100)}%`} hint="Replies published through this app" demo={stats.demoCount > 0} />
        <Stat label="Open tasks" value={open.length} hint={open.length ? "Waiting on a decision" : "Nothing waiting"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Waiting on you" actions={<LinkButton href={`${base}/tasks`} variant="secondary" size="sm">All tasks</LinkButton>}>
          {open.length === 0 ? (
            <p className="text-sm text-slate-500">No open tasks.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {open.map(({ task }) => (
                <li key={task.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/tasks/${task.id}`} className="text-blue-800 hover:underline">
                    {task.title}
                  </Link>
                  <Badge>{task.type.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Top recommendations" actions={<LinkButton href={`${base}/profile?tab=recommendations`} variant="secondary" size="sm">All</LinkButton>}>
          {recs.length === 0 ? (
            <p className="text-sm text-slate-500">No open recommendations. Run an analysis from Business Profile.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recs.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-start gap-2">
                  <Badge tone={r.impact === "high" ? "red" : r.impact === "medium" ? "yellow" : "gray"}>{r.impact}</Badge>
                  <span>{r.issue}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Latest reviews" actions={<LinkButton href={`${base}/reviews`} variant="secondary" size="sm">Reviews</LinkButton>}>
          {recent.length === 0 ? (
            <EmptyState title="No reviews synced">Reviews sync from Google once the profile is connected and the review automation runs.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} /> <span className="font-medium">{r.reviewerName}</span> <StatusBadge status={r.replyStatus} /> {r.isDemo && <Badge tone="purple">Demo</Badge>}
                  </div>
                  {r.text && <p className="line-clamp-2 text-slate-600">{r.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Automations" actions={<LinkButton href={`${base}/automations`} variant="secondary" size="sm">Manage</LinkButton>}>
          <ul className="divide-y divide-slate-100 text-sm">
            {autos.map((a) => (
              <li key={a.type} className="flex items-center justify-between py-1.5">
                <span>{a.meta.label}</span>
                <StatusBadge status={a.health === "off" ? "paused" : a.health === "healthy" ? "active" : a.health === "waiting" ? "scheduled" : a.health === "failing" ? "failed" : "pending"} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
