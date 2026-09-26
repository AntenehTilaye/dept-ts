import { gradeScale, lettersOf } from "./grade-scales";
import { round2, type ComponentDef } from "./results";

// What a department wants to know about a course once the marks are in: how they were
// distributed, who passed, which component everybody struggled with, and how much of the course
// the class actually attended. All of it is arithmetic over rows somebody already committed, so it
// is recomputable from scratch and nothing here is the only copy of anything.

export interface ResultRow {
  studentId: string;
  total: number;
  letterGrade: string;
  outcome: "pass" | "fail" | "incomplete";
}

export interface MarkRow {
  studentId: string;
  componentKey: string;
  mark: number | null;
}

export interface AttendanceRow {
  studentId: string;
  sessionsHeld: number;
  sessionsAttended: number;
}

export interface ComponentStat {
  key: string;
  name: string;
  maxMark: number;
  weightPercent: number;
  /** How many students have a mark for it. */
  marked: number;
  missing: number;
  averageMark: number | null;
  /** As a percentage of the component's maximum, so components of different sizes compare. */
  averagePercent: number | null;
  minMark: number | null;
  maxMarkAwarded: number | null;
}

export interface Metrics {
  studentCount: number;
  averageMark: number | null;
  passRate: number | null;
  failRate: number | null;
  /** Every letter the scale can produce, so an empty band reads as zero rather than as absent. */
  gradeDistribution: Record<string, number>;
  componentStats: ComponentStat[];
  /** The share of students with a complete set of marks. */
  completionRate: number | null;
  attendanceRate: number | null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

/** A rate as a fraction of one, to four places — what the snapshot column holds. */
function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10_000) / 10_000;
}

export function computeMetrics(input: {
  components: ComponentDef[];
  results: ResultRow[];
  marks: MarkRow[];
  attendance?: AttendanceRow[];
  gradeScaleKey?: string;
}): Metrics {
  const { components, results, marks } = input;
  const scale = gradeScale(input.gradeScaleKey);
  const studentCount = results.length;

  const distribution: Record<string, number> = {};
  for (const letter of lettersOf(scale)) distribution[letter] = 0;
  // an incomplete result has no letter on the scale; it is counted where a reader looks for it
  distribution.I = 0;
  for (const row of results) distribution[row.letterGrade] = (distribution[row.letterGrade] ?? 0) + 1;

  const decided = results.filter((r) => r.outcome !== "incomplete");
  const passed = decided.filter((r) => r.outcome === "pass").length;

  const byComponent = new Map<string, MarkRow[]>();
  for (const row of marks) {
    const list = byComponent.get(row.componentKey) ?? [];
    list.push(row);
    byComponent.set(row.componentKey, list);
  }

  const componentStats: ComponentStat[] = components.map((component) => {
    const rows = byComponent.get(component.key) ?? [];
    const marked = rows.filter((r) => r.mark !== null).map((r) => r.mark!);
    const average = mean(marked);
    return {
      key: component.key,
      name: component.name,
      maxMark: component.maxMark,
      weightPercent: component.weightPercent,
      marked: marked.length,
      missing: Math.max(studentCount - marked.length, 0),
      averageMark: average,
      averagePercent:
        average !== null && component.maxMark > 0 ? round2((average / component.maxMark) * 100) : null,
      minMark: marked.length ? Math.min(...marked) : null,
      maxMarkAwarded: marked.length ? Math.max(...marked) : null,
    };
  });

  const complete = results.filter((r) => r.outcome !== "incomplete").length;

  const attendance = input.attendance ?? [];
  const held = attendance.reduce((sum, a) => sum + a.sessionsHeld, 0);
  const attended = attendance.reduce((sum, a) => sum + a.sessionsAttended, 0);

  return {
    studentCount,
    averageMark: mean(results.map((r) => r.total)),
    passRate: rate(passed, decided.length),
    failRate: rate(decided.length - passed, decided.length),
    gradeDistribution: distribution,
    componentStats,
    completionRate: rate(complete, studentCount),
    attendanceRate: rate(attended, held),
  };
}

/**
 * The offering's figures from its sections'. The rates are re-weighted by how many students each
 * section had — a mean of means would let a section of four count as much as one of a hundred.
 */
export function consolidate(sections: Metrics[]): Metrics {
  const studentCount = sections.reduce((sum, s) => sum + s.studentCount, 0);
  const weighted = (pick: (s: Metrics) => number | null): number | null => {
    const rows = sections.filter((s) => pick(s) !== null && s.studentCount > 0);
    const total = rows.reduce((sum, s) => sum + s.studentCount, 0);
    if (!total) return null;
    return round2(rows.reduce((sum, s) => sum + pick(s)! * s.studentCount, 0) / total);
  };
  const weightedRate = (pick: (s: Metrics) => number | null): number | null => {
    const value = weighted(pick);
    return value === null ? null : Math.round(value * 10_000) / 10_000;
  };

  const distribution: Record<string, number> = {};
  for (const section of sections)
    for (const [letter, count] of Object.entries(section.gradeDistribution))
      distribution[letter] = (distribution[letter] ?? 0) + count;

  const statsByKey = new Map<string, ComponentStat[]>();
  for (const section of sections)
    for (const stat of section.componentStats) {
      const list = statsByKey.get(stat.key) ?? [];
      list.push(stat);
      statsByKey.set(stat.key, list);
    }

  const componentStats: ComponentStat[] = Array.from(statsByKey.entries()).map(([key, stats]) => {
    const marked = stats.reduce((sum, s) => sum + s.marked, 0);
    const averages = stats.filter((s) => s.averageMark !== null);
    const totalMarked = averages.reduce((sum, s) => sum + s.marked, 0);
    const first = stats[0]!;
    return {
      key,
      name: first.name,
      maxMark: first.maxMark,
      weightPercent: first.weightPercent,
      marked,
      missing: stats.reduce((sum, s) => sum + s.missing, 0),
      averageMark: totalMarked
        ? round2(averages.reduce((sum, s) => sum + s.averageMark! * s.marked, 0) / totalMarked)
        : null,
      averagePercent: totalMarked
        ? round2(
            averages.reduce((sum, s) => sum + (s.averagePercent ?? 0) * s.marked, 0) / totalMarked,
          )
        : null,
      minMark: minOf(stats.map((s) => s.minMark)),
      maxMarkAwarded: maxOf(stats.map((s) => s.maxMarkAwarded)),
    };
  });

  return {
    studentCount,
    averageMark: weighted((s) => s.averageMark),
    passRate: weightedRate((s) => s.passRate),
    failRate: weightedRate((s) => s.failRate),
    gradeDistribution: distribution,
    componentStats,
    completionRate: weightedRate((s) => s.completionRate),
    attendanceRate: weightedRate((s) => s.attendanceRate),
  };
}

function minOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.min(...present) : null;
}

function maxOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.max(...present) : null;
}
