import { Prisma } from "@/generated/prisma/client";
import { toJson } from "../../lib/db/json";
import { globalSingleton } from "../../lib/singleton";
import { withTenantTx } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import { record } from "../audit/record";
import { can, type Actor, type PolicyStore } from "../identity/can";
import { matchesAnyActorRule } from "./actors";
import { runEffects } from "./effects";
import {
  ConflictError,
  ForbiddenTransitionError,
  TransitionNotAllowedError,
  WorkflowError,
} from "./errors";
import { evaluateGuard, type GuardContext } from "./guards";
import {
  applicableTransitions,
  initialSnapshot,
  stateOf,
  step,
  transitionOf,
  type GuardVerdict,
  type Snapshot,
} from "./machine";
import { activeDefinition, definitionById, type DefinitionRow } from "./registry";
import type { BranchStates, Definition, WorkflowTransitionJson } from "./schema";

// The transactional engine around the pure machine. Every mutation happens inside the
// caller's department transaction: the instance row is locked (SELECT ... FOR UPDATE),
// optimistic rowVersion and expectedState are checked, permission/actor rules and guards are
// evaluated, the machine computes the next snapshot, then the instance update, transition log
// rows, audit rows, effects and the outbox event are written together.

export interface InstanceRow {
  id: string;
  departmentId: string;
  definitionId: string;
  definitionKey: string;
  definitionVersion: number;
  subjectType: string;
  subjectId: string;
  currentState: string;
  branchStates: unknown;
  enteredAt: Date;
  dueAt: Date | null;
  rowVersion: number;
}

export interface StartInput {
  definitionKey: string;
  subject: { subjectType: string; subjectId: string };
  departmentId: string;
  actor: Actor | null;
  /** Person ids for a dynamic compound initial state. */
  personIds?: string[];
  dueAt?: Date | null;
}

export interface ApplyInput {
  comment?: string;
  fields?: Record<string, unknown>;
  attachments?: string[];
  payload?: unknown;
  branchKey?: string;
  expectedState?: string;
  expectedRowVersion?: number;
  /** Person ids when the transition enters a dynamic compound state. */
  personIds?: string[];
  /** Allows system transitions to be applied by automation (no actor). */
  system?: boolean;
}

export interface AvailableAction {
  transitionKey: string;
  action: string;
  /** What the definition calls this action, when something upstream knows ("Read the file"). */
  label?: string;
  to: string;
  branchKey?: string;
  system: boolean;
  requiredComment: boolean;
  requiredFields: string[];
  requiredAttachments: string[];
  enabled: boolean;
  disabledReason?: string;
}

const holder = globalSingleton("workflow-policy-store", () => ({
  store: null as PolicyStore | null,
}));

/** The web/worker bootstrap installs the database policy store; tests may inject their own. */
export function setEnginePolicyStore(store: PolicyStore): void {
  holder.store = store;
}

function store(): PolicyStore {
  if (!holder.store)
    throw new Error("Workflow engine: no PolicyStore installed (call setEnginePolicyStore)");
  return holder.store;
}

function snapshotOf(i: InstanceRow): Snapshot {
  return {
    currentState: i.currentState,
    branchStates: (i.branchStates as BranchStates | null) ?? null,
  };
}

function dueFrom(def: Definition, stateKey: string, now: Date): Date | null {
  const s = stateOf(def, stateKey);
  return s?.slaHours ? new Date(now.getTime() + s.slaHours * 3_600_000) : null;
}

export async function start(tx: Db, input: StartInput): Promise<InstanceRow> {
  const def = await activeDefinition(tx, input.definitionKey, input.departmentId);
  if (!def)
    throw new WorkflowError(
      `No active workflow definition "${input.definitionKey}"`,
      "no_definition",
    );
  const now = new Date();
  const snap = initialSnapshot(def.definition, now, input.personIds);
  const instance = await tx.workflowInstance.create({
    data: {
      departmentId: input.departmentId,
      definitionId: def.id,
      definitionKey: def.key,
      definitionVersion: def.version,
      subjectType: input.subject.subjectType as never,
      subjectId: input.subject.subjectId,
      currentState: snap.currentState,
      branchStates: snap.branchStates ? toJson(snap.branchStates) : undefined,
      enteredAt: now,
      dueAt: input.dueAt ?? dueFrom(def.definition, snap.currentState, now),
    },
  });
  await publish(
    tx,
    "workflow.started",
    input.subject,
    { instanceId: instance.id, definitionKey: def.key, state: snap.currentState },
    { departmentId: input.departmentId },
  );
  return instance as InstanceRow;
}

export async function instanceOf(
  tx: Db,
  subject: { subjectType: string; subjectId: string },
  definitionKey: string,
): Promise<InstanceRow | null> {
  return tx.workflowInstance.findUnique({
    where: {
      subjectType_subjectId_definitionKey: {
        subjectType: subject.subjectType as never,
        subjectId: subject.subjectId,
        definitionKey,
      },
    },
  }) as Promise<InstanceRow | null>;
}

async function permissionOk(
  tx: Db,
  t: WorkflowTransitionJson,
  actor: Actor | null,
  instance: InstanceRow,
): Promise<string | null> {
  if (t.system) return actor ? "system action" : null;
  if (!actor) return "an actor is required";
  const subject = { subjectType: instance.subjectType, subjectId: instance.subjectId };
  if (t.requiredPermission) {
    const d = await can(store(), actor, t.requiredPermission, subject);
    if (!d.allowed) return d.reason;
  }
  if (!(await matchesAnyActorRule(t.actorRules, { tx, actor, subject, store: store() })))
    return "not an eligible actor for this action";
  return null;
}

/** Actions the actor may take now, with disabled reasons for the ones they cannot. */
export async function availableActions(
  tx: Db,
  instanceId: string,
  actor: Actor | null,
): Promise<AvailableAction[]> {
  const instance = (await tx.workflowInstance.findUniqueOrThrow({
    where: { id: instanceId },
  })) as InstanceRow;
  const def = await definitionById(tx, instance.definitionId);
  const out: AvailableAction[] = [];
  for (const { transition: t, branchKey } of applicableTransitions(
    def.definition,
    snapshotOf(instance),
  )) {
    if (t.system) continue;
    let reason = await permissionOk(tx, t, actor, instance);
    if (!reason) {
      for (const g of t.guards) {
        const v = await evaluateGuard(g, guardContext(tx, def, instance, t, actor, { branchKey }));
        if (v !== true) {
          reason = v.reason ?? `blocked by ${g}`;
          break;
        }
      }
    }
    out.push({
      transitionKey: t.key,
      action: t.action,
      to: t.to,
      ...(branchKey ? { branchKey } : {}),
      system: t.system,
      requiredComment: t.requiredComment,
      requiredFields: t.requiredFields,
      requiredAttachments: t.requiredAttachments,
      enabled: !reason,
      ...(reason ? { disabledReason: reason } : {}),
    });
  }
  return out;
}

function guardContext(
  tx: Db,
  def: DefinitionRow,
  instance: InstanceRow,
  t: WorkflowTransitionJson,
  actor: Actor | null,
  input: ApplyInput,
): GuardContext {
  return {
    tx,
    definition: def.definition,
    instance: {
      id: instance.id,
      subjectType: instance.subjectType,
      subjectId: instance.subjectId,
      currentState: instance.currentState,
      departmentId: instance.departmentId,
    },
    transition: t,
    actor,
    input: {
      comment: input.comment,
      fields: input.fields,
      payload: input.payload,
      branchKey: input.branchKey,
    },
  };
}

export interface ApplyResult {
  instance: InstanceRow;
  applied: Array<{ transitionKey: string; branchKey?: string; fromState: string; toState: string }>;
  terminal: boolean;
  terminalCategory?: "success" | "rejected" | "cancelled";
}

/** Applies a transition inside the caller's department transaction. */
export async function applyIn(
  tx: Db,
  instanceId: string,
  transitionKey: string,
  actor: Actor | null,
  input: ApplyInput = {},
): Promise<ApplyResult> {
  // 1. lock the instance row for the rest of the transaction
  const locked = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM workflow_instance WHERE id = ${instanceId} FOR UPDATE`;
  if (locked.length === 0)
    throw new WorkflowError(`Workflow instance ${instanceId} not found`, "not_found");
  const instance = (await tx.workflowInstance.findUniqueOrThrow({
    where: { id: instanceId },
  })) as InstanceRow;
  if (input.expectedRowVersion !== undefined && instance.rowVersion !== input.expectedRowVersion)
    throw new ConflictError();
  if (input.expectedState !== undefined && instance.currentState !== input.expectedState)
    throw new ConflictError(`The record moved to "${instance.currentState}" in the meantime`);

  const def = await definitionById(tx, instance.definitionId);
  const t = transitionOf(def.definition, transitionKey);
  if (!t) throw new TransitionNotAllowedError(`Unknown transition "${transitionKey}"`);

  // 2. permission and actor rules
  if (t.system && !input.system && actor)
    throw new ForbiddenTransitionError(`"${t.action}" is a system action`);
  if (!t.system || actor) {
    const reason = await permissionOk(tx, t, actor, instance);
    if (reason) throw new ForbiddenTransitionError(reason);
  }

  // 3. guards, pre-evaluated for the transition and the compound's synthetic follow-ups
  const verdicts = new Map<string, GuardVerdict>();
  const candidates = [
    t,
    transitionOf(def.definition, `${instance.currentState}.$join`),
    transitionOf(def.definition, `${instance.currentState}.$reject`),
  ];
  for (const c of candidates) {
    if (!c) continue;
    for (const g of c.guards) {
      if (!verdicts.has(`${c.key}:${g}`))
        verdicts.set(
          `${c.key}:${g}`,
          await evaluateGuard(g, guardContext(tx, def, instance, c, actor, input)),
        );
    }
  }
  const now = new Date();
  const result = step(
    def.definition,
    snapshotOf(instance),
    {
      transitionKey,
      branchKey: input.branchKey,
      comment: input.comment,
      fields: input.fields,
      attachments: input.attachments,
      now,
      personIds: input.personIds,
    },
    (g, tr) =>
      verdicts.get(`${tr.key}:${g}`) ?? { ok: false, reason: `guard "${g}" was not evaluated` },
  );

  // 4. persist the new snapshot
  const stateChanged = result.next.currentState !== instance.currentState;
  const updated = (await tx.workflowInstance.update({
    where: { id: instance.id },
    data: {
      currentState: result.next.currentState,
      branchStates: result.next.branchStates ? toJson(result.next.branchStates) : Prisma.JsonNull,
      ...(stateChanged
        ? { enteredAt: now, dueAt: dueFrom(def.definition, result.next.currentState, now) }
        : {}),
      rowVersion: { increment: 1 },
    },
  })) as InstanceRow;
  const subject = { subjectType: instance.subjectType, subjectId: instance.subjectId };

  // 5. log, audit, effects per applied step (synthetic joins included)
  for (const s of result.applied) {
    await tx.workflowTransitionLog.create({
      data: {
        departmentId: instance.departmentId,
        instanceId: instance.id,
        transitionKey: s.transitionKey,
        branchKey: s.branchKey ?? null,
        fromState: s.fromState,
        toState: s.toState,
        actorUserId: s.system ? null : (actor?.userId ?? null),
        comment: s.system ? null : (input.comment ?? null),
        payloadJson: toJson({
          fields: input.fields ?? null,
          payload: input.payload ?? null,
          branchStates: result.next.branchStates ?? null,
        }),
      },
    });
    await record(tx, {
      action: "transition",
      subjectType: instance.subjectType,
      subjectId: instance.subjectId,
      departmentId: instance.departmentId,
      actorUserId: s.system ? null : (actor?.userId ?? null),
      reason: s.system ? s.transitionKey : (input.comment ?? null),
      fieldChanges: { currentState: { before: s.fromState, after: s.toState } },
    });
    await runEffects(s.effects, {
      tx,
      definition: def.definition,
      instance: {
        id: instance.id,
        subjectType: instance.subjectType,
        subjectId: instance.subjectId,
        departmentId: instance.departmentId,
        currentState: s.toState,
      },
      step: s,
      actor,
      input: {
        comment: input.comment,
        fields: input.fields,
        payload: input.payload,
        branchKey: input.branchKey,
      },
    });
  }
  await publish(
    tx,
    "workflow.transitioned",
    subject,
    {
      instanceId: instance.id,
      definitionKey: instance.definitionKey,
      from: instance.currentState,
      to: result.next.currentState,
      transitions: result.applied.map((a) => a.transitionKey),
      terminal: result.terminal,
    },
    { departmentId: instance.departmentId },
  );
  return {
    instance: updated,
    applied: result.applied.map((a) => ({
      transitionKey: a.transitionKey,
      ...(a.branchKey ? { branchKey: a.branchKey } : {}),
      fromState: a.fromState,
      toState: a.toState,
    })),
    terminal: result.terminal,
    ...(result.terminalCategory ? { terminalCategory: result.terminalCategory } : {}),
  };
}

/** Applies a transition in its own department transaction (server actions, jobs). */
export async function apply(
  departmentId: string,
  instanceId: string,
  transitionKey: string,
  actor: Actor | null,
  input: ApplyInput = {},
): Promise<ApplyResult> {
  return withTenantTx(departmentId, (tx) => applyIn(tx, instanceId, transitionKey, actor, input));
}

export interface ListFilter {
  definitionKey?: string;
  states?: string[];
  subjectType?: string;
  overdueBefore?: Date;
}

export async function listInstances(tx: Db, departmentId: string, filter: ListFilter = {}) {
  return tx.workflowInstance.findMany({
    where: {
      departmentId,
      ...(filter.definitionKey ? { definitionKey: filter.definitionKey } : {}),
      ...(filter.states?.length ? { currentState: { in: filter.states } } : {}),
      ...(filter.subjectType ? { subjectType: filter.subjectType as never } : {}),
      ...(filter.overdueBefore ? { dueAt: { lt: filter.overdueBefore } } : {}),
    },
    orderBy: { enteredAt: "asc" },
  }) as Promise<InstanceRow[]>;
}

/**
 * Moves an instance to another definition version, mapping states (and branch states) through
 * `stateMap`; unmapped states keep their key. Logged as a `$migrate` transition and audited.
 */
export async function migrateInstance(
  tx: Db,
  instanceId: string,
  toDefinitionId: string,
  stateMap: Record<string, string> = {},
  actor: Actor | null = null,
): Promise<InstanceRow> {
  await tx.$queryRaw`SELECT id FROM workflow_instance WHERE id = ${instanceId} FOR UPDATE`;
  const instance = (await tx.workflowInstance.findUniqueOrThrow({
    where: { id: instanceId },
  })) as InstanceRow;
  const target = await definitionById(tx, toDefinitionId);
  if (target.key !== instance.definitionKey)
    throw new WorkflowError(
      "Instances migrate only between versions of the same definition",
      "migration_key",
    );
  const nextState = stateMap[instance.currentState] ?? instance.currentState;
  if (!stateOf(target.definition, nextState))
    throw new WorkflowError(
      `State "${nextState}" does not exist in version ${target.version}`,
      "migration_state",
    );
  const branches = instance.branchStates as BranchStates | null;
  const nextBranches = branches
    ? Object.fromEntries(
        Object.entries(branches).map(([k, v]) => [
          k,
          { ...v, state: stateMap[v.state] ?? v.state },
        ]),
      )
    : null;
  const updated = (await tx.workflowInstance.update({
    where: { id: instanceId },
    data: {
      definitionId: target.id,
      definitionVersion: target.version,
      currentState: nextState,
      branchStates: nextBranches ? toJson(nextBranches) : Prisma.JsonNull,
      rowVersion: { increment: 1 },
    },
  })) as InstanceRow;
  await tx.workflowTransitionLog.create({
    data: {
      departmentId: instance.departmentId,
      instanceId,
      transitionKey: "$migrate",
      fromState: instance.currentState,
      toState: nextState,
      actorUserId: actor?.userId ?? null,
      payloadJson: toJson({
        fromVersion: instance.definitionVersion,
        toVersion: target.version,
        stateMap,
      }),
    },
  });
  await record(tx, {
    action: "update",
    subjectType: "workflow_instance",
    subjectId: instanceId,
    departmentId: instance.departmentId,
    actorUserId: actor?.userId ?? null,
    reason: `migrated to version ${target.version}`,
    fieldChanges: {
      definitionVersion: { before: instance.definitionVersion, after: target.version },
      currentState: { before: instance.currentState, after: nextState },
    },
  });
  return updated;
}
