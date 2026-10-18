import Link from "next/link";
import { desc, inArray, sql } from "drizzle-orm";
import { Badge, Card, EmptyState, Flash, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { orgPage, type SP } from "@/server/page-context";
import { accessibleBusinesses } from "@/server/authz";
import { db } from "@/server/db";
import { optimizationScores, reviews, tasks } from "@/server/db/schema";
import { clientHealth } from "@/server/services/agency";

export const metadata = { title: "Businesses" };

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, can } = await orgPage();
  const list = await accessibleBusinesses(actor);
  const ids = list.map((b) => b.id);
  const [scores, openTasks, ratings, health] = ids.length
    ? await Promise.all([
        db.selectDistinctOn([optimizationScores.businessId], { b: optimizationScores.businessId, score: optimizationScores.score }).from(optimizationScores).where(inArray(optimizationScores.businessId, ids)).orderBy(optimizationScores.businessId, desc(optimizationScores.computedAt)),
        db.select({ b: tasks.businessId, n: sql<number>`count(*)::int` }).from(tasks).where(sql`${tasks.businessId} in ${ids} and ${tasks.status} = 'open'`).groupBy(tasks.businessId),
        db.select({ b: reviews.businessId, avg: sql<string>`avg(${reviews.rating})`, n: sql<number>`count(*)::int`, demo: sql<boolean>`bool_or(${reviews.isDemo})` }).from(reviews).where(inArray(reviews.businessId, ids)).groupBy(reviews.businessId),
        can("clients.manage") ? clientHealth(actor) : Promise.resolve([]),
      ])
    : [[], [], [], []];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title={actor.orgKind === "agency" ? "Client businesses" : "Your businesses"}
        description="Pick a business to manage its profile, reviews, posts, rankings and website."
        actions={can("business.create") && <LinkButton href="/businesses/new">Add business</LinkButton>}
      />
      <Flash ok={sp.ok} err={sp.err} />
      {list.length === 0 ? (
        <EmptyState title="No businesses yet" action={can("business.create") && <LinkButton href="/businesses/new">Add your first business</LinkButton>}>
          {can("business.create") ? "Add a business and connect its Google Business Profile to get started." : "You have not been given access to any businesses yet."}
        </EmptyState>
      ) : (
        <Card padded={false}>
          <Table head={["Business", "Setup", "Profile score", "Reviews", "Open tasks", "Attention"]}>
            {list.map((b) => {
              const s = scores.find((x) => x.b === b.id);
              const r = ratings.find((x) => x.b === b.id);
              const t = openTasks.find((x) => x.b === b.id)?.n ?? 0;
              const h = health.find((x) => x.businessId === b.id);
              return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/b/${b.id}`} className="font-medium text-blue-800 hover:underline">
                      {b.name}
                    </Link>
                    <div className="text-xs text-slate-500">{[b.city, b.region].filter(Boolean).join(", ")}</div>
                  </Td>
                  <Td>{b.onboardingCompletedAt ? <Badge tone="green">Complete</Badge> : <Link href={`/b/${b.id}/onboarding`}><Badge tone="yellow">In progress</Badge></Link>}</Td>
                  <Td>{s ? `${s.score} / 100` : <span className="text-slate-400">Not scored</span>}</Td>
                  <Td>
                    {r ? (
                      <>
                        {Number(r.avg).toFixed(1)}★ <span className="text-slate-500">({r.n})</span> {r.demo && <Badge tone="purple">Demo</Badge>}
                      </>
                    ) : (
                      <span className="text-slate-400">None synced</span>
                    )}
                  </Td>
                  <Td>{t ? <Link href={`/b/${b.id}/tasks`} className="text-amber-700">{t}</Link> : "0"}</Td>
                  <Td className="max-w-xs text-xs text-slate-600">{h?.signals.length ? h.signals.join(" · ") : h ? <span className="text-emerald-700">No issues</span> : "—"}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </main>
  );
}
