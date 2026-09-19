import { CalendarCheckIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { upcoming } from "@/platform/scheduler/upcoming";
import { label } from "@/platform/subject-registry";
import { fmtDateTime } from "@/components/forms/Field";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function dueTone(
  deadline: Date,
  now: Date,
): { text: string; variant: "destructive" | "secondary" | "outline" } {
  const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY);
  if (days <= 1) return { text: days <= 0 ? "today" : "tomorrow", variant: "destructive" };
  if (days <= 3) return { text: `in ${days} days`, variant: "secondary" };
  return { text: `in ${days} days`, variant: "outline" };
}

export default async function UpcomingPage(props: PageProps<"/d/[dept]/upcoming">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const days = Number(params.days ?? 30) || 30;
  const canAll = (await canDo(ctx, "academic.manage")).allowed;
  const all = params.scope === "department" && canAll;
  const from = new Date();
  const to = new Date(from.getTime() + days * DAY);
  const items = await upcoming(db, ctx.departmentId, {
    ...(all ? {} : { personId: ctx.personId ?? "-" }),
    from,
    to,
  });
  const labelled = await Promise.all(
    items.map(async (i) => ({
      ...i,
      label: await label(db, { subjectType: i.subjectType, subjectId: i.subjectId }).catch(
        () => i.subjectId,
      ),
    })),
  );
  const href = (d: number, scope: string) => `/d/${dept}/upcoming?days=${d}&scope=${scope}`;
  const scope = all ? "department" : "mine";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upcoming deadlines"
        description="Everything with a reminder schedule that falls due in the chosen window."
        actions={
          <>
            <SegmentedLinks
              label="Window"
              items={[7, 14, 30, 90].map((d) => ({
                label: `${d} days`,
                href: href(d, scope),
                active: d === days,
              }))}
            />
            {canAll ? (
              <SegmentedLinks
                label="Scope"
                items={[
                  { label: "Mine", href: href(days, "mine"), active: !all },
                  { label: "Department", href: href(days, "department"), active: all },
                ]}
              />
            ) : null}
          </>
        }
      />
      <Card>
        <CardContent>
          {labelled.length === 0 ? (
            <EmptyState
              icon={<CalendarCheckIcon />}
              title={`No deadlines in the next ${days} days`}
              hint={
                all
                  ? "Deadlines appear here as soon as a task, campaign or duty with a reminder schedule is created."
                  : "Nothing addressed to you falls due in this window. Widen the window or check the department view."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Due</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Schedule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labelled.map((i) => {
                  const tone = dueTone(i.deadlineAt, from);
                  return (
                    <TableRow key={i.subscriptionId} data-testid="upcoming-row">
                      <TableCell className="whitespace-nowrap">
                        <span className="tabular-nums">{fmtDateTime(i.deadlineAt)}</span>{" "}
                        <Badge variant={tone.variant}>{tone.text}</Badge>
                      </TableCell>
                      <TableCell>
                        {i.label}{" "}
                        <span className="text-xs text-muted-foreground">({i.subjectType})</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{i.scheduleKey}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
