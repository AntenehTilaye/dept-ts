import type { PrismaClient } from "../../../src/generated/prisma/client";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { runWithAudit } from "../../../src/platform/audit/context";
import { act } from "../../../src/platform/feature";
import { setComponents } from "../../../src/modules/assessment/service";
import {
  freezeSnapshots,
  recomputeOffering,
  recomputeSection,
} from "../../../src/modules/assessment/snapshots";

// Demo assessment data (SEED_DEMO=1): a scheme for the current CS201, a saved mapping profile so
// the same spreadsheet never has to be explained twice, and a previous year whose marks are in and
// whose figures are frozen — which is the baseline a course-quality comparison needs.

const DEPARTMENT_ID = "dep_cs";

const SCHEME = [
  { key: "quiz", name: "Quiz", maxMark: 10, weightPercent: 10, isFinal: false },
  { key: "mid", name: "Mid-semester", maxMark: 30, weightPercent: 30, isFinal: false },
  { key: "final", name: "Final", maxMark: 60, weightPercent: 60, isFinal: true },
];

/**
 * The marks of the closed year, so there is something to compare this year against. The numbers are
 * the demo department's own (`prisma/seed/demo/people.ts`), and the last student never sat the final,
 * which is what an incomplete result looks like in the figures.
 */
const PREVIOUS_MARKS: [string, number | null, number | null, number | null][] = [
  ["CS/2001/24", 8, 22, 44],
  ["CS/2002/24", 6, 17, 31],
  ["CS/2003/24", 9, 26, 51],
  ["CS/2004/24", 4, 12, null],
];

export async function seedDemoImports(db: PrismaClient) {
  const head = await db.person.findFirst({ where: { email: "dh.cs@deptts.local" } });
  if (!head?.userId) return;
  const actor = {
    userId: head.userId,
    personId: head.id,
    departmentId: DEPARTMENT_ID,
    isAdmin: false,
  };

  // the way this department's own workbook spells its headers, saved once
  const existingProfile = await db.columnMappingProfile.findFirst({
    where: { departmentId: DEPARTMENT_ID, kind: "assessment" },
  });
  if (!existingProfile)
    await db.columnMappingProfile.create({
      data: {
        departmentId: DEPARTMENT_ID,
        kind: "assessment",
        name: "Departmental mark sheet",
        mappingsJson: {
          student_number: "ID No.",
          full_name: "Student Name",
          "component:quiz": "Quiz",
          "component:mid": "Mid",
          "component:final": "Final",
        },
      },
    });

  await runWithAudit(
    { departmentId: DEPARTMENT_ID, actorUserId: head.userId, correlationId: "seed:demo-imports" },
    async () => {
      await withTenantTx(DEPARTMENT_ID, async (tx) => {
        // this year's CS201 is marked but not yet imported: the scheme is what a marker needs
        const current = await tx.courseOffering.findFirst({
          where: { course: { code: "CS201" }, term: { status: { not: "closed" } } },
          orderBy: { createdAt: "desc" },
        });
        if (current && !current.schemeStructureLockedAt)
          await setComponents(tx, DEPARTMENT_ID, { courseOfferingId: current.id }, SCHEME);

        // the closed year's CS200 has its marks in, its results computed and its figures frozen
        const previous = await tx.courseOffering.findFirst({
          where: { course: { code: "CS200" } },
          include: { sectionOfferings: true },
          orderBy: { createdAt: "asc" },
        });
        const section = previous?.sectionOfferings[0];
        if (!previous || !section) return;
        // the marks are written once; the figures are derived, so they are recomputed every time —
        // a seed that cannot repair derived data is a seed that leaves a database half right
        const alreadyMarked = !!(await tx.assessmentRecord.findFirst({
          where: { sectionOfferingId: section.id },
        }));

        if (!previous.schemeStructureLockedAt)
          await setComponents(tx, DEPARTMENT_ID, { courseOfferingId: previous.id }, SCHEME);
        const components = await tx.assessmentComponent.findMany({
          where: { scheme: { courseOfferingId: previous.id, sectionOfferingId: null } },
        });
        const byKey = new Map(components.map((c) => [c.key, c.id]));

        // the batch stands for a sheet that was handed in before this system existed, so it is
        // keyed on the section rather than on a record somebody created
        const batch = await tx.importBatch.upsert({
          where: { featureRecordId: `demo-marks-${section.id}` },
          update: {},
          create: {
            departmentId: DEPARTMENT_ID,
            kind: "assessment",
            contextType: "section_offering",
            contextId: section.id,
            mode: "file",
            featureRecordId: `demo-marks-${section.id}`,
            uploadedBy: actor.userId,
            committedAt: new Date(),
            summaryJson: { rows: PREVIOUS_MARKS.length, message: "Seeded as the previous year's record" },
          },
        });

        for (const [studentNumber, quiz, mid, final] of alreadyMarked ? [] : PREVIOUS_MARKS) {
          const student = await tx.student.findFirst({ where: { studentNumber } });
          if (!student) continue;
          // a student of the closed year has to be enrolled in it for the marks to mean anything
          await tx.enrollment.upsert({
            where: {
              sectionOfferingId_studentId: {
                sectionOfferingId: section.id,
                studentId: student.personId,
              },
            },
            update: {},
            create: {
              departmentId: DEPARTMENT_ID,
              sectionOfferingId: section.id,
              studentId: student.personId,
              status: "enrolled",
              source: "import",
            },
          });
          for (const [key, mark] of [
            ["quiz", quiz],
            ["mid", mid],
            ["final", final],
          ] as const) {
            const componentId = byKey.get(key);
            if (!componentId) continue;
            await tx.assessmentRecord.create({
              data: {
                departmentId: DEPARTMENT_ID,
                sectionOfferingId: section.id,
                studentId: student.personId,
                componentId,
                mark,
                isMissing: mark === null,
                importBatchId: batch.id,
              },
            });
          }
          await tx.studentAttendanceSummary.upsert({
            where: {
              sectionOfferingId_studentId: {
                sectionOfferingId: section.id,
                studentId: student.personId,
              },
            },
            update: {},
            create: {
              departmentId: DEPARTMENT_ID,
              sectionOfferingId: section.id,
              studentId: student.personId,
              sessionsHeld: 28,
              sessionsAttended: final === null ? 12 : 26,
              importBatchId: batch.id,
            },
          });
        }

        // the figures follow from the marks, and a year that is over has its figures frozen —
        // closing the offering is what freezes them, and one already closed is frozen directly
        await recomputeSection(tx, DEPARTMENT_ID, section.id);
        await recomputeOffering(tx, DEPARTMENT_ID, previous.id);
        const record = await tx.featureRecord.findUnique({
          where: { id: previous.featureRecordId },
        });
        if (record?.currentStateKey === "running")
          await act(tx, previous.featureRecordId, "running", "complete", actor);
        else await freezeSnapshots(tx, previous.id);
      });
    },
  );
}
