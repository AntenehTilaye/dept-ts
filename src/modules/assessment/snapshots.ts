import { createHash } from "node:crypto";
import { toJson } from "@/lib/db/json";
import type { Db } from "@/lib/db/types";
import { consolidate, computeMetrics, type AttendanceRow, type MarkRow, type Metrics, type ResultRow } from "./metrics";
import { computeResult, type ComponentDef } from "./results";
import { componentsOfSection } from "./service";

// Turning committed marks into the figures a department reports. Everything here is derived, so it
// is recomputed from the tables rather than accumulated: running it twice on the same marks writes
// the same rows, and a snapshot somebody has already reported on is frozen and left alone.

export interface ComputeResult {
  sectionOfferingId: string;
  students: number;
  /** false when the snapshot was frozen and therefore left as it was. */
  snapshotWritten: boolean;
}

const num = (value: unknown): number => Number(value ?? 0);

/** What the figures were computed from, so an unchanged sheet needs no recomputation. */
function hashOf(marks: MarkRow[], attendance: AttendanceRow[]): string {
  const payload = [
    ...marks
      .map((m) => `${m.studentId}:${m.componentKey}:${m.mark ?? ""}`)
      .sort(),
    ...attendance.map((a) => `${a.studentId}:${a.sessionsHeld}:${a.sessionsAttended}`).sort(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

async function marksOf(db: Db, sectionOfferingId: string): Promise<{ marks: MarkRow[]; batchId: string | null }> {
  const rows = await db.assessmentRecord.findMany({
    where: { sectionOfferingId },
    include: { component: { select: { key: true } } },
  });
  return {
    marks: rows.map((row) => ({
      studentId: row.studentId,
      componentKey: row.component.key,
      mark: row.mark === null ? null : num(row.mark),
    })),
    batchId: rows[0]?.importBatchId ?? null,
  };
}

/**
 * Recomputes one section: every student's result, then the section's snapshot. The results are
 * rewritten in place — a result is the current answer, not a history — and the snapshot is a new
 * row each time so a department can see what it reported and when.
 */
export async function recomputeSection(
  db: Db,
  departmentId: string,
  sectionOfferingId: string,
): Promise<ComputeResult> {
  const section = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    include: { courseOffering: { select: { id: true, termId: true } } },
  });
  if (!section) return { sectionOfferingId, students: 0, snapshotWritten: false };

  const components = await componentsOfSection(db, sectionOfferingId);
  const { marks, batchId } = await marksOf(db, sectionOfferingId);
  const attendanceRows = await db.studentAttendanceSummary.findMany({ where: { sectionOfferingId } });
  const attendance: AttendanceRow[] = attendanceRows.map((row) => ({
    studentId: row.studentId,
    sessionsHeld: row.sessionsHeld,
    sessionsAttended: row.sessionsAttended,
  }));

  const studentIds = Array.from(new Set(marks.map((m) => m.studentId)));
  const scaleByStudent = new Map(
    (
      await db.student.findMany({
        where: { personId: { in: studentIds } },
        select: { personId: true, program: { select: { gradeScaleKey: true } } },
      })
    ).map((row) => [row.personId, row.program.gradeScaleKey]),
  );

  const computedAt = new Date();
  const results: ResultRow[] = [];
  for (const studentId of studentIds) {
    const own = marks.filter((m) => m.studentId === studentId);
    const result = computeResult(
      components,
      own.map((m) => ({ componentKey: m.componentKey, mark: m.mark })),
      scaleByStudent.get(studentId) ?? "default",
    );
    results.push({
      studentId,
      total: result.total,
      letterGrade: result.letterGrade,
      outcome: result.outcome,
    });
    const data = {
      departmentId,
      total: result.total,
      letterGrade: result.letterGrade,
      outcome: result.outcome,
      gradeScaleKey: result.gradeScaleKey,
      computedAt,
      sourceImportBatchId: batchId ?? "",
    };
    await db.studentCourseResult.upsert({
      where: { sectionOfferingId_studentId: { sectionOfferingId, studentId } },
      update: data,
      create: { ...data, sectionOfferingId, studentId },
    });
  }
  // a student whose row left the sheet has no result any more
  await db.studentCourseResult.deleteMany({
    where: { sectionOfferingId, studentId: { notIn: studentIds.length ? studentIds : ["-"] } },
  });

  const metrics = computeMetrics({
    components,
    results,
    marks,
    attendance,
    gradeScaleKey: scaleByStudent.get(studentIds[0] ?? "") ?? "default",
  });
  const written = await writeSnapshot(db, departmentId, {
    courseOfferingId: section.courseOffering.id,
    sectionOfferingId,
    termId: section.courseOffering.termId,
    metrics,
    sourceHash: hashOf(marks, attendance),
    computedAt,
  });

  return { sectionOfferingId, students: results.length, snapshotWritten: written };
}

/** The offering's snapshot, consolidated from its sections' latest ones. */
export async function recomputeOffering(
  db: Db,
  departmentId: string,
  courseOfferingId: string,
): Promise<{ sections: number; snapshotWritten: boolean }> {
  const offering = await db.courseOffering.findUnique({
    where: { id: courseOfferingId },
    select: { termId: true, sectionOfferings: { select: { id: true } } },
  });
  if (!offering) return { sections: 0, snapshotWritten: false };

  const perSection: Metrics[] = [];
  for (const section of offering.sectionOfferings) {
    const latest = await db.courseMetricsSnapshot.findFirst({
      where: { courseOfferingId, sectionOfferingId: section.id },
      orderBy: { computedAt: "desc" },
    });
    if (!latest) continue;
    perSection.push({
      studentCount: latest.studentCount,
      averageMark: latest.averageMark === null ? null : num(latest.averageMark),
      passRate: latest.passRate === null ? null : num(latest.passRate),
      failRate: latest.failRate === null ? null : num(latest.failRate),
      gradeDistribution: (latest.gradeDistributionJson ?? {}) as unknown as Record<string, number>,
      componentStats: (latest.componentStatsJson ?? []) as unknown as Metrics["componentStats"],
      completionRate: latest.completionRate === null ? null : num(latest.completionRate),
      attendanceRate: latest.attendanceRate === null ? null : num(latest.attendanceRate),
    });
  }
  if (!perSection.length) return { sections: 0, snapshotWritten: false };

  const metrics = consolidate(perSection);
  const written = await writeSnapshot(db, departmentId, {
    courseOfferingId,
    sectionOfferingId: null,
    termId: offering.termId,
    metrics,
    sourceHash: hashOf([], []),
    computedAt: new Date(),
  });
  return { sections: perSection.length, snapshotWritten: written };
}

/**
 * Writes a snapshot unless the latest one is frozen (the department has reported on it) or says
 * the same thing (the same marks produce the same hash).
 */
async function writeSnapshot(
  db: Db,
  departmentId: string,
  input: {
    courseOfferingId: string;
    sectionOfferingId: string | null;
    termId: string;
    metrics: Metrics;
    sourceHash: string;
    computedAt: Date;
  },
): Promise<boolean> {
  const latest = await db.courseMetricsSnapshot.findFirst({
    where: {
      courseOfferingId: input.courseOfferingId,
      sectionOfferingId: input.sectionOfferingId,
    },
    orderBy: { computedAt: "desc" },
  });
  if (latest?.frozen) return false;

  const { metrics } = input;
  const data = {
    departmentId,
    courseOfferingId: input.courseOfferingId,
    sectionOfferingId: input.sectionOfferingId,
    termId: input.termId,
    averageMark: metrics.averageMark,
    passRate: metrics.passRate,
    failRate: metrics.failRate,
    gradeDistributionJson: toJson(metrics.gradeDistribution),
    componentStatsJson: toJson(metrics.componentStats),
    completionRate: metrics.completionRate,
    attendanceRate: metrics.attendanceRate,
    studentCount: metrics.studentCount,
    computedAt: input.computedAt,
    sourceHash: input.sourceHash,
  };
  // one snapshot per (offering, section) unless a frozen one has to be kept beside a new reading
  if (latest) await db.courseMetricsSnapshot.update({ where: { id: latest.id }, data });
  else await db.courseMetricsSnapshot.create({ data });
  return true;
}

/** Freezes the latest snapshots of an offering: what a portfolio quoted must stop moving. */
export async function freezeSnapshots(db: Db, courseOfferingId: string): Promise<number> {
  const rows = await db.courseMetricsSnapshot.findMany({
    where: { courseOfferingId, frozen: false },
    select: { id: true },
  });
  for (const row of rows)
    await db.courseMetricsSnapshot.update({ where: { id: row.id }, data: { frozen: true } });
  return rows.length;
}

export type { ComponentDef };
