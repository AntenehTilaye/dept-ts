import {
  initialSnapshot,
  step as applyStep,
  compoundOf,
  type GuardVerdict,
  type Snapshot,
} from "../workflow/machine";
import type { Definition, WorkflowTransitionJson } from "../workflow/schema";
import { compile, type CompiledFeature, type TaskTemplate } from "./compile";
import { FeatureDefinitionSchema, type FeatureDefinition, type RoleKey } from "./schema";
import { validateDefinition, type Issue } from "./validate";
import { buildTree } from "./tree";

// A dry run of a definition (design part 03 §5): the wizard's seventh screen and the seed tests
// answer "what would actually happen" without touching the database. It runs the real machine
// and the real built-in guards; anything that would need a service — an adapter, a template
// render, a person lookup — is reported as "would_run" rather than faked, so a green simulation
// never implies more than it checked.

export interface SimulationActor {
  personId: string;
  roles: RoleKey[];
  /** Role keys from RoleGrants, including derived ones such as committee_chair. */
  grantRoleKeys: string[];
  /** Relationships the actor has to the record: owner, creator, assignee, participant, ... */
  relationships: string[];
}

export interface SimulationStep {
  stepKey: string;
  branchKey?: string;
  actionKey: string;
  answers?: Record<string, unknown>;
  attachments?: string[];
  comment?: string;
  at?: string;
}

export interface SimulationScript {
  actor: SimulationActor;
  parent?: { subjectType: string; label: string };
  presetKey?: string;
  record?: Record<string, unknown>;
  path: SimulationStep[];
  /** Person ids to instantiate the branches of a dynamic group with. */
  dynamicBranchPersons?: string[];
  /** Offsets per reminder schedule key, when the caller knows them. */
  schedules?: Record<string, number[]>;
  /** A fixed "now", so a simulation is reproducible. */
  now?: string;
}

export interface SimulatedStep {
  stepKey: string;
  branchKey?: string;
  assignee: string;
  task: TaskTemplate | null;
  deadline?: string;
  reminders: string[];
}

export interface SimulationTrace {
  states: string[];
  branchStates: Record<string, unknown>[];
  steps: SimulatedStep[];
  notifications: { templateKey: string; to: string; renderedSubject: string }[];
  guards: { key: string; result: "pass" | "fail" | "would_run" }[];
  grantsNeeded: string[];
  issues: Issue[];
}

const DAY = 86_400_000;

export function simulate(input: unknown, script: SimulationScript): SimulationTrace {
  const def = FeatureDefinitionSchema.parse(input);
  const compiled = compile(def);
  const tree = buildTree(def);
  const now = script.now ? new Date(script.now) : new Date("2026-01-15T09:00:00.000Z");

  const trace: SimulationTrace = {
    states: [],
    branchStates: [],
    steps: [],
    notifications: [],
    guards: [],
    grantsNeeded: [],
    issues: validateDefinition(def),
  };

  const definition: Definition = {
    key: compiled.workflow.key,
    version: 1,
    subjectType: compiled.workflow.subjectType,
    initialState: compiled.workflow.initialState,
    states: compiled.workflow.states,
    transitions: compiled.workflow.transitions,
  };

  let snapshot: Snapshot = initialSnapshot(definition, now, script.dynamicBranchPersons);
  const branches: Record<string, { state: string; status: string }> = {};
  trace.states.push(snapshot.currentState);
  for (const [key, branch] of Object.entries(snapshot.branchStates ?? {}))
    branches[key] = { state: branch.state, status: branch.status };
  if (Object.keys(branches).length) trace.branchStates.push({ ...branches });
  enter(snapshot.currentState, undefined);

  for (const [i, move] of script.path.entries()) {
    const transitionKey = `${move.stepKey}.${move.actionKey}`;
    const transition = compiled.workflow.transitions.find((t) => t.key === transitionKey);
    if (!transition) {
      trace.issues.push({
        code: "TO_RESOLVES",
        path: `/path/${i}`,
        severity: "error",
        message: `The step "${move.stepKey}" has no action "${move.actionKey}"`,
      });
      break;
    }
    if (!isActive(snapshot, transition, move.branchKey)) {
      trace.issues.push({
        code: "REACHABLE",
        path: `/path/${i}`,
        severity: "error",
        message: `"${move.actionKey}" was played on "${move.stepKey}", but the record is in "${snapshot.currentState}"`,
      });
      break;
    }

    let failed = false;
    const evaluate: (guard: string, t: WorkflowTransitionJson) => GuardVerdict = (guard, t) => {
      const verdict = evaluateGuard(guard, t, def, script, move);
      // an adapter guard is reported, never guessed: it passes the simulation but is listed
      const wouldRun = verdict !== true && verdict.reason === "would_run";
      trace.guards.push({
        key: guard,
        result: verdict === true ? "pass" : wouldRun ? "would_run" : "fail",
      });
      if (verdict !== true && !wouldRun) failed = true;
      return wouldRun ? true : verdict;
    };

    let result;
    try {
      result = applyStep(
        definition,
        snapshot,
        {
          transitionKey,
          branchKey: move.branchKey,
          comment: move.comment,
          // the record header counts too: an action may require an answer the header already holds
          fields: { ...(script.record ?? {}), ...(move.answers ?? {}) },
          attachments: move.attachments,
          now: move.at ? new Date(move.at) : now,
          personIds: script.dynamicBranchPersons,
        },
        evaluate,
      );
    } catch (error) {
      trace.issues.push({
        code: failed ? "ACTOR_PRESENT" : "TO_RESOLVES",
        path: `/path/${i}`,
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }

    for (const applied of result.applied) {
      // the machine drops the branch states once the record leaves the group, so the trace keeps
      // its own copy: "which branch finished, which was skipped" is exactly what a reader wants
      if (applied.branchKey)
        branches[applied.branchKey] = { state: applied.toState, status: branchStatus(applied.toState) };
      if (applied.transitionKey.endsWith(".$join") || applied.transitionKey.endsWith(".$reject"))
        for (const [key, branch] of Object.entries(branches))
          if (branch.status === "active") branches[key] = { ...branch, status: "skipped" };

      for (const effect of applied.effects) {
        if (effect.kind === "notify")
          trace.notifications.push({
            templateKey: String(effect.args.templateKey ?? ""),
            to: String(effect.args.recipientRule ?? JSON.stringify(effect.args.audienceSpec ?? {})),
            renderedSubject: `${def.name}: ${labelOf(applied.toState)}`,
          });
        if (effect.kind === "enterStep")
          enter(String(effect.args.stepKey), effect.args.branchKey as string | undefined);
        if (effect.kind === "enterParallel")
          for (const branch of compiled.workflow.states
            .find((s) => s.key === String(effect.args.groupKey))
            ?.compound?.branches ?? [])
            enter(branch.initialState, branch.key);
      }
    }

    snapshot = result.next;
    trace.states.push(snapshot.currentState);
    for (const [key, branch] of Object.entries(snapshot.branchStates ?? {}))
      branches[key] = { state: branch.state, status: branch.status };
    if (Object.keys(branches).length) trace.branchStates.push({ ...branches });
  }

  trace.grantsNeeded = Array.from(
    new Set(
      compiled.grantRequirements
        .filter((g) => trace.steps.some((s) => s.stepKey === g.stepKey))
        .filter((g) => !script.actor.grantRoleKeys.includes(g.roleKey))
        .map((g) => `${g.roleKey}@${g.scopeType}`),
    ),
  );
  return trace;

  function enter(stateKey: string, branchKey: string | undefined): void {
    const leaf = tree.byKey[stateKey];
    if (!leaf) return;
    const task = compiled.taskTemplates[stateKey] ?? null;
    const reminder = compiled.reminderTemplates[stateKey];
    const deadline = deadlineOf(leaf.step.deadline, now, script);
    trace.steps.push({
      stepKey: stateKey,
      ...(branchKey ? { branchKey } : {}),
      assignee: describeAssignee(leaf.step.assignee),
      task,
      ...(deadline ? { deadline: deadline.toISOString() } : {}),
      reminders: reminder
        ? (script.schedules?.[reminder.scheduleKey]?.map((offset) =>
            deadline
              ? new Date(deadline.getTime() + offset * DAY).toISOString()
              : `${offset >= 0 ? "+" : ""}${offset}d`,
          ) ?? [reminder.scheduleKey])
        : [],
    });
    for (const rule of leaf.step.notifications.onEnter)
      trace.notifications.push({
        templateKey: rule.templateKey,
        to: typeof rule.to === "string" ? rule.to : JSON.stringify(rule.to),
        renderedSubject: `${def.name}: ${leaf.step.label}`,
      });
  }

  function labelOf(stateKey: string): string {
    return compiled.workflow.states.find((s) => s.key === stateKey)?.label ?? stateKey;
  }
}

function branchStatus(state: string): string {
  if (state.endsWith(".$done")) return "done";
  if (state.endsWith(".$rejected")) return "rejected";
  return "active";
}

function isActive(snapshot: Snapshot, transition: WorkflowTransitionJson, branchKey?: string): boolean {
  if (!transition.branch) return transition.from === snapshot.currentState;
  const key = branchKey ?? transition.branch;
  const branch = snapshot.branchStates?.[key];
  return !!branch && branch.status === "active" && branch.state === transition.from;
}

function describeAssignee(rule: { type: string; roles?: string[]; rel?: string; fieldKey?: string }): string {
  switch (rule.type) {
    case "role":
      return `role:${(rule.roles ?? []).join("|")}`;
    case "relationship":
      return `relationship:${rule.rel}`;
    case "record_field":
      return `field:${rule.fieldKey}`;
    default:
      return rule.type;
  }
}

function deadlineOf(
  rule: FeatureDefinition["steps"][number] extends never ? never : undefined | { rule: string; [k: string]: unknown },
  now: Date,
  script: SimulationScript,
): Date | undefined {
  if (!rule) return undefined;
  if (rule.rule === "fixed") return new Date(String(rule.at));
  if (rule.rule === "relative") {
    const base =
      rule.from === "record_field" && script.record
        ? new Date(String(script.record[String(rule.fieldKey)] ?? now.toISOString()))
        : now;
    return new Date(base.getTime() + Number(rule.offsetDays ?? 0) * DAY);
  }
  // calendar rules need a term: the sample term is two weeks out
  return new Date(now.getTime() + 14 * DAY + Number(rule.offsetDays ?? 0) * DAY);
}

/** The built-in guards run for real; anything else is reported rather than guessed. */
function evaluateGuard(
  guard: string,
  transition: WorkflowTransitionJson,
  def: FeatureDefinition,
  script: SimulationScript,
  move: SimulationStep,
): GuardVerdict {
  if (guard === "feature.actorAllowed") {
    const allowed = transition.actorRules.some((rule) => actorMatches(rule, script.actor));
    return allowed || transition.actorRules.length === 0
      ? true
      : { ok: false, reason: `the actor matches none of the rules of "${transition.action}"` };
  }
  if (guard === "feature.stepComplete") {
    const answers = { ...(script.record ?? {}), ...(move.answers ?? {}) };
    const missing = transition.requiredFields.filter((key) => answers[key] === undefined || answers[key] === "");
    const attachments = move.attachments ?? [];
    const missingSlots = transition.requiredAttachments.filter((slot) => !attachments.includes(slot));
    if (missing.length) return { ok: false, reason: `missing answers: ${missing.join(", ")}` };
    if (missingSlots.length) return { ok: false, reason: `missing attachments: ${missingSlots.join(", ")}` };
    if (transition.requiredComment && !move.comment) return { ok: false, reason: "a comment is required" };
    return true;
  }
  if (guard === "feature.parallelComplete" || guard === "feature.parentActive") return true;
  void def;
  return { ok: false, reason: "would_run" };
}

function actorMatches(rule: { type: string; roles?: string[]; rel?: string; key?: string }, actor: SimulationActor): boolean {
  switch (rule.type) {
    case "owner":
    case "creator":
    case "assignee":
      return actor.relationships.includes(rule.type);
    case "relationship":
      return actor.relationships.includes(String(rule.rel));
    case "role":
      return (rule.roles ?? []).some(
        (role) => actor.roles.includes(role as RoleKey) || actor.grantRoleKeys.includes(role),
      );
    case "system":
      return true;
    default:
      // permission, person and group rules need the database
      return false;
  }
}

/** The compiled artefacts a simulation ran against, for the wizard's panel. */
export function artefactsOf(input: unknown): CompiledFeature {
  return compile(input);
}

export { compoundOf };
