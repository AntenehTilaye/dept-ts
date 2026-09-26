import type { Db } from "@/lib/db/types";
import { declaredWeight, type ComponentDef } from "./results";
import { componentsOfSection } from "./service";

// What the assessment page shows. A section's marking is three things a person wants on one page:
// how it is marked, what the last import did, and what the marks came to — so this reads all three
// rather than making the page ask three services.

export interface SectionAssessment {
  section: {
    id: string;
    sectionCode: string;
    courseOfferingId: string;
    enrolledCount: number;
    lockedAt: Date | null;
  };
  course: { code: string; title: string };
  term: { id: string; name: string; yearCode: string };
  /** The components the section is marked on, and whether they add up to a hundred. */
  components: ComponentDef[];
  declaredWeight: number;
  structureLocked: boolean;
  /** Whether the section has its own override rather than the offering's scheme. */
  hasOverride: boolean;
  batches: {
    id: string;
    recordId: string;
    kind: string;
    createdAt: Date;
    committedAt: Date | null;
    replacedById: string | null;
    rows: number;
    message: string;
  }[];
  results: {
    studentId: string;
    studentNumber: string;
    fullName: string;
    total: number;
    letterGrade: string;
    outcome: string;
    marks: Record<string, number | null>;
  }[];
  snapshot: {
    computedAt: Date;
    studentCount: number;
    averageMark: number | null;
    passRate: number | null;
    completionRate: number | null;
    attendanceRate: number | null;
    frozen: boolean;
    gradeDistribution: Record<string, number>;
  } | null;
}

const num = (value: unknown): number => Number(value ?? 0);

export async function sectionAssessment(
  db: Db,
  sectionOfferingId: string,
): Promise<SectionAssessment | null> {
  const section = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    include: {
      courseOffering: {
        include: {
          course: { select: { code: true, title: true } },
          term: { select: { id: true, name: true, academicYear: { select: { code: true } } } },
        },
      },
      _count: { select: { enrollments: true } },
    },
  });
  if (!section) return null;

  const [components, own, batches, marks, results, snapshot] = await Promise.all([
    componentsOfSection(db, sectionOfferingId),
    db.assessmentScheme.findFirst({
      where: { sectionOfferingId },
      include: { components: { select: { id: true } } },
    }),
    db.importBatch.findMany({
      where: { contextType: "section_offering", contextId: sectionOfferingId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { replacedBy: { select: { id: true } } },
    }),
    db.assessmentRecord.findMany({
      where: { sectionOfferingId },
      include: {
        component: { select: { key: true } },
        student: { include: { person: { select: { fullName: true } } } },
      },
    }),
    db.studentCourseResult.findMany({
      where: { sectionOfferingId },
      include: { student: { include: { person: { select: { fullName: true } } } } },
    }),
    db.courseMetricsSnapshot.findFirst({
      where: { sectionOfferingId },
      orderBy: { computedAt: "desc" },
    }),
  ]);

  const marksByStudent = new Map<string, Record<string, number | null>>();
  const nameByStudent = new Map<string, { studentNumber: string; fullName: string }>();
  for (const row of marks) {
    const own = marksByStudent.get(row.studentId) ?? {};
    own[row.component.key] = row.mark === null ? null : num(row.mark);
    marksByStudent.set(row.studentId, own);
    nameByStudent.set(row.studentId, {
      studentNumber: row.student.studentNumber,
      fullName: row.student.person?.fullName ?? "",
    });
  }

  return {
    section: {
      id: section.id,
      sectionCode: section.sectionCode,
      courseOfferingId: section.courseOfferingId,
      enrolledCount: section._count.enrollments,
      lockedAt: section.assessmentLockedAt,
    },
    course: section.courseOffering.course,
    term: {
      id: section.courseOffering.term.id,
      name: section.courseOffering.term.name,
      yearCode: section.courseOffering.term.academicYear.code,
    },
    components,
    declaredWeight: declaredWeight(components),
    structureLocked: !!section.courseOffering.schemeStructureLockedAt,
    hasOverride: !!own?.components.length,
    batches: batches.map((batch) => {
      const summary = (batch.summaryJson ?? {}) as { rows?: number; message?: string };
      return {
        id: batch.id,
        recordId: batch.featureRecordId,
        kind: batch.kind,
        createdAt: batch.createdAt,
        committedAt: batch.committedAt,
        replacedById: batch.replacedBy[0]?.id ?? null,
        rows: summary.rows ?? 0,
        message: summary.message ?? "",
      };
    }),
    results: results
      .map((row) => ({
        studentId: row.studentId,
        studentNumber: row.student.studentNumber,
        fullName: row.student.person?.fullName ?? "",
        total: num(row.total),
        letterGrade: row.letterGrade,
        outcome: row.outcome,
        marks: marksByStudent.get(row.studentId) ?? {},
      }))
      .sort((a, b) => b.total - a.total),
    snapshot: snapshot
      ? {
          computedAt: snapshot.computedAt,
          studentCount: snapshot.studentCount,
          averageMark: snapshot.averageMark === null ? null : num(snapshot.averageMark),
          passRate: snapshot.passRate === null ? null : num(snapshot.passRate),
          completionRate: snapshot.completionRate === null ? null : num(snapshot.completionRate),
          attendanceRate: snapshot.attendanceRate === null ? null : num(snapshot.attendanceRate),
          frozen: snapshot.frozen,
          gradeDistribution: (snapshot.gradeDistributionJson ?? {}) as unknown as Record<
            string,
            number
          >,
        }
      : null,
  };
}

/** The sections somebody may mark: the ones they teach, or every one for whoever manages them. */
export async function markableSections(
  db: Db,
  personId: string | null,
  opts: { all?: boolean } = {},
): Promise<
  { id: string; sectionCode: string; courseCode: string; courseTitle: string; termName: string }[]
> {
  const rows = await db.sectionOffering.findMany({
    where: opts.all || !personId ? {} : { teachingAssignments: { some: { personId } } },
    include: {
      courseOffering: {
        include: {
          course: { select: { code: true, title: true } },
          term: { select: { name: true } },
        },
      },
    },
    orderBy: [{ courseOffering: { course: { code: "asc" } } }, { sectionCode: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    sectionCode: row.sectionCode,
    courseCode: row.courseOffering.course.code,
    courseTitle: row.courseOffering.course.title,
    termName: row.courseOffering.term.name,
  }));
}
