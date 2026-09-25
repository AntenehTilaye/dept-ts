import Papa from "papaparse";

// Reading the file. Both formats end at the same place — the header row and the rows under it,
// keyed by header — so everything downstream is format-blind. The row cap is a real limit, not
// a formality: a workbook is decompressed in memory, and a department's roster is hundreds of
// rows, not hundreds of thousands.

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  sheetName?: string;
  /** How many rows the file held beyond the cap, if any. */
  truncated: number;
}

export interface ParseOptions {
  sheetName?: string | null;
  /** 1-based row holding the headers; the rows under it are the data. */
  headerRowIndex?: number;
  maxRows?: number;
}

export const DEFAULT_MAX_ROWS = 5000;

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

/** exceljs-hardened is CommonJS: under ESM its classes hang off the default export. */
async function excel(): Promise<typeof import("exceljs-hardened")> {
  const mod = (await import("exceljs-hardened")) as unknown as {
    default?: typeof import("exceljs-hardened");
  };
  return (mod.default ?? mod) as typeof import("exceljs-hardened");
}

export async function parseWorkbook(bytes: Buffer, opts: ParseOptions = {}): Promise<ParsedSheet> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const { Workbook } = await excel();
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (error) {
    throw new ImportParseError(
      `The workbook could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const sheet = opts.sheetName
    ? workbook.getWorksheet(opts.sheetName)
    : workbook.worksheets.find((w) => w.rowCount > 0);
  if (!sheet) throw new ImportParseError("The workbook has no readable sheet");

  const headerRowIndex = opts.headerRowIndex ?? 1;
  const headerRow = sheet.getRow(headerRowIndex);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, index) => {
    headers[index - 1] = cellText(cell.value);
  });
  if (!headers.some((h) => h?.trim()))
    throw new ImportParseError(`Row ${headerRowIndex} holds no column headings`);

  const rows: Record<string, unknown>[] = [];
  let truncated = 0;
  for (let n = headerRowIndex + 1; n <= sheet.rowCount; n += 1) {
    const row = sheet.getRow(n);
    const values: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header?.trim()) return;
      const value = cellValue(row.getCell(index + 1).value);
      values[header] = value;
      if (value !== null && value !== "") hasValue = true;
    });
    if (!hasValue) continue;
    if (rows.length >= maxRows) {
      truncated += 1;
      continue;
    }
    rows.push(values);
  }

  return { headers: headers.filter((h) => h?.trim()), rows, sheetName: sheet.name, truncated };
}

export function parseCsv(content: string, opts: ParseOptions = {}): ParsedSheet {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const parsed = Papa.parse<Record<string, unknown>>(content.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length && !parsed.data.length)
    throw new ImportParseError(parsed.errors[0]!.message);

  const headers = (parsed.meta.fields ?? []).filter((h) => h.trim());
  const rows = parsed.data.filter((row) =>
    headers.some((h) => `${row[h] ?? ""}`.trim().length > 0),
  );
  return {
    headers,
    rows: rows.slice(0, maxRows),
    truncated: Math.max(0, rows.length - maxRows),
  };
}

/** Parses whichever of the two a file is, by its name or its declared type. */
export async function parseFile(
  bytes: Buffer,
  nameOrType: string,
  opts: ParseOptions = {},
): Promise<ParsedSheet> {
  const looksCsv = /csv|text\/plain/i.test(nameOrType);
  return looksCsv ? parseCsv(bytes.toString("utf8"), opts) : parseWorkbook(bytes, opts);
}

function cellText(value: unknown): string {
  const text = cellValue(value);
  return text === null ? "" : String(text).trim();
}

/** A cell as a plain value: formulas give their result, rich text its text, dates stay dates. */
function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const cell = value as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (cell.richText) return cell.richText.map((r) => r.text).join("");
    if (cell.result !== undefined) return cell.result;
    if (cell.text !== undefined) return cell.text;
    return String(value);
  }
  return value;
}
