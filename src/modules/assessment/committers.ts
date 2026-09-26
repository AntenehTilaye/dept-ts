import { publish as emit } from "@/platform/audit/outbox";
import type { CommitContext, CommitSummary } from "@/platform/import";
import { ensurePerson } from "@/platform/people/persons";
import { upsertStudent } from "@/platform/people/students";
import { componentsOfSection, lockSchemeStructure } from "./service";

// Writing a validated sheet into the department. A mark sheet is the whole truth about a section:
// committing one replaces every mark the section has, so a second upload is a correction rather
// than an addition. Which batch it superseded is the pipeline's to record — this only reads it, for
// the sake of what the commit says it did. The figures that follow from the marks are not written
// here either: the worker recomputes them, because a recomputation has to be able to happen again
// without a commit to hang it on.

function markOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The batch this one supersedes, for the sake of what the commit says it did. The link itself is
 * written by the pipeline once the committer returns — this is a read, not a second answer.
 */
async function previousBatch(ctx: CommitContext): Promise<string | null> {
  const batch = await ctx.tx.importBatch.findUniqueOrThrow({
    where: { id: ctx.batchId },
    select: { kind: true, contextType: true, contextId: true },
  });
  const prior = await ctx.tx.importBatch.findFirst({
    where: {
      kind: batch.kind,
      contextType: batch.contextType,
      contextId: batch.contextId,
      committedAt: { not: null },
      id: { not: ctx.batchId },
    },
    orderBy: { committedAt: "desc" },
    select: { id: true },
  });
  return prior?.id ?? null;
}



export async function commitAssessment(
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const sectionOfferingId = ctx.context?.subjectId;
  if (!sectionOfferingId || ctx.context?.subjectType !== "section_offering")
    throw new Error("A sheet of marks belongs to one section of one offering");

  const section = await ctx.tx.sectionOffering.findUniqueOrThrow({
    where: { id: sectionOfferingId },
    select: { courseOfferingId: true },
  });
  const components = await componentsOfSection(ctx.tx, sectionOfferingId);
  const componentIds = new Map(
    (
      await ctx.tx.assessmentComponent.findMany({
        where: {
          scheme: {
            OR: [
              { sectionOfferingId },
              { courseOfferingId: section.courseOfferingId, sectionOfferingId: null },
            ],
          },
        },
        select: { id: true, key: true, schemeId: true, scheme: { select: { sectionOfferingId: true } } },
      })
    )
      // a section override wins over the offering's component of the same key
      .sort((a, b) => Number(!!a.scheme.sectionOfferingId) - Number(!!b.scheme.sectionOfferingId))
      .map((row) => [row.key, row.id]),
  );

  const prior = await previousBatch(ctx);
  // the section's marks are replaced as a whole: what the file does not say, the section no
  // longer holds
  await ctx.tx.assessmentRecord.deleteMany({ where: { sectionOfferingId } });

  const counts = { students: 0, marks: 0, missing: 0 };
  for (const row of rows) {
    const studentId = row.student_id as string | null;
    if (!studentId) continue;
    counts.students += 1;
    const marks = (row.marks ?? {}) as Record<string, unknown>;
    for (const component of components) {
      const componentId = componentIds.get(component.key);
      if (!componentId) continue;
      const mark = markOf(marks[component.key]);
      await ctx.tx.assessmentRecord.create({
        data: {
          departmentId: ctx.departmentId,
          sectionOfferingId,
          studentId,
          componentId,
          mark,
          isMissing: mark === null,
          importBatchId: ctx.batchId,
        },
      });
      if (mark === null) counts.missing += 1;
      else counts.marks += 1;
    }
  }

  // the first marks fix the structure they were entered against
  await lockSchemeStructure(ctx.tx, ctx.departmentId, section.courseOfferingId);
  await emit(
    ctx.tx,
    "assessment.committed",
    { subjectType: "section_offering", subjectId: sectionOfferingId },
    { importBatchId: ctx.batchId, courseOfferingId: section.courseOfferingId, replaced: prior },
    { departmentId: ctx.departmentId },
  );

  return {
    counts,
    message: `${counts.students} student(s), ${counts.marks} mark(s)${
      counts.missing ? `, ${counts.missing} left blank` : ""
    }${prior ? " — the previous sheet was replaced" : ""}`,
  };
}

export async function commitAttendance(
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const sectionOfferingId = ctx.context?.subjectId;
  if (!sectionOfferingId || ctx.context?.subjectType !== "section_offering")
    throw new Error("An attendance sheet belongs to one section of one offering");

  const prior = await previousBatch(ctx);
  await ctx.tx.studentAttendanceSummary.deleteMany({ where: { sectionOfferingId } });

  let students = 0;
  for (const row of rows) {
    const studentId = row.student_id as string | null;
    if (!studentId) continue;
    await ctx.tx.studentAttendanceSummary.create({
      data: {
        departmentId: ctx.departmentId,
        sectionOfferingId,
        studentId,
        sessionsHeld: Number(row.sessions_held ?? 0),
        sessionsAttended: Number(row.sessions_attended ?? 0),
        importBatchId: ctx.batchId,
      },
    });
    students += 1;
  }

  const section = await ctx.tx.sectionOffering.findUniqueOrThrow({
    where: { id: sectionOfferingId },
    select: { courseOfferingId: true },
  });
  await emit(
    ctx.tx,
    "attendance.committed",
    { subjectType: "section_offering", subjectId: sectionOfferingId },
    { importBatchId: ctx.batchId, courseOfferingId: section.courseOfferingId, replaced: prior },
    { departmentId: ctx.departmentId },
  );

  return {
    counts: { students },
    message: `${students} student(s)${prior ? " — the previous sheet was replaced" : ""}`,
  };
}

export async function commitStudents(
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const counts = { persons: 0, students: 0 };
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

    await upsertStudent(ctx.tx, ctx.departmentId, person.id, {
      studentNumber,
      programId: row.program_id as string,
      admissionYear: Number(row.admission_year),
    });
    counts.students += 1;
  }

  return {
    counts,
    message: `${counts.students} student(s), ${counts.persons} new`,
  };
}
