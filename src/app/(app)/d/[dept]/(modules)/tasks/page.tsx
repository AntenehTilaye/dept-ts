import type { Route } from "next";
import { PlusIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { listTasks } from "@/platform/workitem";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { TaskTable, type TaskTableRow } from "@/components/tables/TaskTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Department task list. P9 replaces this page with the generic feature runtime
 * (`/d/:dept/tasks/*` rewrites to `/d/:dept/f/task/*`); the service calls stay the same.
 */
export default async function TasksPage(props: PageProps<"/d/[dept]/tasks">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const filter = typeof params.filter === "string" ? params.filter : "open";
  const canCreate = (await canDo(ctx, "task.create")).allowed;
  // a department-wide task.view shows everything; everyone else sees their own assignments
  const seesAll = (await canDo(ctx, "task.view", undefined, "read")).allowed;
  const mine = !seesAll || filter === "mine";

  const rows = await listTasks(db, ctx.departmentId, {
    ...(filter === "open" ? { open: true } : {}),
    ...(filter === "overdue" ? { overdue: true, open: true } : {}),
    ...(mine && ctx.personId ? { assigneePersonId: ctx.personId } : {}),
    ...(filter === "done" ? { open: false } : {}),
  });
  const tableRows: TaskTableRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    priority: r.priority,
    state: r.stateLabel ?? "—",
    due: r.dueAt ? r.dueAt.toISOString().slice(0, 10) : "—",
    overdue: r.overdue,
    assignees: r.assigneeNames.join(", ") || "—",
    href: `/d/${dept}/tasks/${r.id}`,
  }));
  const href = (f: string) => `/d/${dept}/tasks?filter=${f}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tasks"
        description={
          seesAll
            ? "Every task-like item of the department: assignments, committee work, follow-ups."
            : "The tasks you are assigned to, directly or through a committee or audience."
        }
        actions={
          <>
            <SegmentedLinks
              label="Filter"
              items={[
                { label: "Open", href: href("open"), active: filter === "open" },
                { label: "Overdue", href: href("overdue"), active: filter === "overdue" },
                { label: "Mine", href: href("mine"), active: filter === "mine" },
                { label: "Closed", href: href("done"), active: filter === "done" },
              ]}
            />
            {canCreate ? (
              <Button asChild size="sm">
                <a href={`/d/${dept}/tasks/new` as Route}>
                  <PlusIcon /> New task
                </a>
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <CardContent>
          {tableRows.length === 0 ? (
            <EmptyState
              title="No tasks here yet"
              hint="A task carries its own deadline, reminders, deliverable slots and acknowledgements."
              action={
                canCreate ? (
                  <Button size="sm" asChild>
                    <a href={`/d/${dept}/tasks/new` as Route}>
                      <PlusIcon /> Create the first task
                    </a>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TaskTable rows={tableRows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
