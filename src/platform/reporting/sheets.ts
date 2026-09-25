import Papa from "papaparse";
import { cell } from "./html";
import type { ReportData } from "./registry";

// The same report as a file somebody opens in a spreadsheet: one sheet per table with typed
// columns, or one csv when there is a single table. Both come from the same ReportData, so a
// number is a number in every format.

/** exceljs-hardened is CommonJS: under ESM its classes hang off the default export. */
async function excel(): Promise<typeof import("exceljs-hardened")> {
  const mod = (await import("exceljs-hardened")) as unknown as {
    default?: typeof import("exceljs-hardened");
  };
  return (mod.default ?? mod) as typeof import("exceljs-hardened");
}

export async function renderXlsx(data: ReportData): Promise<Buffer> {
  const { Workbook } = await excel();
  const workbook = new Workbook();
  workbook.creator = "DeptTS";
  workbook.created = data.generatedAt;

  if (data.stats?.length) {
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRow([data.title]);
    sheet.getRow(1).font = { bold: true, size: 14 };
    if (data.subtitle) sheet.addRow([data.subtitle]);
    sheet.addRow([]);
    for (const stat of data.stats) sheet.addRow([stat.label, stat.value]);
    sheet.getColumn(1).width = 32;
    sheet.getColumn(2).width = 18;
  }

  for (const table of data.tables) {
    const sheet = workbook.addWorksheet(sheetName(table.title, workbook.worksheets.length));
    sheet.addRow(table.columns.map((c) => c.label));
    sheet.getRow(1).font = { bold: true };
    for (const row of table.rows) {
      sheet.addRow(
        table.columns.map((column) => {
          const value = row[column.key];
          if (column.type === "number") return typeof value === "number" ? value : Number(value) || 0;
          if (column.type === "date" && value) return new Date(String(value));
          return cell(value);
        }),
      );
    }
    table.columns.forEach((column, index) => {
      const width = Math.max(
        column.label.length + 2,
        ...table.rows.slice(0, 200).map((r) => cell(r[column.key]).length + 2),
      );
      sheet.getColumn(index + 1).width = Math.min(48, Math.max(12, width));
      if (column.type === "date") sheet.getColumn(index + 1).numFmt = "yyyy-mm-dd";
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** CSV of the first table (the one a csv report is about), with a BOM so Excel reads UTF-8. */
export function renderCsv(data: ReportData): string {
  const table = data.tables[0];
  if (!table) return "﻿";
  const rows = table.rows.map((row) =>
    Object.fromEntries(table.columns.map((c) => [c.label, cell(row[c.key])])),
  );
  return `﻿${Papa.unparse(rows, { columns: table.columns.map((c) => c.label) })}\n`;
}

/** Excel refuses some characters and any name over 31 characters, and hates duplicates. */
function sheetName(title: string, index: number): string {
  const cleaned = title.replace(/[\/?*[\]:]/g, " ").trim() || `Sheet ${index + 1}`;
  return cleaned.slice(0, 31);
}
