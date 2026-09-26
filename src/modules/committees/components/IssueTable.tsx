import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/EmptyState";

// The issues a committee could not settle, and what became of them. A report whose issues were
// never taken forward is the failure this table is here to make visible.

export interface IssueRow {
  text: string;
  urgency: string;
  caseNumber?: string | null;
  caseRecordId?: string | null;
}

const TONE: Record<string, "secondary" | "destructive" | "outline"> = {
  low: "outline",
  normal: "secondary",
  high: "destructive",
};

export function IssueTable({ dept, rows }: { dept: string; rows: IssueRow[] }) {
  if (!rows.length)
    return (
      <EmptyState
        compact
        title="The committee raised no issues"
        hint="An issue here becomes a case the department has to answer."
      />
    );

  return (
    <ul className="flex flex-col gap-3" data-testid="issue-table">
      {rows.map((row, i) => (
        <li key={i} className="flex flex-col gap-1 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={TONE[row.urgency] ?? "secondary"}>{row.urgency}</Badge>
            {row.caseRecordId ? (
              <Link
                href={`/d/${dept}/cases/${row.caseRecordId}` as Route}
                className="text-xs underline underline-offset-2"
              >
                Raised as {row.caseNumber ?? "a case"}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Not raised yet</span>
            )}
          </div>
          <p className="text-sm">{row.text}</p>
        </li>
      ))}
    </ul>
  );
}
