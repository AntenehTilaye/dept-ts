import { AlertTriangleIcon, CheckSquareIcon, ClipboardListIcon, EyeIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { myWork, workCounts } from "@/platform/workitem";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { StatCard } from "@/components/patterns/StatCard";
import { TaskTable, type TaskTableRow } from "@/components/tables/TaskTable";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/** Everything assigned to the signed-in person across the department, most urgent first. */
export default async function MyWorkPage(props: PageProps<"/d/[dept]/my-work">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const filter = typeof params.filter === "string" ? params.filter : "open";

  if (!ctx.personId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My work" description="Tasks assigned to you." />
        <EmptyState
          title="Your account is not linked to a person record"
          hint="Nothing can be assigned to you until an administrator links your account."
        />
      </div>
    );
  }

  const [rows, counts] = await Promise.all([
    myWork(db, ctx.departmentId, ctx.personId),
    workCounts(db, ctx.departmentId, ctx.personId),
  ]);
  const visible = rows.filter((r) => {
    if (filter === "overdue") return r.overdue;
    if (filter === "review") return r.state === "submitted" || r.state === "under_review";
    return true;
  });
  const tableRows: TaskTableRow[] = visible.map((r) => ({
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
  const href = (f: string) => `/d/${dept}/my-work?filter=${f}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My work"
        description="Everything assigned to you in this department: overdue first, then by deadline."
        actions={
          <SegmentedLinks
            label="Filter"
            items={[
              { label: "Open", href: href("open"), active: filter === "open", count: counts.open },
              {
                label: "Overdue",
                href: href("overdue"),
                active: filter === "overdue",
                count: counts.overdue,
              },
              {
                label: "In review",
                href: href("review"),
                active: filter === "review",
                count: counts.inReview,
              },
            ]}
          />
        }
      />
      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open" value={counts.open} icon={<ClipboardListIcon />} />
        <StatCard
          label="Overdue"
          value={counts.overdue}
          tone={counts.overdue ? "danger" : "default"}
          icon={<AlertTriangleIcon />}
        />
        <StatCard label="Waiting for review" value={counts.inReview} icon={<EyeIcon />} />
      </section>
      <Card>
        <CardContent>
          {tableRows.length === 0 ? (
            <EmptyState
              icon={<CheckSquareIcon />}
              title={
                filter === "open" ? "Nothing is assigned to you" : "Nothing matches this filter"
              }
              hint="Tasks assigned to you (directly or through a committee or audience) appear here."
            />
          ) : (
            <TaskTable rows={tableRows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
