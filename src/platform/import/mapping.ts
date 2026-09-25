// "Which column is which" — the part of an import that a person should only have to answer
// once. A header matches a field by its own name, by one of the field's aliases or by a saved
// profile, all compared without case, spaces or punctuation, because that is how the same
// spreadsheet arrives spelled differently every term.

export interface ColumnSpec {
  field: string;
  label: string;
  required?: boolean;
  /** Other spellings seen in real files. */
  aliases?: string[];
  /** Shown in the downloadable template. */
  example?: string;
  hint?: string;
}

export interface MappingProfileInput {
  mappings?: Record<string, string>;
  headerAliases?: Record<string, string[]>;
}

export interface MappingResult {
  /** field -> the header it was found under. */
  mappings: Record<string, string>;
  /** Headers in the file that no field claimed. */
  unmapped: string[];
  /** Required fields no header matched — a batch-level error, not a row one. */
  missingRequired: string[];
}

/** Lower-case, letters and digits only: "Student No." and "student_no" are the same header. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveMapping(
  headers: string[],
  columns: ColumnSpec[],
  profile?: MappingProfileInput,
): MappingResult {
  const byNormalised = new Map<string, string>();
  for (const header of headers) {
    const key = normaliseHeader(header);
    if (key && !byNormalised.has(key)) byNormalised.set(key, header);
  }

  const mappings: Record<string, string> = {};
  const missingRequired: string[] = [];
  const claimed = new Set<string>();

  for (const column of columns) {
    // a saved profile is somebody's deliberate answer, so it wins over every guess
    const fromProfile = profile?.mappings?.[column.field];
    const candidates = [
      ...(fromProfile ? [fromProfile] : []),
      column.field,
      column.label,
      ...(profile?.headerAliases?.[column.field] ?? []),
      ...(column.aliases ?? []),
    ];
    let found: string | undefined;
    for (const candidate of candidates) {
      const header = byNormalised.get(normaliseHeader(candidate));
      if (header) {
        found = header;
        break;
      }
    }
    if (found) {
      mappings[column.field] = found;
      claimed.add(found);
    } else if (column.required) {
      missingRequired.push(column.field);
    }
  }

  return {
    mappings,
    unmapped: headers.filter((h) => h.trim() && !claimed.has(h)),
    missingRequired,
  };
}

/** Rekeys the rows from the file's headers to the fields a validator and committer expect. */
export function applyMapping(
  rows: Record<string, unknown>[],
  mappings: Record<string, string>,
): Record<string, unknown>[] {
  const fields = Object.entries(mappings);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [field, header] of fields) out[field] = row[header] ?? null;
    return out;
  });
}

/** A cell as text: trimmed, with empty and nullish alike becoming an empty string. */
export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}
