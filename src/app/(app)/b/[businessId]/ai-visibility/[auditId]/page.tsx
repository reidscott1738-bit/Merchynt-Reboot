import { notFound } from "next/navigation";
import { Alert, Badge, Card, DemoBadge, PageHeader, Stat, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { businessPage } from "@/server/page-context";
import { getAiVisibilityAudit } from "@/server/services/ai-visibility";
import { AppError } from "@/server/errors";

export const metadata = { title: "AI Visibility audit" };

export default async function AiVisibilityAudit({ params }: { params: Promise<{ businessId: string; auditId: string }> }) {
  const { businessId, auditId } = await params;
  const { actor } = await businessPage(businessId);
  let data: Awaited<ReturnType<typeof getAiVisibilityAudit>>;
  try {
    data = await getAiVisibilityAudit(actor, businessId, auditId);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { audit, queries, summary } = data;
  const running = ["queued", "running"].includes(audit.status);
  return (
    <>
      <PageHeader
        title="AI Visibility audit"
        back={{ href: `/b/${businessId}/ai-visibility`, label: "AI Visibility" }}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={audit.status} /> Started {formatDateTime(audit.createdAt)} · question set {audit.templateVersion}
          </span>
        }
      />
      {running && (
        <div className="mb-4">
          <Alert>The audit is running. Refresh to see answers as they arrive.</Alert>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.providers.map((p) => (
          <Stat
            key={p.provider}
            label={p.provider}
            demo={p.demo}
            value={p.share == null ? "No answers" : `${Math.round(p.share * 100)}%`}
            hint={
              <>
                Named in {p.mentioned} of {p.asked} answers{p.averagePosition != null ? `, average position ${p.averagePosition}` : ""}
                {p.unsupported > 0 && `. ${p.unsupported} not checked (unavailable)`}
                {p.failed > 0 && `. ${p.failed} failed`}
              </>
            }
          />
        ))}
      </div>
      {summary.topCompetitors.length > 0 && (
        <Card title="Businesses named most often" className="mb-6">
          <ul className="flex flex-wrap gap-2 text-sm">
            {summary.topCompetitors.map((c) => (
              <li key={c.name} className="rounded-full bg-slate-100 px-3 py-1">
                {c.name} <span className="text-slate-500">×{c.mentions}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Answers" padded={false}>
        <Table head={["Question", "Assistant", "Result", "Answer"]}>
          {queries.map((q) => (
            <tr key={q.id} className="align-top">
              <Td className="max-w-56 text-sm">{q.queryText}</Td>
              <Td className="text-xs">
                {q.provider}
                {q.model && <div className="text-slate-500">{q.model}</div>}
              </Td>
              <Td>
                {q.status !== "succeeded" ? (
                  <>
                    <StatusBadge status={q.status} />
                    {q.error && <div className="mt-1 max-w-48 text-xs text-slate-500">{q.error}</div>}
                  </>
                ) : q.mentioned ? (
                  <Badge tone="green">Named{q.position ? ` #${q.position}` : ""}</Badge>
                ) : (
                  <Badge>Not named</Badge>
                )}
                {q.isDemo && (
                  <div className="mt-1">
                    <DemoBadge label="demo answer" />
                  </div>
                )}
              </Td>
              <Td className="max-w-xl">
                {q.responseText ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-blue-800">Show answer</summary>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{q.responseText}</p>
                    {q.sources && q.sources.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {q.sources.slice(0, 10).map((s) => (
                          <li key={s.url} className="truncate">
                            <a href={s.url} target="_blank" rel="noreferrer nofollow" className="text-blue-700 underline">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
