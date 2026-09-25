import { globalSingleton } from "../../../lib/singleton";
import type { Db } from "../../../lib/db/types";

// What "wrong" means for a kind of file. A validator sees every row at once — a duplicate can
// only be seen that way — and answers per row, so the preview can show the file as it is with
// each problem next to the line that has it.

export interface RowIssue {
  code: string;
  field?: string;
  message: string;
}

export interface RowVerdict {
  /** The row as the committer wants it, when it can be understood at all. */
  normalized?: Record<string, unknown>;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface ValidatorContext {
  tx: Db;
  departmentId: string;
  /** What the batch is about: the section, the term, the offering. */
  context?: { subjectType: string; subjectId: string } | null;
}

export type Validator = (
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
) => Promise<RowVerdict[]>;

const validators = globalSingleton("import-validators", () => new Map<string, Validator>());

export function registerValidator(kind: string, validator: Validator): void {
  validators.set(kind, validator);
}

export function getValidator(kind: string): Validator | undefined {
  return validators.get(kind);
}

export async function validateRows(
  kind: string,
  ctx: ValidatorContext,
  rows: Record<string, unknown>[],
): Promise<RowVerdict[]> {
  const validator = validators.get(kind);
  if (!validator) throw new Error(`No validator is registered for "${kind}" imports`);
  return validator(ctx, rows);
}

export function error(code: string, message: string, field?: string): RowIssue {
  return { code, message, ...(field ? { field } : {}) };
}
