import { describe, expect, it } from "vitest";
import { gradeScale, bandFor } from "@/modules/assessment/grade-scales";
import { computeMetrics, consolidate } from "@/modules/assessment/metrics";
import { computeResult, declaredWeight, weightsAddUp } from "@/modules/assessment/results";
import type { ComponentDef } from "@/modules/assessment/results";

// The arithmetic a department reports on. It has to be right for the ordinary case and honest about
// the awkward ones: a student who missed the final has not passed, a missing mark is not a zero, and
// a course's figures are its sections' weighted by how many students each one had.

const SCHEME: ComponentDef[] = [
  { key: "quiz", name: "Quiz", maxMark: 10, weightPercent: 10, isFinal: false },
  { key: "mid", name: "Mid-semester", maxMark: 30, weightPercent: 30, isFinal: false },
  { key: "final", name: "Final", maxMark: 60, weightPercent: 60, isFinal: true },
];

describe("a student's result", () => {
  it("is the weighted percentage of what they earned", () => {
    const result = computeResult(
      SCHEME,
      [
        { componentKey: "quiz", mark: 8 },
        { componentKey: "mid", mark: 24 },
        { componentKey: "final", mark: 45 },
      ],
      "default",
    );
    // 80% of 10 + 80% of 30 + 75% of 60 = 8 + 24 + 45
    expect(result.total).toBe(77);
    expect(result.letterGrade).toBe("B+");
    expect(result.outcome).toBe("pass");
  });

  it("treats a missing mark as unearned rather than as a zero, and says which is missing", () => {
    const result = computeResult(
      SCHEME,
      [
        { componentKey: "quiz", mark: 10 },
        { componentKey: "final", mark: 60 },
      ],
      "default",
    );
    expect(result.total).toBe(70);
    expect(result.missing).toEqual(["mid"]);
    expect(result.outcome).toBe("pass");
  });

  it("is incomplete when the final was not sat, however good the rest was", () => {
    const result = computeResult(
      SCHEME,
      [
        { componentKey: "quiz", mark: 10 },
        { componentKey: "mid", mark: 30 },
      ],
      "default",
    );
    expect(result.total).toBe(40);
    expect(result.letterGrade).toBe("I");
    expect(result.outcome).toBe("incomplete");
  });

  it("reads the same total differently on two scales", () => {
    const marks = [
      { componentKey: "quiz", mark: 6 },
      { componentKey: "mid", mark: 18 },
      { componentKey: "final", mark: 33 },
    ];
    const undergraduate = computeResult(SCHEME, marks, "default");
    const postgraduate = computeResult(SCHEME, marks, "postgraduate");
    expect(undergraduate.total).toBe(57);
    expect(undergraduate.outcome).toBe("pass");
    expect(undergraduate.letterGrade).toBe("C");
    // the postgraduate scale passes at 60, so the same marks fail
    expect(postgraduate.total).toBe(57);
    expect(postgraduate.outcome).toBe("fail");
    expect(postgraduate.letterGrade).toBe("F");
  });

  it("leaves a component marked as excluded out of the total", () => {
    const withMakeup: ComponentDef[] = [
      ...SCHEME,
      {
        key: "makeup",
        name: "Make-up test",
        maxMark: 20,
        weightPercent: 20,
        isFinal: false,
        excludedFromConsolidation: true,
      },
    ];
    expect(declaredWeight(withMakeup)).toBe(100);
    expect(weightsAddUp(withMakeup)).toBe(true);
    const result = computeResult(
      withMakeup,
      [
        { componentKey: "quiz", mark: 10 },
        { componentKey: "mid", mark: 30 },
        { componentKey: "final", mark: 60 },
        { componentKey: "makeup", mark: 20 },
      ],
      "default",
    );
    expect(result.total).toBe(100);
  });

  it("refuses to call a scheme markable when its components do not add up", () => {
    const short = SCHEME.slice(0, 2);
    expect(declaredWeight(short)).toBe(40);
    expect(weightsAddUp(short)).toBe(false);
  });

  it("puts a total above the top band in the top band", () => {
    expect(bandFor(gradeScale("default"), 120).letter).toBe("A+");
    expect(bandFor(gradeScale("default"), -5).letter).toBe("F");
  });
});

describe("a section's figures", () => {
  const results = [
    { studentId: "s1", total: 88, letterGrade: "A", outcome: "pass" as const },
    { studentId: "s2", total: 64, letterGrade: "B-", outcome: "pass" as const },
    { studentId: "s3", total: 38, letterGrade: "F", outcome: "fail" as const },
    { studentId: "s4", total: 40, letterGrade: "I", outcome: "incomplete" as const },
  ];
  const marks = [
    { studentId: "s1", componentKey: "quiz", mark: 9 },
    { studentId: "s2", componentKey: "quiz", mark: 6 },
    { studentId: "s3", componentKey: "quiz", mark: 4 },
    { studentId: "s4", componentKey: "quiz", mark: 10 },
    { studentId: "s1", componentKey: "final", mark: 55 },
    { studentId: "s2", componentKey: "final", mark: 40 },
    { studentId: "s3", componentKey: "final", mark: 20 },
    { studentId: "s4", componentKey: "final", mark: null },
  ];

  it("averages the totals and rates pass and fail over the decided results only", () => {
    const metrics = computeMetrics({ components: SCHEME, results, marks });
    expect(metrics.studentCount).toBe(4);
    expect(metrics.averageMark).toBe(57.5);
    // three results are decided; two of them passed
    expect(metrics.passRate).toBeCloseTo(0.6667, 4);
    expect(metrics.failRate).toBeCloseTo(0.3333, 4);
    expect(metrics.completionRate).toBe(0.75);
  });

  it("counts every letter the scale can produce, so an empty band reads as zero", () => {
    const metrics = computeMetrics({ components: SCHEME, results, marks });
    expect(metrics.gradeDistribution.A).toBe(1);
    expect(metrics.gradeDistribution["B-"]).toBe(1);
    expect(metrics.gradeDistribution.F).toBe(1);
    expect(metrics.gradeDistribution.I).toBe(1);
    expect(metrics.gradeDistribution["A+"]).toBe(0);
  });

  it("reports each component's spread and how many marks it is missing", () => {
    const metrics = computeMetrics({ components: SCHEME, results, marks });
    const quiz = metrics.componentStats.find((c) => c.key === "quiz")!;
    expect(quiz.marked).toBe(4);
    expect(quiz.missing).toBe(0);
    expect(quiz.averageMark).toBe(7.25);
    expect(quiz.averagePercent).toBe(72.5);
    expect(quiz.minMark).toBe(4);
    expect(quiz.maxMarkAwarded).toBe(10);

    const final = metrics.componentStats.find((c) => c.key === "final")!;
    expect(final.marked).toBe(3);
    expect(final.missing).toBe(1);

    // a component nobody was marked on is still reported, with nothing in it
    const mid = metrics.componentStats.find((c) => c.key === "mid")!;
    expect(mid.marked).toBe(0);
    expect(mid.averageMark).toBeNull();
  });

  it("is the attendance of the class, not the mean of its students' rates", () => {
    const metrics = computeMetrics({
      components: SCHEME,
      results,
      marks,
      attendance: [
        { studentId: "s1", sessionsHeld: 28, sessionsAttended: 28 },
        { studentId: "s2", sessionsHeld: 28, sessionsAttended: 14 },
      ],
    });
    expect(metrics.attendanceRate).toBe(0.75);
  });

  it("has no rates at all for a section nobody has marked", () => {
    const metrics = computeMetrics({ components: SCHEME, results: [], marks: [] });
    expect(metrics.studentCount).toBe(0);
    expect(metrics.averageMark).toBeNull();
    expect(metrics.passRate).toBeNull();
    expect(metrics.attendanceRate).toBeNull();
  });
});

describe("a course's figures", () => {
  it("weights its sections by how many students each one had", () => {
    const big = computeMetrics({
      components: SCHEME,
      results: Array.from({ length: 90 }, (_, i) => ({
        studentId: `b${i}`,
        total: 60,
        letterGrade: "C+",
        outcome: "pass" as const,
      })),
      marks: [],
    });
    const small = computeMetrics({
      components: SCHEME,
      results: Array.from({ length: 10 }, (_, i) => ({
        studentId: `s${i}`,
        total: 90,
        letterGrade: "A+",
        outcome: "pass" as const,
      })),
      marks: [],
    });

    const course = consolidate([big, small]);
    expect(course.studentCount).toBe(100);
    // a mean of means would say 75; the class of ninety is what the course looks like
    expect(course.averageMark).toBe(63);
    expect(course.gradeDistribution["C+"]).toBe(90);
    expect(course.gradeDistribution["A+"]).toBe(10);
    expect(course.passRate).toBe(1);
  });

  it("adds the component figures of sections marked the same way", () => {
    const one = computeMetrics({
      components: SCHEME,
      results: [{ studentId: "a", total: 50, letterGrade: "C", outcome: "pass" }],
      marks: [{ studentId: "a", componentKey: "quiz", mark: 10 }],
    });
    const two = computeMetrics({
      components: SCHEME,
      results: [
        { studentId: "b", total: 50, letterGrade: "C", outcome: "pass" },
        { studentId: "c", total: 50, letterGrade: "C", outcome: "pass" },
      ],
      marks: [
        { studentId: "b", componentKey: "quiz", mark: 4 },
        { studentId: "c", componentKey: "quiz", mark: 4 },
      ],
    });
    const course = consolidate([one, two]);
    const quiz = course.componentStats.find((c) => c.key === "quiz")!;
    expect(quiz.marked).toBe(3);
    expect(quiz.averageMark).toBe(6);
    expect(quiz.minMark).toBe(4);
    expect(quiz.maxMarkAwarded).toBe(10);
  });

  it("has nothing to say about a course with no sections marked", () => {
    const course = consolidate([]);
    expect(course.studentCount).toBe(0);
    expect(course.averageMark).toBeNull();
    expect(course.componentStats).toEqual([]);
  });
});
