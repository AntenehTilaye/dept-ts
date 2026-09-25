import { cell } from "./html";

// An `ExportFormatSpec` is what another system expects a file to look like: which headers, in
// which order, from which field. Rendering through one is how the load phase hands the registrar
// a file they can load without anybody guessing; the golden sample is how we know it still fits.

export interface SpecColumn {
  header: string;
  sourcePath: string;
  transform?: string;
  format?: string;
  order: number;
  required?: boolean;
}

export interface SpecDiff {
  row: number;
  column: string;
  expected: string;
  actual: string;
}

export function columnsOf(spec: { columnsJson: unknown }): SpecColumn[] {
  const columns = Array.isArray(spec.columnsJson) ? (spec.columnsJson as SpecColumn[]) : [];
  return [...columns].sort((a, b) => a.order - b.order);
}

/** Reads a dotted path out of a row: "person.fullName" and "code" alike. */
export function valueAt(row: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
      row,
    );
}

export class SpecError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = "SpecError";
  }
}

/** The rows as the target system wants them: headers in order, values from the named paths. */
export function renderRows(
  spec: { columnsJson: unknown },
  rows: Record<string, unknown>[],
): { headers: string[]; rows: string[][] } {
  const columns = columnsOf(spec);
  if (!columns.length) throw new SpecError("This export specification has no columns");

  const missing = columns
    .filter((c) => c.required)
    .filter((c) => rows.some((row) => valueAt(row, c.sourcePath) === undefined))
    .map((c) => c.header);
  if (missing.length)
    throw new SpecError(`The rows have nothing for: ${missing.join(", ")}`, missing);

  return {
    headers: columns.map((c) => c.header),
    rows: rows.map((row) => columns.map((c) => apply(cell(valueAt(row, c.sourcePath)), c))),
  };
}

/** Where the rendered file and the sample the target system gave us disagree, cell by cell. */
export function diffAgainstSample(
  rendered: { headers: string[]; rows: string[][] },
  sample: { headers: string[]; rows: string[][] },
): SpecDiff[] {
  const out: SpecDiff[] = [];
  const width = Math.max(rendered.headers.length, sample.headers.length);
  for (let c = 0; c < width; c += 1) {
    const expected = sample.headers[c] ?? "";
    const actual = rendered.headers[c] ?? "";
    if (expected !== actual)
      out.push({ row: 0, column: `column ${c + 1}`, expected, actual });
  }
  const height = Math.max(rendered.rows.length, sample.rows.length);
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const expected = sample.rows[r]?.[c] ?? "";
      const actual = rendered.rows[r]?.[c] ?? "";
      if (expected !== actual)
        out.push({
          row: r + 1,
          column: sample.headers[c] ?? rendered.headers[c] ?? `column ${c + 1}`,
          expected,
          actual,
        });
    }
  }
  return out;
}

function apply(value: string, column: SpecColumn): string {
  switch (column.transform) {
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "trim":
      return value.trim();
    case "date":
      return value ? value.slice(0, 10) : "";
    default:
      return value;
  }
}
