import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/EmptyState";
import type { ActivityKind } from "../queries";

// What the committee has done, newest first. Everything on it was recorded by the kernel that
// owns it, so this is a reading of the department's own trail rather than a second one.

const KIND_LABEL: Record<ActivityKind, string> = {
  transition: "Process",
  report: "Report",
  comment: "Discussion",
  document: "Document",
  task: "Task",
};

export interface ActivityHistoryProps {
  rows: {
    kind: ActivityKind;
    at: string;
    label: string;
    detail?: string | null;
    by?: string | null;
    href?: string | null;
  }[];
}

export function ActivityHistory({ rows }: ActivityHistoryProps) {
  if (!rows.length)
    return (
      <EmptyState
        compact
        title="Nothing has happened yet"
        hint="Once the committee reports, is given a task or has a paper filed, it shows up here."
      />
    );

  return (
    <ol className="flex flex-col gap-3" data-testid="activity-history">
      {rows.map((row, i) => (
        <li
          key={`${row.kind}-${row.at}-${i}`}
          className="flex flex-col gap-1 border-l-2 border-border pl-3 sm:flex-row sm:items-baseline sm:gap-3"
        >
          <Badge variant="outline" className="w-fit shrink-0">
            {KIND_LABEL[row.kind]}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {row.href ? (
                <Link href={row.href as Route} className="underline underline-offset-2">
                  {row.label}
                </Link>
              ) : (
                row.label
              )}
            </p>
            {row.detail ? (
              <p className="text-sm text-muted-foreground">{row.detail}</p>
            ) : null}
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            <time dateTime={row.at}>{row.at.slice(0, 10)}</time>
            {row.by ? ` · ${row.by}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
