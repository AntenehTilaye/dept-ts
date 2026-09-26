import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";
import { requireCan } from "@/lib/auth/require";
import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import { sectionAssessment } from "@/modules/assessment/queries";
import { MarkSheetUpload } from "@/modules/assessment/components/MarkSheetUpload";
import { SchemeEditor } from "@/modules/assessment/components/SchemeEditor";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatCard } from "@/components/patterns/StatCard";
import { Badge } from "@/components/ui/badge";
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

// Marking one section: how it is marked, the sheets that have been handed in, and what the marks
// came to. The import itself is the `import_batch` process on its own pages — this page starts one
// and shows what it produced.

const pct = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 1000) / 10}%`;

const OUTCOME_TONE: Record<string, "secondary" | "destructive" | "outline"> = {
  pass: "secondary",
  fail: "destructive",
  incomplete: "outline",
};

export default async function SectionAssessmentPage(
  props: PageProps<"/d/[dept]/assessment/[sectionOfferingId]">,
) {
  const { dept, sectionOfferingId } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const subject = { subjectType: "section_offering", subjectId: sectionOfferingId };
  await requireCan(ctx, "assessment.view", subject, "read");

  const data = await sectionAssessment(db, sectionOfferingId);
  if (!data) notFound();

  const actor = {
    userId: ctx.user.id,
    personId: ctx.personId,
    departmentId: ctx.departmentId,
    isAdmin: ctx.isAdmin,
  };
  const [mayImport, mayManage] = await Promise.all([
    can(dbPolicyStore, actor, "assessment.import", subject, { verb: "submit" }),
    can(dbPolicyStore, actor, "academic.manage", undefined, { verb: "manage" }),
  ]);

  const markable = data.components.length > 0 && Math.abs(data.declaredWeight - 100) < 0.01;
  const locked = !!data.section.lockedAt;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: "Offerings", href: `/d/${dept}/offerings` },
          {
            label: data.course.code,
            href: `/d/${dept}/offerings/${data.section.courseOfferingId}`,
          },
          { label: data.section.sectionCode },
        ]}
        title={
          <>
            <span className="font-mono">{data.course.code}</span> {data.section.sectionCode}
          </>
        }
        description={
          <>
            {data.course.title} · {data.term.yearCode} {data.term.name} ·{" "}
            {data.section.enrolledCount} enrolled
            {locked ? " · assessment locked" : ""}
            {data.hasOverride ? " · this section has its own scheme" : ""}
          </>
        }
      />

      {data.snapshot ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="section-figures"
        >
          <StatCard label="Students marked" value={data.snapshot.studentCount} />
          <StatCard
            label="Average"
            value={data.snapshot.averageMark === null ? "—" : data.snapshot.averageMark}
            hint="out of 100"
          />
          <StatCard
            label="Passed"
            value={pct(data.snapshot.passRate)}
            tone={
              data.snapshot.passRate !== null && data.snapshot.passRate < 0.5 ? "warning" : "default"
            }
          />
          <StatCard
            label="Complete"
            value={pct(data.snapshot.completionRate)}
            hint={data.snapshot.frozen ? "frozen" : "recomputed on every commit"}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How it is marked</CardTitle>
          <CardDescription>
            The components of the offering&apos;s scheme. Every mark sheet has one column per
            component, and the weights have to add up to a hundred before a sheet can be read.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mayManage.allowed ? (
            <SchemeEditor
              dept={dept}
              courseOfferingId={data.section.courseOfferingId}
              initial={data.components.map((c) => ({
                key: c.key,
                name: c.name,
                maxMark: c.maxMark,
                weightPercent: c.weightPercent,
                isFinal: c.isFinal,
                excludedFromConsolidation: c.excludedFromConsolidation,
              }))}
              locked={data.structureLocked}
            />
          ) : data.components.length ? (
            <ul className="flex flex-col gap-1 text-sm" data-testid="scheme-readonly">
              {data.components.map((component) => (
                <li key={component.key} className="flex items-center justify-between gap-3">
                  <span>
                    {component.name} {component.isFinal ? <Badge variant="outline">final</Badge> : null}
                  </span>
                  <span className="text-muted-foreground">
                    out of {component.maxMark} · worth {component.weightPercent}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              title="This course has no assessment scheme yet"
              hint="Somebody who manages the registry sets out the components before marks can be read."
            />
          )}
        </CardContent>
      </Card>

      {mayImport.allowed ? (
        <Card>
          <CardHeader>
            <CardTitle>Hand in a sheet</CardTitle>
            <CardDescription>
              Download the template, fill it in and upload it. Nothing is written until you have
              seen what came out of the file and committed it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MarkSheetUpload
              dept={dept}
              sectionOfferingId={sectionOfferingId}
              disabled={!markable || locked}
              disabledReason={
                locked
                  ? "This section's assessment is locked because a portfolio has quoted it."
                  : "The scheme has to add up to a hundred before a sheet can be read."
              }
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sheets handed in</CardTitle>
          <CardDescription>
            The most recent committed sheet is what the section holds; the ones before it are kept
            as the record of what was replaced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.batches.length ? (
            <Table data-testid="batch-history">
              <TableHeader>
                <TableRow>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Of</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.batches.map((batch) => (
                  <TableRow key={batch.id} data-testid={`batch-${batch.id}`}>
                    <TableCell>
                      <Link
                        href={`/d/${dept}/imports/${batch.recordId}` as Route}
                        className="underline underline-offset-2"
                      >
                        {batch.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </Link>
                    </TableCell>
                    <TableCell>{batch.kind}</TableCell>
                    <TableCell className="tabular-nums">{batch.rows}</TableCell>
                    <TableCell>
                      {batch.replacedById ? (
                        <Badge variant="outline">replaced</Badge>
                      ) : batch.committedAt ? (
                        <Badge variant="secondary">committed</Badge>
                      ) : (
                        <Badge variant="outline">unfinished</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState compact title="No sheet has been handed in for this section yet" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          <CardDescription>
            Computed from the marks and the programme&apos;s grade scale, and recomputed whenever
            either changes. A blank cell is a component the student did not sit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.results.length ? (
            <Table data-testid="results-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  {data.components.map((component) => (
                    <TableHead key={component.key} className="text-right">
                      {component.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.map((row) => (
                  <TableRow key={row.studentId} data-testid={`result-${row.studentNumber}`}>
                    <TableCell>
                      <span className="font-mono text-xs">{row.studentNumber}</span> {row.fullName}
                    </TableCell>
                    {data.components.map((component) => (
                      <TableCell key={component.key} className="text-right tabular-nums">
                        {row.marks[component.key] ?? "—"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.total}
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTCOME_TONE[row.outcome] ?? "outline"}>
                        {row.letterGrade}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              compact
              title="Nothing has been marked yet"
              hint="Commit a sheet of marks and the results appear here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
