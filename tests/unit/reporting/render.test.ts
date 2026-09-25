import { describe, expect, it } from "vitest";
import { renderHtml } from "@/platform/reporting/html";
import { renderCsv, renderXlsx } from "@/platform/reporting/sheets";
import type { ReportData } from "@/platform/reporting/registry";
import { diffAgainstSample, renderRows, SpecError, valueAt } from "@/platform/reporting/export-spec";

// One set of rows, four files. These tests are about the rows surviving the trip: a number that
// arrives as text in a spreadsheet is a bug somebody finds a month later.

const data: ReportData = {
  title: "Department activity",
  subtitle: "March",
  departmentName: "Computer Science",
  generatedAt: new Date("2026-03-31T09:00:00Z"),
  stats: [
    { label: "Tasks started", value: 12 },
    { label: "Tasks completed", value: 9 },
  ],
  tables: [
    {
      key: "tasks",
      title: "Tasks",
      columns: [
        { key: "title", label: "Task" },
        { key: "hours", label: "Hours", type: "number" },
        { key: "due", label: "Due", type: "date" },
      ],
      rows: [
        { title: 'Prepare the "CS201" paper', hours: 4, due: new Date("2026-04-02T00:00:00Z") },
        { title: "Mark, then moderate", hours: 2.5, due: null },
      ],
    },
    { key: "empty", title: "Nothing here", columns: [{ key: "a", label: "A" }], rows: [] },
  ],
};

describe("html", () => {
  it("renders the header, the stats and every table, and escapes what came from the data", () => {
    const html = renderHtml(data);
    expect(html).toContain("<h1>Department activity</h1>");
    expect(html).toContain("Computer Science · March");
    expect(html).toContain("Tasks started");
    expect(html).toContain("Prepare the &quot;CS201&quot; paper");
    expect(html).toContain("2026-04-02");
    // a table with no rows says so rather than showing an empty frame
    expect(html).toContain("Nothing to show");
    // the document is self-contained: no scripts, no external requests
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
  });

  it("numbers are right-aligned so a column of them reads as a column", () => {
    expect(renderHtml(data)).toContain('<td class="number">4</td>');
  });
});

describe("csv", () => {
  it("writes the first table with a BOM and quotes what needs quoting", () => {
    const csv = renderCsv(data);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Task,Hours,Due");
    expect(csv).toContain('"Prepare the ""CS201"" paper"');
    expect(csv).toContain('"Mark, then moderate"');
  });
});

describe("xlsx", () => {
  it("round-trips through a real workbook with one sheet per table and typed cells", async () => {
    const bytes = await renderXlsx(data);
    const ExcelJS = (await import("exceljs-hardened")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Summary", "Tasks", "Nothing here"]);
    const tasks = workbook.getWorksheet("Tasks")!;
    expect(tasks.getRow(1).values).toEqual([undefined, "Task", "Hours", "Due"]);
    // the number stayed a number and the date stayed a date
    expect(tasks.getRow(2).getCell(2).value).toBe(4);
    expect(tasks.getRow(2).getCell(3).value).toBeInstanceOf(Date);
    expect(tasks.getRow(3).getCell(2).value).toBe(2.5);
  });
});

describe("export specifications", () => {
  const spec = {
    columnsJson: [
      { header: "STUDENT_ID", sourcePath: "student.number", order: 1, required: true },
      { header: "NAME", sourcePath: "student.name", transform: "upper", order: 2 },
      { header: "GRADE", sourcePath: "grade", order: 3 },
    ],
  };
  const rows = [
    { student: { number: "UGR/1/16", name: "Abebe Bekele" }, grade: "A" },
    { student: { number: "UGR/2/16", name: "Chaltu Dinka" }, grade: "B+" },
  ];

  it("maps rows to the declared headers, in the declared order, through the declared transform", () => {
    expect(valueAt(rows[0]!, "student.name")).toBe("Abebe Bekele");
    const rendered = renderRows(spec, rows);
    expect(rendered.headers).toEqual(["STUDENT_ID", "NAME", "GRADE"]);
    expect(rendered.rows[0]).toEqual(["UGR/1/16", "ABEBE BEKELE", "A"]);
  });

  it("refuses when a required column has nothing behind it", () => {
    expect(() => renderRows(spec, [{ student: { name: "No number" } }])).toThrow(SpecError);
  });

  it("reports every cell where the rendered file and the golden sample disagree", () => {
    const rendered = renderRows(spec, rows);
    const sample = {
      headers: ["STUDENT_ID", "NAME", "GRADE"],
      rows: [
        ["UGR/1/16", "ABEBE BEKELE", "A"],
        ["UGR/2/16", "CHALTU DINKA", "B"],
      ],
    };
    const diff = diffAgainstSample(rendered, sample);
    expect(diff).toEqual([{ row: 2, column: "GRADE", expected: "B", actual: "B+" }]);
  });
});
