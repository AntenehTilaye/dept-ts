import Mustache from "mustache";
import { newId } from "../../../lib/id";
import { toJson } from "../../../lib/db/json";
import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";
import { record as audit } from "../../audit/record";
import { publish as emit } from "../../audit/outbox";
import { zodFromFields } from "../../forms/zod-from-fields";
import { start } from "../../workflow/engine";
import { createTask } from "../../workitem/service";
import { runAdapter, getAdapter } from "../adapters/registry";
import { scopeTypeOf } from "../schema";
import { resolveAssignee } from "./assign";
import { getDefinition, type ResolvedDefinition } from "./queries";
import { enterParallel, enterStep, type RecordRow, type StepContext } from "./steps";

// Creating a record is the one place a feature turns into rows: the header answers are
// validated against the definition's own fields, the number is drawn from the department's
// sequence, the backing row is created if the feature has one, and the workflow starts on the
// first step. Everything after this happens through transitions.

export class RecordValidationError extends Error {
  constructor(readonly issues: Record<string, string[]>) {
    super("The record could not be created");
    this.name = "RecordValidationError";
  }
}

export interface CreateRecordInput {
  data?: Record<string, unknown>;
  presetKey?: string | null;
  parentRef?: { subjectType: string; subjectId: string } | null;
  scopeRef?: { scopeType: string; scopeId: string } | null;
  title?: string;
}

export interface CreatedRecord {
  id: string;
  number: string;
  title: string;
  currentStateKey: string;
}

export async function createRecord(
  tx: Db,
  departmentId: string,
  actor: Actor,
  featureKey: string,
  input: CreateRecordInput = {},
): Promise<CreatedRecord> {
  const resolved = await getDefinition(tx, departmentId, featureKey);
  const def = resolved.def;
  const preset = input.presetKey ? def.presets[input.presetKey] : undefined;
  if (input.presetKey && !preset) throw new RecordValidationError({ presetKey: ["unknown preset"] });

  // preset defaults are locked values: they win over whatever the form sent
  const data = { ...(input.data ?? {}), ...(preset?.fieldDefaults ?? {}) };
  const parsed = zodFromFields(def.record.fields).safeParse(data);
  if (!parsed.success)
    throw new RecordValidationError(
      Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v ?? []]),
      ),
    );

  const parent = input.parentRef ?? null;
  if (def.parentSubject?.required && !parent)
    throw new RecordValidationError({ parentRef: ["this feature is always created under a parent"] });

  const personId = actor.personId;
  if (!personId) throw new RecordValidationError({ actor: ["only a person can create a record"] });

  const recordId = newId();
  const owner = await resolveAssignee(def.record.ownerRule, {
    tx,
    departmentId,
    record: {
      id: recordId,
      ownerPersonId: personId,
      createdByPersonId: personId,
      data: parsed.data as Record<string, unknown>,
      parentSubjectType: parent?.subjectType ?? null,
      parentSubjectId: parent?.subjectId ?? null,
    },
  });
  const ownerPersonId = owner?.type === "person" ? owner.id : personId;

  const number = await nextNumber(tx, departmentId, resolved);
  const title = renderTitle(def.record.titleTemplate, {
    ...(parsed.data as Record<string, unknown>),
    number,
    feature_name: def.name,
  });

  const instance = await start(tx, {
    departmentId,
    definitionKey: `feature:${def.key}`,
    subject: { subjectType: "feature_record", subjectId: recordId },
    actor,
  });

  const scope = input.scopeRef ?? scopeOf(resolved, parsed.data as Record<string, unknown>, parent);
  const record = (await tx.featureRecord.create({
    data: {
      id: recordId,
      departmentId,
      definitionId: resolved.definitionId,
      definitionVersionId: resolved.versionId,
      number,
      title: input.title?.trim() || title,
      data: toJson(parsed.data),
      presetKey: input.presetKey ?? null,
      parentSubjectType: (parent?.subjectType ?? null) as never,
      parentSubjectId: parent?.subjectId ?? null,
      scopeType: scope.scopeType as never,
      scopeId: scope.scopeId,
      ownerPersonId,
      createdByPersonId: personId,
      workflowInstanceId: instance.id,
      currentStateKey: instance.currentState,
    },
  })) as RecordRow;

  await createBacking(tx, actor, resolved, record);

  const ctx: StepContext = { tx, actor, record, resolved };
  const first = resolved.tree.leaves[0];
  if (instance.currentState === first?.step.key) await enterStep(ctx, instance.currentState);
  else if (resolved.tree.parallels.some((p) => p.group.key === instance.currentState))
    await enterParallel(ctx, instance.currentState);

  await audit(tx, {
    action: "create",
    subjectType: "feature_record",
    subjectId: record.id,
    departmentId,
    actorUserId: actor.userId ?? null,
    reason: `${def.key} ${number}`,
  });
  await emit(
    tx,
    "feature.record.created",
    { subjectType: "feature_record", subjectId: record.id },
    { featureKey: def.key, number, presetKey: input.presetKey ?? null },
    { departmentId },
  );

  return { id: record.id, number, title: record.title, currentStateKey: instance.currentState };
}

/** `task` backing: the record IS a Task row. `module`: an adapter creates the module's row. */
async function createBacking(
  tx: Db,
  actor: Actor,
  resolved: ResolvedDefinition,
  record: RecordRow,
): Promise<void> {
  const backing = resolved.def.record.backing;
  if (backing.kind === "feature_record") return;

  if (backing.kind === "task") {
    const task = await createTask(tx, actor, {
      title: record.title,
      kind: backing.taskKind as never,
      context: record.parentSubjectType
        ? { subjectType: record.parentSubjectType, subjectId: record.parentSubjectId! }
        : null,
      keepDraft: true,
    });
    await tx.task.update({ where: { id: task.id }, data: { featureRecordId: record.id } });
    await tx.featureRecord.update({ where: { id: record.id }, data: { taskId: task.id } });
    record.taskId = task.id;
    return;
  }

  if (!getAdapter(backing.adapter)) return;
  const ids = await runAdapter<Record<string, unknown>>(
    backing.adapter,
    {
      tx,
      actor,
      departmentId: record.departmentId,
      record: {
        id: record.id,
        definitionKey: resolved.key,
        data: (record.data as Record<string, unknown>) ?? {},
        presetKey: record.presetKey,
      },
    },
    {},
    "backing",
  );
  if (ids && typeof ids === "object")
    await tx.featureRecord.update({
      where: { id: record.id },
      data: { data: toJson({ ...((record.data as Record<string, unknown>) ?? {}), ...ids }) },
    });
}

/** `F-<prefix>-<year>-<seq>`, drawn atomically per department, definition and year. */
export async function nextNumber(
  tx: Db,
  departmentId: string,
  resolved: Pick<ResolvedDefinition, "definitionId" | "def">,
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.$queryRaw<Array<{ next: number }>>`
    INSERT INTO feature_number_sequence (department_id, definition_id, year, next)
    VALUES (${departmentId}, ${resolved.definitionId}, ${year}, 2)
    ON CONFLICT (department_id, definition_id, year)
      DO UPDATE SET next = feature_number_sequence.next + 1
    RETURNING next`;
  // the insert reserves 1 and stores 2; an update returns the value it just moved to
  const next = rows[0]?.next ?? 2;
  const sequence = next === 2 ? 1 : next - 1;
  return `F-${resolved.def.record.numberPrefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

function renderTitle(template: string, variables: Record<string, unknown>): string {
  const rendered = Mustache.render(template, variables, undefined, { escape: (s: string) => s });
  return rendered.trim() || String(variables.number ?? "Record");
}

function scopeOf(
  resolved: ResolvedDefinition,
  data: Record<string, unknown>,
  parent: { subjectType: string; subjectId: string } | null,
): { scopeType: string; scopeId: string | null } {
  const scope = resolved.def.scope;
  if (scope.scopeFrom === "record_field" && scope.fieldKey) {
    const value = data[scope.fieldKey];
    return { scopeType: scopeTypeOf(scope.level), scopeId: typeof value === "string" ? value : null };
  }
  if (scope.scopeFrom === "parent" && parent)
    return { scopeType: scopeTypeOf(scope.level), scopeId: parent.subjectId };
  return { scopeType: scopeTypeOf(scope.level), scopeId: null };
}
