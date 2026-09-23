import { z, type ZodType } from "zod";
import { isPresentational, type Constraints, type FieldDef } from "./field-schema";

// Builds the validation schema of a form from its fields. The same generator serves campaign
// submissions, standalone submissions and (from the feature phase) record header forms, so a
// question type is validated in exactly one place.

export interface RankedAnswer {
  /** Ordered ids, best first. */
  order: string[];
}

function withRequired<T extends ZodType>(schema: T, c: Constraints | undefined) {
  return c?.required ? schema : schema.nullish();
}

function textSchema(c: Constraints | undefined, max: number) {
  let s = z.string().trim().max(max);
  if (c?.regex) s = s.regex(new RegExp(`^(?:${c.regex})$`), "does not match the expected format");
  if (c?.required) s = s.min(1, "is required");
  return c?.required ? s : s.optional().nullable();
}

function numberSchema(c: Constraints | undefined) {
  let s = z.coerce.number();
  if (c?.min !== undefined) s = s.min(c.min);
  if (c?.max !== undefined) s = s.max(c.max);
  return withRequired(s, c);
}

function choiceValues(field: FieldDef): [string, ...string[]] | null {
  const values = (field.options ?? []).map((o) => o.value);
  return values.length ? (values as [string, ...string[]]) : null;
}

/** The schema of a single field (without the conditional-requirement pass). */
export function schemaOfField(field: FieldDef): ZodType {
  const c = field.constraints;
  switch (field.type) {
    case "short_text":
      return textSchema(c, 500);
    case "long_text":
      return textSchema(c, 20_000);
    case "number":
    case "likert":
    case "scale":
      return numberSchema(c);
    case "date":
    case "datetime":
      return withRequired(z.coerce.date(), c);
    case "boolean":
      return c?.required ? z.coerce.boolean() : z.coerce.boolean().nullish();
    case "single_choice": {
      const values = choiceValues(field);
      // a bound question takes its options at render time, so any non-empty id is accepted
      return withRequired(values ? z.enum(values) : z.string().min(1), c);
    }
    case "multi_choice": {
      const values = choiceValues(field);
      let s = z.array(values ? z.enum(values) : z.string().min(1));
      if (c?.required || c?.minItems) s = s.min(Math.max(c?.minItems ?? 0, c?.required ? 1 : 0));
      if (c?.maxItems) s = s.max(c.maxItems);
      return c?.required ? s : s.default([]);
    }
    case "person_picker":
    case "group_picker":
    case "course_picker":
    case "offering_picker":
    case "section_picker":
    case "term_picker":
    case "resource_picker":
    case "task_picker":
    case "record_picker":
      return withRequired(z.string().min(1), c);
    case "audience_picker":
      return withRequired(z.record(z.string(), z.unknown()), c);
    case "ranked_list": {
      const maxRank = c?.maxRank;
      let order = z.array(z.string().min(1));
      if (c?.required) order = order.min(1, "rank at least one option");
      if (maxRank) order = order.max(maxRank, `rank at most ${maxRank} options`);
      const schema = z
        .object({ order })
        .refine((v) => new Set(v.order).size === v.order.length, "an option may be ranked once");
      return c?.required ? schema : schema.nullish();
    }
    case "file": {
      let s = z.array(z.string().min(1));
      if (c?.required) s = s.min(1, "attach at least one file");
      if (c?.maxFiles) s = s.max(c.maxFiles);
      return c?.required ? s : s.default([]);
    }
    case "repeating_group": {
      const inner = z.object(
        Object.fromEntries((field.fields ?? []).map((f) => [f.key, schemaOfField(f)])),
      );
      let s = z.array(inner);
      if (c?.minItems || c?.required) s = s.min(Math.max(c?.minItems ?? 0, c?.required ? 1 : 0));
      if (c?.maxItems) s = s.max(c.maxItems);
      return c?.required ? s : s.default([]);
    }
    case "computed":
      return z.unknown().optional();
    case "section_header":
      return z.undefined().optional();
  }
}

/**
 * The schema of a whole form. Conditional fields (`visibleIf`) are only required when their
 * condition holds, which cannot be expressed per field — it is applied as a superRefine.
 */
export function zodFromFields(fields: FieldDef[]) {
  const answerable = fields.filter((f) => !isPresentational(f.type));
  const shape = Object.fromEntries(
    answerable.map((f) => {
      const c = f.constraints;
      // a conditionally visible field is never required at the field level
      const field = c?.visibleIf ? { ...f, constraints: { ...c, required: false } } : f;
      return [f.key, schemaOfField(field)];
    }),
  );
  const base = z.object(shape);
  const conditional = answerable.filter((f) => f.constraints?.visibleIf && f.constraints.required);
  if (!conditional.length) return base;
  return base.superRefine((value, ctx) => {
    const data = value as Record<string, unknown>;
    for (const f of conditional) {
      const cond = f.constraints!.visibleIf!;
      const other = data[cond.field];
      const visible = cond.equals.some((v) => v === other);
      const answer = data[f.key];
      const empty =
        answer === undefined ||
        answer === null ||
        answer === "" ||
        (Array.isArray(answer) && answer.length === 0);
      if (visible && empty) {
        ctx.addIssue({ code: "custom", path: [f.key], message: `${f.label} is required` });
      }
    }
  });
}

/** Whether a field is currently visible given the other answers (used by the renderer). */
export function isVisible(field: FieldDef, answers: Record<string, unknown>): boolean {
  const cond = field.constraints?.visibleIf;
  if (!cond) return true;
  const other = answers[cond.field];
  return cond.equals.some((v) => v === other);
}
