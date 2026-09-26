import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/EmptyState";
import type { CommitteeOverviewData } from "../queries";
import { MembersForm, type MemberOption } from "./MembersForm";

// The committee at a glance: who is on it, what it owes and what it has been asked to do. The
// process itself is the generic record page around this; none of it is repeated here.

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "—";
}

const REPORT_STATE: Record<string, string> = {
  draft: "Being written",
  submitted: "With the head",
  reviewed: "Being acted on",
  revision_required: "Back with the committee",
  approved: "Approved",
};

export interface CommitteeOverviewProps {
  dept: string;
  data: CommitteeOverviewData;
  staff: MemberOption[];
  canManage: boolean;
  canReport: boolean;
}

export function CommitteeOverview({
  dept,
  data,
  staff,
  canManage,
  canReport,
}: CommitteeOverviewProps) {
  const { committee, members, reports, tasks } = data;
  return (
    <div className="flex flex-col gap-8" data-testid="committee-overview">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Members</h3>
          <Badge variant={committee.status === "active" ? "secondary" : "outline"}>
            {committee.status === "active" ? "At work" : "Not at work"}
          </Badge>
        </div>
        {members.length ? (
          <ul className="flex flex-col gap-1" data-testid="committee-members">
            {members.map((m) => (
              <li key={m.personId} className="flex items-center justify-between gap-3 text-sm">
                <span>{m.fullName}</span>
                {m.roleInGroup === "chair" ? <Badge variant="secondary">Chair</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="Nobody is on this committee yet" />
        )}
        {canManage ? (
          <MembersForm
            dept={dept}
            recordId={committee.id}
            staff={staff}
            selected={members.map((m) => m.personId)}
            chairId={members.find((m) => m.roleInGroup === "chair")?.personId ?? null}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Reports</h3>
          {canReport ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={
                  `/d/${dept}/f/committee_report/new?parentType=committee&parentId=${committee.id}` as Route
                }
              >
                Write a report
              </Link>
            </Button>
          ) : null}
        </div>
        {reports.length ? (
          <ul className="flex flex-col gap-1" data-testid="committee-reports">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/d/${dept}/f/committee_report/${r.featureRecordId}` as Route}
                  className="underline underline-offset-2"
                >
                  {day(r.periodFrom)} to {day(r.periodTo)}
                </Link>
                <span className="text-muted-foreground">
                  {REPORT_STATE[r.state] ?? r.state} · {r.author}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            title="No report yet"
            hint="A report says what the committee did in a period and what it cannot settle on its own."
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Tasks</h3>
        {tasks.length ? (
          <ul className="flex flex-col gap-1" data-testid="committee-tasks">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                {t.featureRecordId ? (
                  <Link
                    href={`/d/${dept}/tasks/${t.featureRecordId}` as Route}
                    className="underline underline-offset-2"
                  >
                    {t.title}
                  </Link>
                ) : (
                  <span>{t.title}</span>
                )}
                <span className="text-muted-foreground">
                  {t.done ? "done" : t.dueAt ? `due ${day(t.dueAt)}` : "open"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No committee task yet" />
        )}
      </section>
    </div>
  );
}
