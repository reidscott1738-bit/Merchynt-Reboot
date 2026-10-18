import { Flash, PageHeader } from "@/components/ui";
import { TaskFilters, TaskList } from "@/components/tasks/task-list";
import { businessPage, type SP } from "@/server/page-context";
import { listTasks, type TaskFilters as F } from "@/server/services/tasks";

export const metadata = { title: "Tasks" };

export default async function BusinessTasks({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: SP }) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { actor } = await businessPage(businessId);
  const rows = await listTasks(actor, { businessId, status: (sp.status ?? "open") as F["status"], type: (sp.type ?? "all") as F["type"], assignee: sp.assignee === "me" ? "me" : "all", q: sp.q });
  return (
    <>
      <PageHeader title="Tasks" description="Approve, edit or reject what automations prepared. Approved items publish through the same checks as automatic ones." />
      <Flash ok={sp.ok} err={sp.err} />
      <TaskFilters action={`/b/${businessId}/tasks`} sp={sp} />
      <TaskList rows={rows} />
    </>
  );
}
