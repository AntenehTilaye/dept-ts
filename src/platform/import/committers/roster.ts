import { ensurePerson } from "../../people/persons";
import { setSectionMembership, upsertStudent } from "../../people/students";
import type { CommitContext, CommitSummary } from "./registry";

// Committing a roster is four upserts per row: the person, their place in the department, the
// student record the number belongs to, and the section they are in this year. Everything is
// keyed on what identifies it — the student number, the section, the year — so committing the
// same file twice changes nothing.

export async function commitRoster(
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const counts = { persons: 0, students: 0, memberships: 0 };
  const year = await ctx.tx.academicYear.findFirst({
    where: { status: "active" },
    orderBy: { startDate: "desc" },
  });

  for (const row of rows) {
    const studentNumber = String(row.student_number ?? "").trim();
    if (!studentNumber) continue;

    const existing = await ctx.tx.student.findFirst({
      where: { studentNumber },
      select: { personId: true },
    });
    const person = existing
      ? await ctx.tx.person.update({
          where: { id: existing.personId },
          data: { fullName: String(row.full_name ?? "").trim() || undefined },
        })
      : await ensurePerson(ctx.tx, {
          fullName: String(row.full_name ?? "").trim(),
          email: (row.email as string | null) ?? null,
          type: "student",
        });
    if (!existing) counts.persons += 1;

    const programId =
      (row.program_id as string | null) ??
      (
        await ctx.tx.student.findFirst({
          where: { personId: person.id },
          select: { programId: true },
        })
      )?.programId ??
      (await ctx.tx.program.findFirstOrThrow({ select: { id: true } })).id;

    const student = await upsertStudent(ctx.tx, ctx.departmentId, person.id, {
      studentNumber,
      programId,
      admissionYear: Number(row.admission_year) || new Date().getFullYear(),
    });
    counts.students += 1;

    const sectionId = (row.section_id as string | null) ?? sectionOfContext(ctx);
    if (sectionId && year) {
      await setSectionMembership(ctx.tx, ctx.departmentId, {
        studentId: student.personId,
        sectionId,
        academicYearId: year.id,
        source: "import",
      });
      counts.memberships += 1;
    }
  }

  return {
    counts,
    message: `${counts.students} student(s), ${counts.memberships} section membership(s)`,
  };
}

/** A roster uploaded from a section page is about that section, whatever the rows say. */
function sectionOfContext(ctx: CommitContext): string | null {
  return ctx.context?.subjectType === "section" ? ctx.context.subjectId : null;
}
