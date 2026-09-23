"use client";

import { Badge } from "@/components/ui/badge";
import { columnHelper, DataTable } from "@/components/patterns/DataTable";

export interface TaskTableRow {
  id: string;
  title: string;
  kind: string;
  priority: string;
  state: string;
  due: string;
  overdue: boolean;
  assignees: string;
  href: string;
}

const h = columnHelper<TaskTableRow>();
const columns = [
  h.accessor("title", {
    header: "Task",
    cell: (c) => (
      <a className="font-medium underline-offset-2 hover:underline" href={c.row.original.href}>
        {c.getValue()}
      </a>
    ),
  }),
  h.accessor("state", {
    header: "State",
    cell: (c) => <Badge variant="secondary">{c.getValue()}</Badge>,
  }),
  h.accessor("due", {
    header: "Due",
    cell: (c) =>
      c.row.original.overdue ? (
        <Badge variant="destructive">{c.getValue()} · overdue</Badge>
      ) : (
        <span className="tabular-nums">{c.getValue()}</span>
      ),
  }),
  h.accessor("priority", {
    header: "Priority",
    cell: (c) =>
      c.getValue() === "high" || c.getValue() === "urgent" ? (
        <Badge variant="outline">{c.getValue()}</Badge>
      ) : (
        <span className="text-muted-foreground">{c.getValue()}</span>
      ),
  }),
  h.accessor("assignees", { header: "Assignees" }),
  h.accessor("kind", { header: "Kind" }),
];

export function TaskTable({ rows }: { rows: TaskTableRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Filter tasks"
      rowTestId={(r) => `task-${r.id}`}
      emptyTitle="No tasks"
      emptyHint="Tasks appear here once they are created and assigned."
    />
  );
}
