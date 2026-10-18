import Link from "next/link";
import { Card, EmptyState, Flash, PageHeader, cx, formatDateTime } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { orgPage, type SP } from "@/server/page-context";
import { listNotifications } from "@/server/services/notifications";
import { markNotificationsReadAction } from "../actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await orgPage();
  const rows = await listNotifications(actor.userId, actor.orgId, 100);
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          rows.some((r) => !r.readAt) && (
            <form action={markNotificationsReadAction}>
              <input type="hidden" name="_back" value="/notifications" />
              <SubmitButton variant="secondary" size="sm">
                Mark all as read
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash ok={sp.ok} err={sp.err} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing yet">
          Choose what you hear about in <Link href="/account" className="underline">your account</Link>.
        </EmptyState>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id} className={cx("px-5 py-3", !n.readAt && "bg-blue-50/50")}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={cx("text-sm", !n.readAt && "font-medium")}>{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{formatDateTime(n.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
