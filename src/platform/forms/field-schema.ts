import { z } from "zod";

// The field contract shared by forms and (from the feature builder phase) record headers.
// A FieldDef is what an administrator composes; a Question row is its stored form.

export const QuestionType = z.enum([
  "short_text",
  "long_text",
  "number",
  "date",
  "datetime",
  "boolean",
  "single_choice",
  "multi_choice",
  "likert",
  "scale",
  "person_picker",
  "group_picker",
  "course_picker",
  "offering_picker",
  "section_picker",
  "term_picker",
  "resource_picker",
  "task_picker",
  "record_picker",
  "audience_picker",
  "ranked_list",
  "file",
  "repeating_group",
  "section_header",
  "computed",
]);
export type QuestionType = z.infer<typeof QuestionType>;

export const SourceBinding = z.enum([
  "offerings_in_term",
  "courses_in_program",
  "electives_in_campaign",
  "own_enrollments",
  "staff_in_department",
  "tasks_in_context",
  "members_of_parent",
  "prior_cqi_items",
  "resources_of_kind",
  "records_of_feature",
  "participants_of_parent",
  "none",
]);
export type SourceBinding = z.infer<typeof SourceBinding>;

export const Aggregation = z.enum(["mean", "distribution", "count", "rank_sum", "top_n", "none"]);
export type Aggregation = z.infer<typeof Aggregation>;

/** A choice of a choice-like question. */
export const Option = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  score: z.number().optional(),
});
export type Option = z.infer<typeof Option>;

/** Shows the field only when another field has one of these values. */
export const VisibleIf = z.object({
  field: z.string().min(1),
  equals: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
});
export type VisibleIf = z.infer<typeof VisibleIf>;

export const Constraints = z
  .object({
    required: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
    /** Anchored at both ends when applied. */
    regex: z.string().optional(),
    /** ranked_list: how many entries must be ranked. */
    maxRank: z.number().int().min(1).optional(),
    /** multi_choice / repeating_group / file: upper bound. */
    maxItems: z.number().int().min(1).optional(),
    minItems: z.number().int().min(0).optional(),
    accept: z.array(z.string()).optional(),
    maxFiles: z.number().int().min(1).optional(),
    visibleIf: VisibleIf.optional(),
  })
  .default({ required: false });
export type Constraints = z.infer<typeof Constraints>;

export interface FieldDef {
  key: string;
  type: QuestionType;
  label: string;
  helpText?: string | null;
  options?: Option[];
  sourceBinding?: SourceBinding;
  bindingArgs?: Record<string, unknown>;
  constraints?: Constraints;
  scoreWeight?: number | null;
  aggregation?: Aggregation;
  /** Sub-fields of a repeating_group. */
  fields?: FieldDef[];
  computedBy?: string | null;
  locked?: boolean;
}

export const FieldDef: z.ZodType<FieldDef> = z.lazy(() =>
  z
    .object({
      key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z][a-z0-9_]*$/, "a field key is lower_snake_case"),
      type: QuestionType,
      label: z.string().min(1).max(300),
      helpText: z.string().max(500).nullish(),
      options: z.array(Option).optional(),
      sourceBinding: SourceBinding.default("none"),
      bindingArgs: z.record(z.string(), z.unknown()).optional(),
      constraints: Constraints.optional(),
      scoreWeight: z.number().nullish(),
      aggregation: Aggregation.default("none"),
      fields: z.array(FieldDef).optional(),
      computedBy: z.string().nullish(),
      locked: z.boolean().optional(),
    })
    .strict(),
);

/** Types that hold a reference to another record (stored in Answer.refType/refId). */
export const PICKER_TYPES: Record<string, string> = {
  person_picker: "person",
  group_picker: "group",
  course_picker: "course",
  offering_picker: "course_offering",
  section_picker: "section",
  term_picker: "term",
  resource_picker: "resource",
  task_picker: "task",
  record_picker: "feature_record",
};

export function isPicker(type: QuestionType): boolean {
  return type in PICKER_TYPES;
}

/** Types that carry no answer at all. */
export function isPresentational(type: QuestionType): boolean {
  return type === "section_header";
}

/** Types whose answer is a number (kept in Answer.numericValue for aggregation). */
export function isNumeric(type: QuestionType): boolean {
  return type === "number" || type === "likert" || type === "scale";
}
