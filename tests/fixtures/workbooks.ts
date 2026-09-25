// exceljs-hardened ships as CommonJS, so the named export only exists on the default
import ExcelJS from "exceljs-hardened";

// The spreadsheets the import tests work on, built rather than committed: a binary fixture in
// git is a thing nobody can read in a diff, and these are small enough to describe in code.
// `build-fixtures.ts` writes them to disk for the Playwright run; the unit and integration
// tests use the buffers directly.

export interface SheetData {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export async function workbookOf(sheets: SheetData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DeptTS tests";
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(sheet.headers);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function csvOf(sheet: SheetData): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [sheet.headers.join(","), ...sheet.rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

/** A roster everything in which is fine: three students of one section. */
export const ROSTER_VALID: SheetData = {
  name: "Roster",
  headers: ["Student number", "Full name", "Email", "Programme", "Section", "Year"],
  rows: [
    ["UGR/2001/16", "Abebe Bekele", "abebe@student.local", "BSC-CS", "CS-Y2-A", 2],
    ["UGR/2002/16", "Chaltu Dinka", "chaltu@student.local", "BSC-CS", "CS-Y2-A", 2],
    ["UGR/2003/16", "Dawit Haile", "dawit@student.local", "BSC-CS", "CS-Y2-A", 2],
  ],
};

/**
 * The same roster with the three problems a real one arrives with: the same number twice, an
 * address that is not an address, and a section nobody has heard of. The headers are spelled
 * the way another office spells them, which the aliases have to see through.
 */
export const ROSTER_ERRORS: SheetData = {
  name: "Sheet1",
  headers: ["ID No", "Student Name", "E-Mail", "Program Code", "Section Code", "Year Level"],
  rows: [
    ["UGR/2001/16", "Abebe Bekele", "abebe@student.local", "BSC-CS", "CS-Y2-A", 2],
    ["UGR/2001/16", "Abebe B.", "abebe@student.local", "BSC-CS", "CS-Y2-A", 2],
    ["UGR/2004/16", "Elias Tadesse", "not-an-address", "BSC-CS", "CS-Y9-Z", 2],
  ],
};

/** A timetable that is fine: two slots, two rooms, two instructors. */
export const TIMETABLE_VALID: SheetData = {
  name: "Timetable",
  headers: ["Course", "Section", "Day", "From", "To", "Room", "Instructor", "Weeks"],
  rows: [
    ["CS201", "CS-Y2-A", 2, "09:00", "11:00", "B12", "instructor1.cs@deptts.local", "all"],
    ["CS202", "CS-Y2-A", 3, "09:00", "11:00", "B13", "instructor2.cs@deptts.local", "all"],
  ],
};

/** Two rows that put the same room and the same instructor in two places at once. */
export const TIMETABLE_OVERLAP: SheetData = {
  name: "Timetable",
  headers: ["Course", "Section", "Day", "From", "To", "Room", "Instructor", "Weeks"],
  rows: [
    ["CS201", "CS-Y2-A", 2, "09:00", "11:00", "B12", "instructor1.cs@deptts.local", "all"],
    ["CS202", "CS-Y2-A", 2, "10:00", "12:00", "B12", "instructor1.cs@deptts.local", "all"],
  ],
};
