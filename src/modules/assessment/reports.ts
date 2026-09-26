import { z } from "zod";
import { globalSingleton } from "@/lib/singleton";
import { registerReport, type ReportContext, type ReportData } from "@/platform/reporting";
import type { ComponentStat } from "./metrics";

// How a course did, on paper. A department reports per offering with a row per section, because a
// course taught by three people in three rooms is three different experiences and the average of
// them hides that. The rows come from the snapshots the worker already computed.

const state = globalSingleton("assessment-reports", () => ({ installed: false }));

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const pct = (value: unknown): string => {
  const n = num(value);
  return n === null ? "" : `${Math.round(n * 1000) / 10}%`;
};

export function registerAssessmentReports(): void {
  if (state.installed) return;
  state.installed = true;

  registerReport({
    key: "course_performance",
    title: "Course performance",
    description:
      "One offering in full: how each section did, how the marks were distributed and which component the class struggled with.",
    requiredPermission: "assessment.view",
    formats: ["pdf", "xlsx", "csv", "html"],
    featureKey: "course_offering",
    parameters: z.object({ courseOfferingId: z.string().optional() }),
    parameterFields: [
      { name: "courseOfferingId", label: "Offering", type: "text", required: true },
    ],
    dataSource: coursePerformance,
  });
}

async function coursePerformance(ctx: ReportContext): Promise<ReportData> {
  const id = ctx.params.courseOfferingId as string | undefined;
  const offering = id
    ? await ctx.db.courseOffering.findFirst({
        // the offering and its record share nothing, so either id finds it
        where: { OR: [{ id }, { featureRecordId: id }] },
        include: {
          course: { select: { code: true, title: true } },
          term: { select: { name: true, academicYear: { select: { code: true } } } },
          sectionOfferings: { select: { id: true, sectionCode: true } },
        },
      })
    : null;

  if (!offering)
    return {
      title: "Course performance",
      subtitle: "No offering was named",
      tables: [],
      generatedAt: new Date(),
    };

  const [snapshots, results] = await Promise.all([
    ctx.db.courseMetricsSnapshot.findMany({
      where: { courseOfferingId: offering.id },
      orderBy: { computedAt: "desc" },
    }),
    ctx.db.studentCourseResult.findMany({
      where: { sectionOffering: { courseOfferingId: offering.id } },
      include: {
        student: { include: { person: { select: { fullName: true } } } },
        sectionOffering: { select: { sectionCode: true } },
      },
    }),
  ]);

  // the latest snapshot per section, and the offering-level one
  const latestBySection = new Map<string | null, (typeof snapshots)[number]>();
  for (const snapshot of snapshots)
    if (!latestBySection.has(snapshot.sectionOfferingId))
      latestBySection.set(snapshot.sectionOfferingId, snapshot);
  const whole = latestBySection.get(null) ?? null;
  const codeOf = new Map(offering.sectionOfferings.map((s) => [s.id, s.sectionCode]));

  const sectionRows = offering.sectionOfferings.map((section) => {
    const snapshot = latestBySection.get(section.id);
    return {
      section: section.sectionCode,
      students: snapshot?.studentCount ?? 0,
      average: num(snapshot?.averageMark) ?? "",
      passed: pct(snapshot?.passRate),
      failed: pct(snapshot?.failRate),
      complete: pct(snapshot?.completionRate),
      attendance: pct(snapshot?.attendanceRate),
      computed: snapshot?.computedAt.toISOString().slice(0, 10) ?? "",
      frozen: snapshot?.frozen ? "yes" : "",
    };
  });

  const distribution = (whole?.gradeDistributionJson ?? {}) as unknown as Record<string, number>;
  const componentStats = (whole?.componentStatsJson ?? []) as unknown as ComponentStat[];

  return {
    title: `${offering.course.code} ${offering.course.title}`,
    subtitle: `${offering.term.academicYear.code} ${offering.term.name} · course performance`,
    generatedAt: new Date(),
    stats: [
      { label: "Students", value: whole?.studentCount ?? 0 },
      { label: "Average", value: num(whole?.averageMark) ?? "—" },
      { label: "Passed", value: pct(whole?.passRate) || "—" },
      { label: "Sections", value: offering.sectionOfferings.length },
    ],
    tables: [
      {
        key: "sections",
        title: "By section",
        columns: [
          { key: "section", label: "Section" },
          { key: "students", label: "Students", type: "number" },
          { key: "average", label: "Average", type: "number" },
          { key: "passed", label: "Passed" },
          { key: "failed", label: "Failed" },
          { key: "complete", label: "Complete" },
          { key: "attendance", label: "Attendance" },
          { key: "computed", label: "Computed", type: "date" },
          { key: "frozen", label: "Frozen" },
        ],
        rows: sectionRows,
      },
      {
        key: "distribution",
        title: "Grade distribution",
        columns: [
          { key: "grade", label: "Grade" },
          { key: "students", label: "Students", type: "number" },
        ],
        rows: Object.entries(distribution)
          .filter(([, count]) => count > 0)
          .map(([grade, count]) => ({ grade, students: count })),
      },
      {
        key: "components",
        title: "By component",
        columns: [
          { key: "name", label: "Component" },
          { key: "outOf", label: "Out of", type: "number" },
          { key: "weight", label: "Worth" },
          { key: "marked", label: "Marked", type: "number" },
          { key: "missing", label: "Not sat", type: "number" },
          { key: "average", label: "Average", type: "number" },
          { key: "averagePercent", label: "Average %" },
          { key: "lowest", label: "Lowest", type: "number" },
          { key: "highest", label: "Highest", type: "number" },
        ],
        rows: componentStats.map((stat) => ({
          name: stat.name,
          outOf: stat.maxMark,
          weight: `${stat.weightPercent}%`,
          marked: stat.marked,
          missing: stat.missing,
          average: stat.averageMark ?? "",
          averagePercent: stat.averagePercent === null ? "" : `${stat.averagePercent}%`,
          lowest: stat.minMark ?? "",
          highest: stat.maxMarkAwarded ?? "",
        })),
      },
      {
        key: "students",
        title: "Results",
        columns: [
          { key: "section", label: "Section" },
          { key: "student", label: "Student" },
          { key: "total", label: "Total", type: "number" },
          { key: "grade", label: "Grade" },
          { key: "outcome", label: "Outcome" },
        ],
        rows: results
          .map((row) => ({
            section: codeOf.get(row.sectionOfferingId) ?? "",
            student: row.student.person?.fullName ?? row.student.studentNumber,
            total: num(row.total) ?? 0,
            grade: row.letterGrade,
            outcome: row.outcome,
          }))
          .sort((a, b) => a.section.localeCompare(b.section) || b.total - a.total),
      },
    ],
  };
}
