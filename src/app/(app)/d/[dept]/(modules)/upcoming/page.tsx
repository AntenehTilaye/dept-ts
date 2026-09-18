import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { upcoming } from "@/platform/scheduler/upcoming";
import { label } from "@/platform/subject-registry";
import { fmtDateTime } from "@/components/forms/Field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function UpcomingPage(props: PageProps<"/d/[dept]/upcoming">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const days = Number(params.days ?? 30) || 30;
  const all = params.scope === "department" && (await canDo(ctx, "academic.manage")).allowed;
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming deadlines</CardTitle>
        <CardDescription>
          Next {days} days · {all ? "whole department" : "yours"} ·{" "}
          <a
            className="underline"
            href={`/d/${dept}/upcoming?days=${days}&scope=${all ? "mine" : "department"}`}
          >
            switch
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Schedule</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {labelled.map((i) => (
              <TableRow key={i.subscriptionId} data-testid="upcoming-row">
                <TableCell className="whitespace-nowrap">{fmtDateTime(i.deadlineAt)}</TableCell>
                <TableCell>
                  {i.label} <span className="text-xs text-muted-foreground">({i.subjectType})</span>
                </TableCell>
                <TableCell className="font-mono text-xs">{i.scheduleKey}</TableCell>
              </TableRow>
            ))}
            {labelled.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No deadlines in this window.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
