import { describe, expect, it } from "vitest";
import { validateAssessment, validateAttendance, validateStudents } from "@/modules/assessment/validators";
import type { ValidatorContext } from "@/platform/import";

// Every rule a mark sheet is read against, with the code the preview shows beside the line. The
// validators talk to the database only to learn who is enrolled and what the components are, so
// those two answers are stubbed here and the rules themselves are what is under test.

const COMPONENTS = [
  { key: "quiz", name: "Quiz", maxMark: 10, weightPercent: 10, isFinal: false },
  { key: "mid", name: "Mid-semester", maxMark: 30, weightPercent: 30, isFinal: false },
  { key: "final", name: "Final", maxMark: 60, weightPercent: 60, isFinal: true },
];

const ROSTER = [
  { studentId: "p1", studentNumber: "UGR/2001/16", fullName: "Abebe Bekele" },
  { studentId: "p2", studentNumber: "UGR/2002/16", fullName: "Chaltu Dinka" },
  { studentId: "p3", studentNumber: "UGR/2003/16", fullName: "Dawit Haile" },
];

/**
 * The two questions a validator asks the database: who is enrolled in this section, and what is it
 * marked on. Everything else it works out from the rows in front of it.
 */
function ctxFor(over: { components?: typeof COMPONENTS; roster?: typeof ROSTER } = {}): ValidatorContext {
  const components = over.components ?? COMPONENTS;
  const roster = over.roster ?? ROSTER;
  const tx = {
    enrollment: {
      findMany: async () =>
        roster.map((row) => ({
          studentId: row.studentId,
          student: { studentNumber: row.studentNumber, person: { fullName: row.fullName } },
        })),
    },
    assessmentScheme: {
      findFirst: async ({ where }: { where: { sectionOfferingId?: string } }) =>
        where.sectionOfferingId
          ? { id: "scheme", components: components.map((c, i) => ({ ...c, order: i, excludedFromConsolidation: false })) }
          : null,
    },
    sectionOffering: { findUnique: async () => ({ courseOfferingId: "co1" }) },
    program: { findMany: async () => [{ id: "prog1", code: "BSC-CS" }] },
    student: { findMany: async () => [{ studentNumber: "UGR/2001/16", person: { fullName: "Abebe Bekele" } }] },
  };
  return {
    tx: tx as unknown as ValidatorContext["tx"],
    departmentId: "dep_cs",
    context: { subjectType: "section_offering", subjectId: "so1" },
  };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("reading a sheet of marks", () => {
  it("accepts a sheet whose every row is fine, and keeps an empty cell as unsat rather than zero", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/2001/16", full_name: "Abebe Bekele", "component:quiz": 9, "component:mid": 24, "component:final": 48 },
      { student_number: "UGR/2002/16", full_name: "Chaltu Dinka", "component:quiz": 6, "component:mid": 18, "component:final": 33 },
      { student_number: "UGR/2003/16", full_name: "Dawit Haile", "component:quiz": 8, "component:mid": 21, "component:final": "" },
    ]);
    expect(verdicts.flatMap((v) => codes(v.errors))).toEqual([]);
    expect(verdicts[0]!.normalized).toMatchObject({
      student_id: "p1",
      marks: { quiz: 9, mid: 24, final: 48 },
    });
    // the one who did not sit the final has null for it, and the sheet says so
    expect((verdicts[2]!.normalized as { marks: Record<string, unknown> }).marks.final).toBeNull();
    expect(codes(verdicts[2]!.warnings)).toContain("MISSING_COMPONENT");
  });

  it("refuses a student the section does not have", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/9999/16", full_name: "Nobody Here", "component:quiz": 5 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("UNKNOWN_STUDENT");
    expect(verdicts[0]!.normalized).toBeUndefined();
  });

  it("refuses the same student twice", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/2001/16", "component:quiz": 9 },
      { student_number: "UGR/2001/16", "component:quiz": 8 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("DUPLICATE_STUDENT");
    expect(codes(verdicts[1]!.errors)).toContain("DUPLICATE_STUDENT");
  });

  it("warns, but does not refuse, when the name disagrees with the roster", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/2001/16", full_name: "Zenebe Worku", "component:quiz": 9 },
    ]);
    expect(codes(verdicts[0]!.errors)).toEqual([]);
    expect(codes(verdicts[0]!.warnings)).toContain("NAME_MISMATCH");
  });

  it("refuses a mark that is not a number and one that is above the maximum", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/2001/16", "component:quiz": "absent" },
      { student_number: "UGR/2002/16", "component:mid": 44 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("NON_NUMERIC");
    expect(codes(verdicts[1]!.errors)).toContain("OUT_OF_RANGE");
  });

  it("refuses a sheet for a section that has no scheme at all", async () => {
    const verdicts = await validateAssessment(ctxFor({ components: [] }), [
      { student_number: "UGR/2001/16" },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("MISSING_COMPONENT");
  });

  it("refuses a row whose stated total disagrees with its components", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      {
        student_number: "UGR/2001/16",
        "component:quiz": 9,
        "component:mid": 24,
        "component:final": 48,
        total: 99,
      },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("TOTAL_MISMATCH");
  });

  it("says when the roster has students the sheet never mentions", async () => {
    const verdicts = await validateAssessment(ctxFor(), [
      { student_number: "UGR/2001/16", "component:quiz": 9, "component:final": 50 },
    ]);
    expect(codes(verdicts[0]!.warnings)).toContain("ROSTER_STUDENT_MISSING");
    expect(verdicts[0]!.warnings.find((w) => w.code === "ROSTER_STUDENT_MISSING")!.message).toContain(
      "UGR/2002/16",
    );
  });
});

describe("reading an attendance sheet", () => {
  it("accepts counts that make sense", async () => {
    const verdicts = await validateAttendance(ctxFor(), [
      { student_number: "UGR/2001/16", sessions_held: 28, sessions_attended: 28 },
    ]);
    expect(codes(verdicts[0]!.errors)).toEqual([]);
    expect(verdicts[0]!.normalized).toMatchObject({ student_id: "p1", sessions_attended: 28 });
  });

  it("refuses attending more sessions than were held", async () => {
    const verdicts = await validateAttendance(ctxFor(), [
      { student_number: "UGR/2001/16", sessions_held: 28, sessions_attended: 30 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("ATTENDANCE_OVER_HELD");
  });

  it("refuses a negative count and a missing one", async () => {
    const verdicts = await validateAttendance(ctxFor(), [
      { student_number: "UGR/2001/16", sessions_held: 28, sessions_attended: -1 },
      { student_number: "UGR/2002/16", sessions_held: "", sessions_attended: 10 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("OUT_OF_RANGE");
    expect(codes(verdicts[1]!.errors)).toContain("NON_NUMERIC");
  });
});

describe("reading an intake list", () => {
  it("accepts a student of a programme the department has", async () => {
    const verdicts = await validateStudents(ctxFor(), [
      {
        student_number: "UGR/3001/17",
        full_name: "Feven Alemu",
        email: "feven@student.local",
        program_code: "BSC-CS",
        admission_year: 2025,
      },
    ]);
    expect(codes(verdicts[0]!.errors)).toEqual([]);
    expect(verdicts[0]!.normalized).toMatchObject({ program_id: "prog1", admission_year: 2025 });
  });

  it("refuses a programme nobody has heard of and a year that is not a year", async () => {
    const verdicts = await validateStudents(ctxFor(), [
      { student_number: "UGR/3002/17", full_name: "Girma Tesfaye", program_code: "BSC-XX", admission_year: 20 },
    ]);
    expect(codes(verdicts[0]!.errors)).toContain("MISSING_COMPONENT");
    expect(codes(verdicts[0]!.errors)).toContain("OUT_OF_RANGE");
  });

  it("warns when a student we already hold is spelled differently", async () => {
    const verdicts = await validateStudents(ctxFor(), [
      {
        student_number: "UGR/2001/16",
        full_name: "Zenebe Worku",
        program_code: "BSC-CS",
        admission_year: 2024,
      },
    ]);
    expect(codes(verdicts[0]!.errors)).toEqual([]);
    expect(codes(verdicts[0]!.warnings)).toContain("NAME_MISMATCH");
  });
});
