import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import { applyMapping, resolveMapping } from "@/platform/import/mapping";
import { kindSpec } from "@/platform/import/templates";
import { validateClassTimetable } from "@/platform/import/validators/class_timetable";
import { validateRoster } from "@/platform/import/validators/roster";
import type { ValidatorContext } from "@/platform/import/validators/registry";
import { ROSTER_ERRORS, ROSTER_VALID, TIMETABLE_OVERLAP, TIMETABLE_VALID } from "../../fixtures/workbooks";

// What "wrong" means for a file. The validators only read the registry, so a stub that answers
// the four questions they ask is enough — and it keeps these tests about the rules rather than
// about the database.

function rowsOf(sheet: { headers: string[]; rows: (string | number | null)[][] }, kind: string) {
  const objects = sheet.rows.map((row) =>
    Object.fromEntries(sheet.headers.map((h, i) => [h, row[i] ?? null])),
  );
  const { mappings } = resolveMapping(sheet.headers, kindSpec(kind).columns);
  return applyMapping(objects, mappings);
}

const rosterDb = {
  program: { findMany: async () => [{ id: "prog_cs", code: "BSC-CS" }] },
  section: { findMany: async () => [{ id: "sec_a", code: "CS-Y2-A", yearLevel: 2 }] },
  student: {
    findMany: async () => [
      { studentNumber: "UGR/2001/16", person: { fullName: "Abebe Bekele Tadesse" } },
    ],
  },
} as unknown as Db;

const timetableDb = {
  sectionOffering: {
    findMany: async () => [
      {
        id: "so_1",
        section: { code: "CS-Y2-A" },
        courseOffering: { termId: "term_1", course: { code: "CS201" } },
      },
      {
        id: "so_2",
        section: { code: "CS-Y2-A" },
        courseOffering: { termId: "term_1", course: { code: "CS202" } },
      },
    ],
  },
  resource: {
    findMany: async () => [
      { id: "room_b12", code: "B12" },
      { id: "room_b13", code: "B13" },
    ],
  },
  person: {
    findMany: async () => [
      { id: "per_1", email: "instructor1.cs@deptts.local", fullName: "Instructor One" },
      { id: "per_2", email: "instructor2.cs@deptts.local", fullName: "Instructor Two" },
    ],
  },
} as unknown as Db;

const rosterCtx: ValidatorContext = { tx: rosterDb, departmentId: "dep_cs", context: null };
const timetableCtx: ValidatorContext = {
  tx: timetableDb,
  departmentId: "dep_cs",
  context: { subjectType: "term", subjectId: "term_1" },
};

describe("the roster validator", () => {
  it("passes a file that is fine and normalises what the committer needs", async () => {
    const verdicts = await validateRoster(rosterCtx, rowsOf(ROSTER_VALID, "roster"));
    expect(verdicts.every((v) => v.errors.length === 0)).toBe(true);
    expect(verdicts[0]!.normalized).toMatchObject({
      student_number: "UGR/2001/16",
      program_id: "prog_cs",
      section_id: "sec_a",
      year_level: 2,
    });
  });

  it("catches the duplicate, the malformed address and the unknown section", async () => {
    const verdicts = await validateRoster(rosterCtx, rowsOf(ROSTER_ERRORS, "roster"));
    const codes = verdicts.map((v) => v.errors.map((e) => `${e.field}:${e.code}`));
    expect(codes[0]).toContain("student_number:duplicate");
    expect(codes[1]).toContain("student_number:duplicate");
    expect(codes[2]).toContain("email:format");
    expect(codes[2]).toContain("section_code:unknown");
    // a row with an error is never handed to the committer
    expect(verdicts[2]!.normalized).toBeUndefined();
  });

  it("a name that disagrees with the record we hold is a warning, not a refusal", async () => {
    const verdicts = await validateRoster(rosterCtx, rowsOf(ROSTER_ERRORS, "roster"));
    expect(verdicts[1]!.warnings.map((w) => w.code)).toContain("name_mismatch");
    expect(verdicts[1]!.warnings[0]!.message).toContain("Abebe Bekele Tadesse");
    // the same name written in another order is the same name
    const reordered = await validateRoster(rosterCtx, [
      { student_number: "UGR/2001/16", full_name: "Tadesse Abebe Bekele" },
    ]);
    expect(reordered[0]!.warnings).toEqual([]);
  });

  it("a missing student number or name is an error", async () => {
    const verdicts = await validateRoster(rosterCtx, [
      { student_number: "", full_name: "" },
    ]);
    expect(verdicts[0]!.errors.map((e) => e.field)).toEqual(["student_number", "full_name"]);
  });
});

describe("the timetable validator", () => {
  it("passes a file that is fine and resolves the offering, the room and the instructor", async () => {
    const verdicts = await validateClassTimetable(
      timetableCtx,
      rowsOf(TIMETABLE_VALID, "class_timetable"),
    );
    expect(verdicts.every((v) => v.errors.length === 0)).toBe(true);
    expect(verdicts[0]!.normalized).toMatchObject({
      section_offering_id: "so_1",
      term_id: "term_1",
      weekday: 2,
      start_time: "09:00",
      resource_id: "room_b12",
      person_id: "per_1",
      week_pattern: "all",
    });
  });

  it("catches two rows that book the same room and the same person at once", async () => {
    const verdicts = await validateClassTimetable(
      timetableCtx,
      rowsOf(TIMETABLE_OVERLAP, "class_timetable"),
    );
    expect(verdicts[0]!.errors).toEqual([]);
    const codes = verdicts[1]!.errors.map((e) => `${e.field}:${e.code}`);
    expect(codes).toEqual(["room_code:overlap", "instructor_email:overlap"]);
  });

  it("catches what does not exist, what is not a time and what ends before it starts", async () => {
    const verdicts = await validateClassTimetable(timetableCtx, [
      {
        course_code: "CS999",
        section_code: "CS-Y2-A",
        weekday: "9",
        start_time: "9am",
        end_time: "08:00",
        room_code: "ZZ9",
        instructor_email: "nobody@deptts.local",
        week_pattern: "sometimes",
      },
    ]);
    const codes = verdicts[0]!.errors.map((e) => `${e.field}:${e.code}`);
    expect(codes).toContain("course_code:unknown");
    expect(codes).toContain("weekday:range");
    expect(codes).toContain("start_time:format");
    expect(codes).toContain("week_pattern:range");
    expect(codes).toContain("room_code:unknown");
    expect(codes).toContain("instructor_email:unknown");
  });

  it("accepts a single-digit hour and is content with the end after the start", async () => {
    const verdicts = await validateClassTimetable(timetableCtx, [
      {
        course_code: "CS201",
        section_code: "CS-Y2-A",
        weekday: "2",
        start_time: "9:00",
        end_time: "10:30",
      },
    ]);
    expect(verdicts[0]!.errors).toEqual([]);
    expect(verdicts[0]!.normalized).toMatchObject({ start_time: "09:00", end_time: "10:30" });
  });
});
