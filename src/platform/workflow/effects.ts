import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import type { Actor } from "../identity/can";
import type { AppliedStep } from "./machine";
import type { Definition, EffectKind, EffectSpec } from "./schema";

// Ordered effects run after a transition inside the same transaction. Built-ins: setField
// (allow-listed derived caches), emit (outbox), invokeHandler (named handlers). Every other
// kind is a recording no-op until its phase replaces it (notifications, tasks, reminders,
// blocks, documents, feature steps).

export interface EffectContext {
  tx: Db;
  definition: Definition;
  instance: {
    id: string;
    subjectType: string;
    subjectId: string;
    departmentId: string;
    currentState: string;
  };
  step: AppliedStep;
  actor: Actor | null;
  input: {
    comment?: string;
    fields?: Record<string, unknown>;
    payload?: unknown;
    branchKey?: string;
  };
}

export type EffectHandler = (args: Record<string, unknown>, ctx: EffectContext) => Promise<void>;

type NamedHandler = (ctx: EffectContext, args: Record<string, unknown>) => Promise<void>;
const handlers = globalSingleton("workflow-effects", () => new Map<EffectKind, EffectHandler>());
const namedHandlers = globalSingleton("workflow-handlers", () => new Map<string, NamedHandler>());

/** Effects that ran as no-ops (inspectable by tests and the admin simulator). */
export const recorded = globalSingleton(
  "workflow-recorded",
  () => [] as Array<{ kind: EffectKind; args: Record<string, unknown>; instanceId: string }>,
);

export function registerEffect(kind: EffectKind, handler: EffectHandler): void {
  handlers.set(kind, handler);
}

/**
 * Registers a handler only when the kind has none yet. The recording no-ops below run at
 * module scope, and Next.js may load a second copy of this module after the real handlers
 * were installed — overwriting them would silently turn notifications into no-ops.
 */
function registerDefaultEffect(kind: EffectKind, handler: EffectHandler): void {
  if (!handlers.has(kind)) handlers.set(kind, handler);
}

export function registerHandler(
  name: string,
  fn: (ctx: EffectContext, args: Record<string, unknown>) => Promise<void>,
): void {
  namedHandlers.set(name, fn);
}

/** (subjectType, field) pairs setField may write: derived caches only. */
interface SetFieldTarget {
  model: string;
  column: string;
  idField?: string;
}

// On globalThis: services extend this list at bootstrap, and Next.js may hold more than one
// copy of this module (see DEVIATIONS, P4) — a module-local object would lose the additions.
const SET_FIELD_ALLOW = globalSingleton<Record<string, Record<string, SetFieldTarget>>>(
  "workflow-setfield-allow",
  () => ({
    course_offering: {
      decisionNote: { model: "courseOffering", column: "decisionNote" },
      schemeStructureLockedAt: { model: "courseOffering", column: "schemeStructureLockedAt" },
    },
    section_offering: {
      assessmentLockedAt: { model: "sectionOffering", column: "assessmentLockedAt" },
      assessmentLockedByPortfolioId: {
        model: "sectionOffering",
        column: "assessmentLockedByPortfolioId",
      },
    },
    group: {
      status: { model: "group", column: "status" },
      deactivatedAt: { model: "group", column: "deactivatedAt" },
    },
    workflow_instance: { dueAt: { model: "workflowInstance", column: "dueAt" } },
  }),
);

export function allowSetField(
  subjectType: string,
  field: string,
  target: { model: string; column: string; idField?: string },
): void {
  (SET_FIELD_ALLOW[subjectType] ??= {})[field] = target;
}

function resolveValue(raw: unknown, ctx: EffectContext): unknown {
  if (typeof raw === "string" && raw.startsWith("$")) {
    if (raw === "$now") return new Date();
    if (raw === "$comment") return ctx.input.comment ?? null;
    if (raw.startsWith("$fields.")) return ctx.input.fields?.[raw.slice(8)] ?? null;
    if (raw === "$actorUserId") return ctx.actor?.userId ?? null;
    if (raw === "$toState") return ctx.step.toState;
  }
  return raw;
}

registerEffect("setField", async (args, ctx) => {
  const subjectType =
    typeof args.subjectType === "string" ? args.subjectType : ctx.instance.subjectType;
  const subjectId =
    typeof args.subjectId === "string"
      ? args.subjectId
      : subjectType === "workflow_instance"
        ? ctx.instance.id
        : ctx.instance.subjectId;
  const field = String(args.field ?? "");
  const target = SET_FIELD_ALLOW[subjectType]?.[field];
  if (!target)
    throw new Error(`setField: ${subjectType}.${field} is not an allow-listed derived cache`);
  const delegate = (ctx.tx as unknown as Record<string, { update(a: unknown): Promise<unknown> }>)[
    target.model
  ];
  if (!delegate) throw new Error(`setField: no delegate for ${target.model}`);
  await delegate.update({
    where: { [target.idField ?? "id"]: subjectId },
    data: { [target.column]: resolveValue(args.value, ctx) },
  });
});

registerEffect("emit", async (args, ctx) => {
  const name = String(args.name ?? "");
  if (!name) throw new Error("emit: name is required");
  await publish(
    ctx.tx,
    name,
    { subjectType: ctx.instance.subjectType, subjectId: ctx.instance.subjectId },
    {
      ...(typeof args.payload === "object" && args.payload
        ? (args.payload as Record<string, unknown>)
        : {}),
      transition: ctx.step.transitionKey,
      toState: ctx.step.toState,
    },
    { departmentId: ctx.instance.departmentId },
  );
});

registerEffect("invokeHandler", async (args, ctx) => {
  const name = String(args.handler ?? "");
  const fn = namedHandlers.get(name);
  if (!fn) throw new Error(`invokeHandler: unknown handler "${name}"`);
  await fn(ctx, args);
});

const NOOP_KINDS: EffectKind[] = [
  "notify",
  "createTask",
  "registerBlocks",
  "removeBlocks",
  "subscribeReminders",
  "cancelReminders",
  "cancelScheduled",
  "scheduleAutoTransition",
  "generateDocument",
  "enterStep",
  "exitStep",
  "enterParallel",
  "completeBranch",
  "rejectBranch",
  "setTerminal",
  "feature",
];
for (const kind of NOOP_KINDS) {
  registerDefaultEffect(kind, async (args, ctx) => {
    recorded.push({ kind, args, instanceId: ctx.instance.id });
  });
}

export async function runEffects(effects: EffectSpec[], ctx: EffectContext): Promise<void> {
  for (const e of effects) {
    const h = handlers.get(e.kind);
    if (!h) throw new Error(`No handler registered for effect "${e.kind}"`);
    await h(e.args, ctx);
  }
}
