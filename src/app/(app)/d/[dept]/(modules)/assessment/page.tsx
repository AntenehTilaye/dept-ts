import Link from "next/link";
import type { Route } from "next";
import { dbOf, pageContext } from "@/lib/auth/page";
import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import { markableSections } from "@/modules/assessment/queries";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

// The sections somebody may mark. An instructor sees the ones they teach; whoever manages the
// registry sees all of them, because somebody has to be able to mark a section whose instructor
// has left.

export default async function AssessmentPage(props: PageProps<"/d/[dept]/assessment">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const manage = await can(
    dbPolicyStore,
    {
      userId: ctx.user.id,
      personId: ctx.personId,
      departmentId: ctx.departmentId,
      isAdmin: ctx.isAdmin,
    },
    "academic.manage",
    undefined,
    { verb: "manage" },
  );
  const sections = await markableSections(db, ctx.personId, { all: manage.allowed });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marking"
        description={
          manage.allowed
            ? "Every section of the department, with the marks it holds."
            : "The sections you teach."
        }
      />
      {sections.length ? (
        <Table data-testid="markable-sections">
          <TableHeader>
            <TableRow>
              <TableHead>Course</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Term</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) => (
              <TableRow key={section.id} data-testid={`section-${section.id}`}>
                <TableCell>
                  <Link
                    href={`/d/${dept}/assessment/${section.id}` as Route}
                    className="underline underline-offset-2"
                  >
                    <span className="font-mono">{section.courseCode}</span> {section.courseTitle}
                  </Link>
                </TableCell>
                <TableCell>{section.sectionCode}</TableCell>
                <TableCell>{section.termName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title="You are not marking anything at the moment"
          hint="A section appears here once you hold a teaching assignment on it."
        />
      )}
    </div>
  );
}
