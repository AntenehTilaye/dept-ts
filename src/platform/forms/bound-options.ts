import type { Db } from "../../lib/db/types";
import { resolveBinding } from "./bindings";
import type { FieldDef, Option } from "./field-schema";

// One pass over a form's fields, resolving every source-bound picker so a page can hand the
// options to <FormRenderer boundOptions>. Without this a bound picker renders as an empty
// select, which is why it lives next to the registry rather than in one page.

export async function boundOptionsFor(
  fields: FieldDef[],
  ctx: {
    db: Db;
    departmentId: string;
    personId?: string | null;
    subject?: { subjectType: string; subjectId: string } | null;
  },
): Promise<Record<string, Option[]>> {
  const out: Record<string, Option[]> = {};
  for (const field of flatten(fields)) {
    const binding = field.sourceBinding ?? "none";
    if (binding === "none") continue;
    out[field.key] = await resolveBinding(binding, {
      ...ctx,
      args: { ...(field.bindingArgs ?? {}), ...(field.recordPicker ?? {}) },
    });
  }
  return out;
}

/** A repeating group's sub-fields are bound the same way as the fields around it. */
function flatten(fields: FieldDef[]): FieldDef[] {
  return fields.flatMap((f) => [f, ...(f.fields ? flatten(f.fields) : [])]);
}
