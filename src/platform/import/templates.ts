import type { ImportKind } from "@/generated/prisma/enums";
import type { ColumnSpec } from "./mapping";

// What each kind of file is supposed to contain. One list per kind, used three times: to build
// the template somebody downloads, to work out which column is which in the file that comes
// back, and to tell a validator what it may rely on.

export interface KindSpec {
  kind: ImportKind;
  label: string;
  /** What the rows are about; a batch of this kind is created under such a subject. */
  contextType: string;
  columns: ColumnSpec[];
  /** One line under the header row of the template. */
  guidance: string;
}

const ROSTER: KindSpec = {
  kind: "roster",
  label: "Section roster",
  contextType: "section",
  guidance:
    "One row per student. The student number is what identifies them; a name that disagrees with an existing record is a warning, not an error.",
  columns: [
    {
      field: "student_number",
      label: "Student number",
      required: true,
      aliases: ["id no", "student id", "studentno"],
      example: "UGR/1234/16",
    },
    {
      field: "full_name",
      label: "Full name",
      required: true,
      aliases: ["name", "student name"],
      example: "Abebe Bekele",
    },
    { field: "email", label: "Email", aliases: ["e-mail"], example: "abebe@student.local" },
    {
      field: "program_code",
      label: "Programme",
      aliases: ["program", "programme code"],
      example: "BSC-CS",
    },
    {
      field: "section_code",
      label: "Section",
      aliases: ["section code", "class"],
      example: "CS-Y2-A",
    },
    { field: "year_level", label: "Year", aliases: ["year level"], example: "2" },
  ],
};

const CLASS_TIMETABLE: KindSpec = {
  kind: "class_timetable",
  label: "Class timetable",
  contextType: "term",
  guidance:
    "One row per weekly slot. Weekday is 1 (Monday) to 7 (Sunday); times are written HH:MM on the 24-hour clock.",
  columns: [
    {
      field: "course_code",
      label: "Course",
      required: true,
      aliases: ["course", "course no"],
      example: "CS201",
    },
    {
      field: "section_code",
      label: "Section",
      required: true,
      aliases: ["section", "class"],
      example: "CS-Y2-A",
    },
    { field: "weekday", label: "Weekday", required: true, aliases: ["day"], example: "2" },
    {
      field: "start_time",
      label: "Start",
      required: true,
      aliases: ["from", "start time"],
      example: "09:00",
    },
    {
      field: "end_time",
      label: "End",
      required: true,
      aliases: ["to", "end time"],
      example: "11:00",
    },
    { field: "room_code", label: "Room", aliases: ["room", "venue"], example: "B12" },
    {
      field: "instructor_email",
      label: "Instructor",
      aliases: ["instructor", "lecturer", "teacher"],
      example: "instructor1.cs@deptts.local",
    },
    {
      field: "week_pattern",
      label: "Weeks",
      aliases: ["pattern", "week pattern"],
      hint: "all, odd or even",
      example: "all",
    },
  ],
};

const KINDS: Partial<Record<ImportKind, KindSpec>> = {
  roster: ROSTER,
  class_timetable: CLASS_TIMETABLE,
};

export function kindSpec(kind: string): KindSpec {
  const spec = KINDS[kind as ImportKind];
  if (!spec) throw new Error(`No import template is defined for "${kind}"`);
  return spec;
}

export function listKinds(): KindSpec[] {
  return Object.values(KINDS) as KindSpec[];
}

/** exceljs-hardened is CommonJS: under ESM its classes hang off the default export. */
async function excel(): Promise<typeof import("exceljs-hardened")> {
  const mod = (await import("exceljs-hardened")) as unknown as {
    default?: typeof import("exceljs-hardened");
  };
  return (mod.default ?? mod) as typeof import("exceljs-hardened");
}

/** The template as a workbook: the headers, the guidance line and one example row. */
export async function templateWorkbook(kind: string, context?: Record<string, string>): Promise<Buffer> {
  const spec = kindSpec(kind);
  const { Workbook } = await excel();
  const workbook = new Workbook();
  workbook.creator = "DeptTS";
  const sheet = workbook.addWorksheet(spec.label.slice(0, 31));

  sheet.addRow(spec.columns.map((c) => c.label));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(spec.columns.map((c) => c.example ?? ""));
  sheet.addRow([]);
  sheet.addRow([spec.guidance]);
  if (context && Object.keys(context).length) {
    sheet.addRow([
      `For: ${Object.entries(context)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    ]);
  }
  spec.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.max(14, column.label.length + 4);
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** The same template as CSV, for whoever prefers it. */
export function templateCsv(kind: string): string {
  const spec = kindSpec(kind);
  return `${spec.columns.map((c) => c.label).join(",")}\n${spec.columns
    .map((c) => c.example ?? "")
    .join(",")}\n`;
}
