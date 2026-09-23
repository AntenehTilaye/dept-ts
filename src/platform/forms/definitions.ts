import { createHash } from "node:crypto";
import type { FormKind } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { FieldDef, isPicker, type Option } from "./field-schema";

// Form definitions are versioned by the hash of their questions: saving the same questions
// again is a no-op, changing them cuts the next version. Locked question keys of a system form
// can neither disappear nor change type — a published form's answers must stay readable.

export class FormError extends Error {
  constructor(
    message: string,
    readonly code: "locked" | "not_found" | "invalid" = "invalid",
  ) {
    super(message);
    this.name = "FormError";
  }
}

export interface DefineFormInput {
  key: string;
  kind: FormKind;
  title: string;
  description?: string | null;
  fields: FieldDef[];
  scoring?: unknown;
  isSystem?: boolean;
  departmentId?: string | null;
  createdBy?: string | null;
  /** Publish straight away instead of leaving a draft. */
  publish?: boolean;
}

/** Stable hash over what actually changes an answer's meaning. */
export function questionsHash(fields: FieldDef[]): string {
  const canonical = fields.map((f) => normaliseField(f));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function normaliseField(f: FieldDef): unknown {
  return [
    f.key,
    f.type,
    f.label,
    f.helpText ?? null,
    (f.options ?? []).map((o: Option) => [o.value, o.label, o.score ?? null]),
    f.sourceBinding ?? "none",
    f.bindingArgs ?? null,
    f.constraints ?? null,
    f.scoreWeight ?? null,
    f.aggregation ?? "none",
    f.computedBy ?? null,
    (f.fields ?? []).map(normaliseField),
  ];
}

function assertFields(fields: FieldDef[]): FieldDef[] {
  const parsed = fields.map((f) => FieldDef.parse(f));
  const keys = new Set<string>();
  for (const f of parsed) {
    if (keys.has(f.key)) throw new FormError(`Duplicate field key "${f.key}"`);
    keys.add(f.key);
    if (f.type === "repeating_group" && !f.fields?.length)
      throw new FormError(`Repeating group "${f.key}" needs at least one sub-field`);
    if (
      (f.type === "single_choice" || f.type === "multi_choice") &&
      !f.options?.length &&
      (f.sourceBinding ?? "none") === "none"
    )
      throw new FormError(`Choice question "${f.key}" needs options or a source binding`);
  }
  return parsed;
}

/** The latest version of a key (department row shadows the faculty one). */
export async function latestVersion(db: Db, key: string, departmentId: string | null = null) {
  return db.formDefinition.findFirst({
    where: { key, departmentId },
    orderBy: { version: "desc" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

/** The published version used for new submissions (department override first). */
export async function activeForm(db: Db, key: string, departmentId?: string | null) {
  if (departmentId) {
    const own = await db.formDefinition.findFirst({
      where: { key, departmentId, status: "published" },
      orderBy: { version: "desc" },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    if (own) return own;
  }
  return db.formDefinition.findFirst({
    where: { key, departmentId: null, status: "published" },
    orderBy: { version: "desc" },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

export async function formVersion(
  db: Db,
  key: string,
  version: number,
  departmentId: string | null,
) {
  return db.formDefinition.findFirst({
    where: { key, version, departmentId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

/** Questions of a stored version as FieldDefs (what the renderer and the validator consume). */
export function fieldsOf(form: {
  questions: Array<{
    stableKey: string;
    type: string;
    label: string;
    helpText: string | null;
    optionsJson: unknown;
    sourceBinding: string;
    bindingArgsJson: unknown;
    constraintsJson: unknown;
    scoreWeight: unknown;
    aggregation: string;
    parentStableKey: string | null;
    computedBy: string | null;
    isLocked: boolean;
  }>;
}): FieldDef[] {
  const byParent = new Map<string, FieldDef[]>();
  const top: FieldDef[] = [];
  for (const q of form.questions) {
    const field: FieldDef = {
      key: q.stableKey,
      type: q.type as FieldDef["type"],
      label: q.label,
      helpText: q.helpText,
      options: (q.optionsJson as Option[] | null) ?? undefined,
      sourceBinding: q.sourceBinding as FieldDef["sourceBinding"],
      bindingArgs: (q.bindingArgsJson as Record<string, unknown> | null) ?? undefined,
      constraints: (q.constraintsJson as FieldDef["constraints"]) ?? undefined,
      scoreWeight: q.scoreWeight === null ? null : Number(q.scoreWeight),
      aggregation: q.aggregation as FieldDef["aggregation"],
      computedBy: q.computedBy,
      locked: q.isLocked,
    };
    if (q.parentStableKey) {
      const list = byParent.get(q.parentStableKey) ?? [];
      list.push(field);
      byParent.set(q.parentStableKey, list);
    } else {
      top.push(field);
    }
  }
  for (const f of top) {
    const children = byParent.get(f.key);
    if (children) f.fields = children;
  }
  return top;
}

async function writeQuestions(db: Db, formDefinitionId: string, fields: FieldDef[]) {
  let order = 0;
  for (const f of fields) {
    await createQuestion(db, formDefinitionId, f, null, order++);
    for (const sub of f.fields ?? [])
      await createQuestion(db, formDefinitionId, sub, f.key, order++);
  }
}

async function createQuestion(
  db: Db,
  formDefinitionId: string,
  f: FieldDef,
  parentStableKey: string | null,
  order: number,
) {
  await db.question.create({
    data: {
      formDefinitionId,
      stableKey: f.key,
      order,
      type: f.type,
      label: f.label,
      helpText: f.helpText ?? null,
      optionsJson: f.options ? toJson(f.options) : undefined,
      sourceBinding: (f.sourceBinding ?? "none") as never,
      bindingArgsJson: f.bindingArgs ? toJson(f.bindingArgs) : undefined,
      constraintsJson: f.constraints ? toJson(f.constraints) : undefined,
      scoreWeight: f.scoreWeight ?? null,
      aggregation: (f.aggregation ?? "none") as never,
      parentStableKey,
      computedBy: f.computedBy ?? null,
      isLocked: f.locked ?? false,
    },
  });
}

/**
 * Creates version 1 of a form (or returns the existing latest version when the questions are
 * unchanged). `publish` activates it immediately.
 */
export async function defineForm(db: Db, input: DefineFormInput) {
  const fields = assertFields(input.fields);
  const hash = questionsHash(fields);
  const departmentId = input.departmentId ?? null;
  const latest = await latestVersion(db, input.key, departmentId);
  if (latest && latest.questionsHash === hash) {
    if (input.publish && latest.status !== "published") return publishForm(db, latest.id);
    return latest;
  }
  if (latest) return newVersion(db, input.key, fields, { ...input, departmentId });

  const created = await db.formDefinition.create({
    data: {
      departmentId,
      key: input.key,
      version: 1,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      scoringJson: input.scoring ? toJson(input.scoring) : undefined,
      questionsHash: hash,
      lockedPathsJson: toJson(fields.filter((f) => f.locked).map((f) => `/fields/${f.key}`)),
      isSystem: input.isSystem ?? false,
      status: input.publish ? "published" : "draft",
      createdBy: input.createdBy ?? null,
    },
  });
  await writeQuestions(db, created.id, fields);
  return (await formVersion(db, input.key, 1, departmentId))!;
}

/** Cuts the next version; locked keys of a system form may not disappear or change type. */
export async function newVersion(
  db: Db,
  key: string,
  fields: FieldDef[],
  opts: {
    departmentId?: string | null;
    title?: string;
    description?: string | null;
    kind?: FormKind;
    scoring?: unknown;
    createdBy?: string | null;
    publish?: boolean;
  } = {},
) {
  const departmentId = opts.departmentId ?? null;
  const previous = await latestVersion(db, key, departmentId);
  if (!previous) throw new FormError(`Form "${key}" does not exist`, "not_found");
  const next = assertFields(fields);
  const hash = questionsHash(next);
  if (previous.questionsHash === hash && previous.status === "published") return previous;

  if (previous.isSystem) {
    const locked = previous.questions.filter((q) => q.isLocked);
    for (const q of locked) {
      const kept =
        next.find((f) => f.key === q.stableKey) ??
        next.flatMap((f) => f.fields ?? []).find((f) => f.key === q.stableKey);
      if (!kept)
        throw new FormError(`Locked question "${q.stableKey}" cannot be removed`, "locked");
      if (kept.type !== q.type)
        throw new FormError(`Locked question "${q.stableKey}" cannot change type`, "locked");
    }
  }

  const created = await db.formDefinition.create({
    data: {
      departmentId,
      key,
      version: previous.version + 1,
      kind: opts.kind ?? previous.kind,
      title: opts.title ?? previous.title,
      description: opts.description === undefined ? previous.description : opts.description,
      scoringJson: opts.scoring ? toJson(opts.scoring) : (previous.scoringJson ?? undefined),
      questionsHash: hash,
      lockedPathsJson: toJson(next.filter((f) => f.locked).map((f) => `/fields/${f.key}`)),
      isSystem: previous.isSystem,
      status: "draft",
      createdBy: opts.createdBy ?? null,
    },
  });
  await writeQuestions(db, created.id, next);
  if (opts.publish) return publishForm(db, created.id);
  return (await formVersion(db, key, created.version, departmentId))!;
}

/** Publishes a version and retires the previously published one of the same key and scope. */
export async function publishForm(db: Db, formDefinitionId: string) {
  const form = await db.formDefinition.findUniqueOrThrow({ where: { id: formDefinitionId } });
  await db.formDefinition.updateMany({
    where: {
      key: form.key,
      departmentId: form.departmentId,
      status: "published",
      id: { not: form.id },
    },
    data: { status: "retired" },
  });
  await db.formDefinition.update({ where: { id: form.id }, data: { status: "published" } });
  return (await formVersion(db, form.key, form.version, form.departmentId))!;
}

export async function listForms(db: Db, departmentId?: string | null) {
  return db.formDefinition.findMany({
    where: departmentId === undefined ? {} : { departmentId },
    orderBy: [{ key: "asc" }, { version: "desc" }],
    include: { _count: { select: { questions: true, submissions: true } } },
  });
}

/** Reference data a picker question carries (used by the renderer and the validator). */
export function pickerSubjectType(type: FieldDef["type"]): string | null {
  return isPicker(type) ? (PICKER[type] ?? null) : null;
}

const PICKER: Record<string, string> = {
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
