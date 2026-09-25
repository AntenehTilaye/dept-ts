import { describe, expect, it } from "vitest";
import { ImportParseError, parseCsv, parseFile, parseWorkbook } from "@/platform/import/parse";
import { csvOf, ROSTER_VALID, workbookOf } from "../../fixtures/workbooks";

// Reading the file. Whatever the format, the pipeline downstream sees the same thing: the
// headers, and the rows under them keyed by header.

describe("parsing", () => {
  it("a workbook and the same data as csv parse to identical rows", async () => {
    const fromXlsx = await parseWorkbook(await workbookOf([ROSTER_VALID]));
    const fromCsv = parseCsv(csvOf(ROSTER_VALID));

    expect(fromXlsx.headers).toEqual(ROSTER_VALID.headers);
    expect(fromCsv.headers).toEqual(ROSTER_VALID.headers);
    expect(fromXlsx.rows).toHaveLength(3);
    // the csv reader gives text; comparing as text is what makes the two formats one pipeline
    expect(fromXlsx.rows.map((r) => Object.values(r).map(String))).toEqual(
      fromCsv.rows.map((r) => Object.values(r).map(String)),
    );
  });

  it("picks the format from the name and keeps the sheet it read", async () => {
    const xlsx = await parseFile(await workbookOf([ROSTER_VALID]), "roster-valid.xlsx");
    expect(xlsx.sheetName).toBe("Roster");
    const csv = await parseFile(Buffer.from(csvOf(ROSTER_VALID)), "roster.csv");
    expect(csv.rows).toHaveLength(3);
  });

  it("reads the sheet and header row it is told to, and skips empty lines", async () => {
    const bytes = await workbookOf([
      { name: "Notes", headers: ["Nothing here"], rows: [] },
      {
        name: "Data",
        headers: ["Title of the file", ""],
        rows: [
          ["Student number", "Full name"],
          ["UGR/1/16", "Abebe Bekele"],
          [null, null],
          ["UGR/2/16", "Chaltu Dinka"],
        ],
      },
    ]);
    const sheet = await parseWorkbook(bytes, { sheetName: "Data", headerRowIndex: 2 });
    expect(sheet.headers).toEqual(["Student number", "Full name"]);
    expect(sheet.rows).toHaveLength(2);
  });

  it("stops at the row cap and says how much it left", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`UGR/${i}/16`, `Student ${i}`]);
    const bytes = await workbookOf([
      { name: "Roster", headers: ["Student number", "Full name"], rows },
    ]);
    const sheet = await parseWorkbook(bytes, { maxRows: 10 });
    expect(sheet.rows).toHaveLength(10);
    expect(sheet.truncated).toBe(2);

    const csv = parseCsv(
      csvOf({ name: "Roster", headers: ["Student number", "Full name"], rows }),
      { maxRows: 10 },
    );
    expect(csv.rows).toHaveLength(10);
    expect(csv.truncated).toBe(2);
  });

  it("refuses something that is not a workbook at all, with a readable message", async () => {
    await expect(parseWorkbook(Buffer.from("PK not really a workbook"))).rejects.toBeInstanceOf(
      ImportParseError,
    );
    await expect(
      parseWorkbook(await workbookOf([{ name: "Empty", headers: [], rows: [] }])),
    ).rejects.toThrow(/no readable sheet|no column headings/);
  });
});
