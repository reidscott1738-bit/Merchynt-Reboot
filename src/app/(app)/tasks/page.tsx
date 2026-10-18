import { Flash, PageHeader } from "@/components/ui";
import { TaskFilters, TaskList } from "@/components/tasks/task-list";
import { orgPage, type SP } from "@/server/page-context";
import { listTasks, type TaskFilters as F } from "@/server/services/tasks";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await orgPage();
  const rows = await listTasks(actor, { status: (sp.status ?? "open") as F["status"], type: (sp.type ?? "all") as F["type"], assignee: sp.assignee === "me" ? "me" : "all", q: sp.q });
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title="Tasks" description="Approvals and action items across every business you can access." />
      <Flash ok={sp.ok} err={sp.err} />
      <TaskFilters action="/tasks" sp={sp} />
      <TaskList rows={rows} showBusiness />
    </main>
  );
}
