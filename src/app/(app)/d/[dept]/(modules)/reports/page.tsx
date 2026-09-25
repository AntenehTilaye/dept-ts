import { FileBarChart2Icon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { downloadUrl } from "@/platform/document";
import { actorOf } from "@/lib/auth/require";
import { listReports } from "@/platform/reporting";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ReportCard } from "@/modules/reports/ReportCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

// Every report this person may run, and what they have run lately. A report that takes a while
// is prepared by the worker, so the list is where it lands.

export default async function ReportsPage(props: PageProps<"/d/[dept]/reports">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const all = listReports();
  const allowed = [];
  for (const report of all) {
    const decision = await canDo(ctx, report.requiredPermission, undefined, "read");
    if (decision.allowed) allowed.push(report);
  }

  const runs = await db.generatedReport.findMany({
    where: { departmentId: ctx.departmentId },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  const titleOf = new Map(all.map((r) => [r.key, r.title]));
  // a download link is signed for the reader and lasts five minutes, so it is minted per render
  const links = new Map<string, string>();
  for (const run of runs) {
    if (!run.documentId) continue;
    const link = await downloadUrl(db, actorOf(ctx), run.documentId).catch(() => null);
    if (link) links.set(run.id, link.url);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="What the department can put on paper: the same rows as a page, a workbook, a csv or a PDF."
      />

      {allowed.length === 0 ? (
        <EmptyState
          icon={<FileBarChart2Icon />}
          title="No reports for your role"
          hint="Reports appear here as your department's modules are set up."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {allowed.map((report) => (
            <ReportCard
              key={report.key}
              dept={dept}
              reportKey={report.key}
              title={report.title}
              description={report.description}
              formats={report.formats}
              fields={report.parameterFields ?? []}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recently generated</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been generated yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} data-testid={`run-${run.id}`} data-status={run.status}>
                    <TableCell>{titleOf.get(run.reportKey) ?? run.reportKey}</TableCell>
                    <TableCell className="uppercase">{run.format}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                      {run.error ? (
                        <span className="ml-2 text-xs text-muted-foreground">{run.error}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </TableCell>
                    <TableCell>
                      {links.get(run.id) ? (
                        <a className="underline" href={links.get(run.id)}>
                          Download
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
