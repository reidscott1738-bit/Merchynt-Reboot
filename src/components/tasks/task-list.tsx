import Link from "next/link";
import { Card, EmptyState, StatusBadge, Table, Td, formatDateTime } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/client";
import type { listTasks } from "@/server/services/tasks";
import { TASK_STATUSES, TASK_TYPES } from "@/server/db/schema";

export function TaskFilters({ action, sp, hidden }: { action: string; sp: Record<string, string | undefined>; hidden?: Record<string, string> }) {
  return (
    <form action={action} className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <AutoSubmitSelect name="status" defaultValue={sp.status ?? "open"} aria-label="Status">
        <option value="all">All statuses</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </AutoSubmitSelect>
      <AutoSubmitSelect name="type" defaultValue={sp.type ?? "all"} aria-label="Type">
        <option value="all">All types</option>
        {TASK_TYPES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </AutoSubmitSelect>
      <AutoSubmitSelect name="assignee" defaultValue={sp.assignee ?? "all"} aria-label="Assignee">
        <option value="all">Anyone</option>
        <option value="me">Assigned to me</option>
      </AutoSubmitSelect>
      <input name="q" defaultValue={sp.q ?? ""} placeholder="Search titles" className="rounded-lg border border-slate-300 px-2.5 py-1.5" />
    </form>
  );
}

export function TaskList({ rows, showBusiness }: { rows: Awaited<ReturnType<typeof listTasks>>; showBusiness?: boolean }) {
  if (!rows.length) return <EmptyState title="Nothing here">No tasks match these filters. New approvals appear here when automations or teammates create them.</EmptyState>;
  return (
    <Card padded={false}>
      <Table head={["Task", ...(showBusiness ? ["Business"] : []), "Type", "Status", "Due", "Created"]}>
        {rows.map(({ task, businessName }) => (
          <tr key={task.id} className="hover:bg-slate-50">
            <Td>
              <Link href={`/tasks/${task.id}`} className="font-medium text-blue-800 hover:underline">
                {task.title}
              </Link>
              {task.summary && <p className="line-clamp-1 max-w-xl text-xs text-slate-500">{task.summary}</p>}
            </Td>
            {showBusiness && <Td className="whitespace-nowrap">{businessName}</Td>}
            <Td className="whitespace-nowrap">{task.type.replace("_", " ")}</Td>
            <Td>
              <StatusBadge status={task.status} />
            </Td>
            <Td className="whitespace-nowrap text-xs">{formatDateTime(task.dueAt)}</Td>
            <Td className="whitespace-nowrap text-xs">{formatDateTime(task.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
