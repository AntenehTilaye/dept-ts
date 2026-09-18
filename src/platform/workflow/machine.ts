import {
  GuardFailedError,
  RequiredInputError,
  TransitionNotAllowedError,
  UnknownTransitionError,
} from "./errors";
import type {
  BranchStates,
  CompoundSpec,
  Definition,
  EffectSpec,
  WorkflowStateJson,
  WorkflowTransitionJson,
} from "./schema";

// The pure state machine: no I/O. Given a definition and a snapshot it resolves transitions,
// checks required input and guards (by name, through a synchronous evaluator the engine
// pre-computes), computes the next snapshot including compound branch bookkeeping, and emits
// the synthetic `<group>.$join` / `<group>.$reject` steps.

export interface Snapshot {
  currentState: string;
  branchStates: BranchStates | null;
}

export interface StepInput {
  transitionKey: string;
  /** Static branch key, or the person id for dynamic ($person) branches. */
  branchKey?: string;
  comment?: string;
  fields?: Record<string, unknown>;
  attachments?: string[];
  now: Date;
  /** Person ids to instantiate when a transition enters a dynamic compound state. */
  personIds?: string[];
}

export interface AppliedStep {
  transitionKey: string;
  branchKey?: string;
  fromState: string;
  toState: string;
  system: boolean;
  effects: EffectSpec[];
}

export interface StepResult {
  next: Snapshot;
  applied: AppliedStep[];
  terminal: boolean;
  terminalCategory?: "success" | "rejected" | "cancelled";
}

export type GuardVerdict = true | { ok: false; reason?: string };
export type GuardEvaluator = (guard: string, transition: WorkflowTransitionJson) => GuardVerdict;

export function stateOf(def: Definition, key: string): WorkflowStateJson | undefined {
  return def.states.find((s) => s.key === key);
}

export function transitionOf(def: Definition, key: string): WorkflowTransitionJson | undefined {
  return def.transitions.find((t) => t.key === key);
}

export function isTerminal(def: Definition, key: string): boolean {
  return stateOf(def, key)?.category === "terminal";
}

/** The compound spec the snapshot currently sits in, if any. */
export function compoundOf(
  def: Definition,
  snapshot: Snapshot,
): { state: WorkflowStateJson; compound: CompoundSpec } | null {
  const s = stateOf(def, snapshot.currentState);
  return s?.compound ? { state: s, compound: s.compound } : null;
}

/** Branch spec for a branch key (dynamic branches all map to the $person template). */
function branchSpec(compound: CompoundSpec, branchKey: string) {
  return compound.dynamic
    ? compound.branches[0]!
    : compound.branches.find((b) => b.key === branchKey);
}

/** Transitions applicable right now: top-level from the current state, plus active branch states. */
export function applicableTransitions(
  def: Definition,
  snapshot: Snapshot,
): Array<{ transition: WorkflowTransitionJson; branchKey?: string }> {
  const out: Array<{ transition: WorkflowTransitionJson; branchKey?: string }> = [];
  for (const t of def.transitions) {
    // synthetic $join/$reject are applied by the machine itself, never offered
    if (t.from === snapshot.currentState && !t.branch && !t.action.startsWith("$"))
      out.push({ transition: t });
  }
  const c = compoundOf(def, snapshot);
  if (c && snapshot.branchStates) {
    for (const [branchKey, bs] of Object.entries(snapshot.branchStates)) {
      if (bs.status !== "active") continue;
      const templateKey = c.compound.dynamic ? "$person" : branchKey;
      for (const t of def.transitions) {
        if (t.branch === templateKey && t.from === bs.state) out.push({ transition: t, branchKey });
      }
    }
  }
  return out;
}

function initialBranchStates(
  compound: CompoundSpec,
  now: Date,
  personIds?: string[],
): BranchStates {
  const enteredAt = now.toISOString();
  const out: BranchStates = {};
  if (compound.dynamic) {
    for (const id of personIds ?? [])
      out[id] = {
        state: compound.branches[0]!.initialState,
        status: "active",
        enteredAt,
        actorPersonId: id,
      };
    return out;
  }
  for (const b of compound.branches)
    out[b.key] = { state: b.initialState, status: "active", enteredAt };
  return out;
}

function checkRequired(t: WorkflowTransitionJson, input: StepInput): void {
  const missingFields = t.requiredFields.filter((f) => {
    const v = input.fields?.[f];
    return v === undefined || v === null || v === "";
  });
  const missingAttachments = t.requiredAttachments.filter(
    (slot) => !(input.attachments ?? []).includes(slot),
  );
  const missingComment = t.requiredComment && !(input.comment && input.comment.trim().length > 0);
  if (!missingComment && !missingFields.length && !missingAttachments.length) return;
  const parts = [
    missingComment ? "a comment" : null,
    missingFields.length ? `fields ${missingFields.join(", ")}` : null,
    missingAttachments.length ? `attachments ${missingAttachments.join(", ")}` : null,
  ].filter(Boolean);
  throw new RequiredInputError(`This action requires ${parts.join(" and ")}`, {
    ...(missingComment ? { comment: true } : {}),
    ...(missingFields.length ? { fields: missingFields } : {}),
    ...(missingAttachments.length ? { attachments: missingAttachments } : {}),
  });
}

function runGuards(t: WorkflowTransitionJson, evaluate: GuardEvaluator): void {
  for (const g of t.guards) {
    const r = evaluate(g, t);
    if (r === true) continue;
    throw new GuardFailedError(g, r.reason);
  }
}

/** Synthetic system transitions of a compound state, unless the definition declares them. */
function syntheticTransition(
  def: Definition,
  group: string,
  kind: "$join" | "$reject",
  to: string,
): WorkflowTransitionJson {
  const key = `${group}.${kind}`;
  return (
    transitionOf(def, key) ?? {
      key,
      from: group,
      to,
      action: kind,
      system: true,
      actorRules: [],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      effects: [],
    }
  );
}

export function completionReached(compound: CompoundSpec, branchStates: BranchStates): boolean {
  const all = Object.values(branchStates);
  const done = all.filter((b) => b.status === "done").length;
  switch (compound.completion.rule) {
    case "all":
      return done > 0 && all.every((b) => b.status === "done" || b.status === "skipped");
    case "quorum":
      return done >= compound.completion.n;
    case "any":
      return done >= 1;
  }
}

function skipActive(branchStates: BranchStates): BranchStates {
  const out: BranchStates = {};
  for (const [k, v] of Object.entries(branchStates))
    out[k] = v.status === "active" ? { ...v, status: "skipped" } : v;
  return out;
}

/** Moves into a state; entering a compound state instantiates its branches. */
function enterState(def: Definition, to: string, input: StepInput): Snapshot {
  const target = stateOf(def, to);
  if (target?.compound) {
    return {
      currentState: to,
      branchStates: initialBranchStates(target.compound, input.now, input.personIds),
    };
  }
  return { currentState: to, branchStates: null };
}

function finish(def: Definition, next: Snapshot, applied: AppliedStep[]): StepResult {
  const s = stateOf(def, next.currentState);
  const terminal = s?.category === "terminal";
  return {
    next,
    applied,
    terminal,
    ...(terminal ? { terminalCategory: s?.terminalCategory ?? "success" } : {}),
  };
}

/** The initial snapshot of a definition (a compound initial state gets its branches). */
export function initialSnapshot(def: Definition, now: Date, personIds?: string[]): Snapshot {
  return enterState(def, def.initialState, { transitionKey: "$start", now, personIds });
}

/** Applies one transition (and any synthetic follow-ups) to the snapshot. */
export function step(
  def: Definition,
  snapshot: Snapshot,
  input: StepInput,
  evaluate: GuardEvaluator = () => true,
): StepResult {
  const t = transitionOf(def, input.transitionKey);
  if (!t) throw new UnknownTransitionError(input.transitionKey);
  checkRequired(t, input);
  const applied: AppliedStep[] = [];

  if (!t.branch) {
    if (t.from !== snapshot.currentState)
      throw new TransitionNotAllowedError(
        `"${t.action}" is not available from "${snapshot.currentState}"`,
      );
    runGuards(t, evaluate);
    applied.push({
      transitionKey: t.key,
      fromState: t.from,
      toState: t.to,
      system: t.system,
      effects: t.effects,
    });
    return finish(def, enterState(def, t.to, input), applied);
  }

  const c = compoundOf(def, snapshot);
  if (!c || !snapshot.branchStates)
    throw new TransitionNotAllowedError(
      `"${t.key}" is a branch action but the record is not in a compound state`,
    );
  const branchKey = input.branchKey ?? (c.compound.dynamic ? undefined : t.branch);
  if (!branchKey) throw new TransitionNotAllowedError(`"${t.key}" needs a branchKey`);
  const bs = snapshot.branchStates[branchKey];
  const spec = branchSpec(c.compound, branchKey);
  if (!bs || !spec) throw new TransitionNotAllowedError(`Branch "${branchKey}" does not exist`);
  if (bs.status !== "active")
    throw new TransitionNotAllowedError(`Branch "${branchKey}" is ${bs.status}`);
  if (bs.state !== t.from)
    throw new TransitionNotAllowedError(
      `Branch "${branchKey}" is in "${bs.state}", not "${t.from}"`,
    );
  if (!c.compound.dynamic && t.branch !== branchKey)
    throw new TransitionNotAllowedError(`"${t.key}" belongs to branch "${t.branch}"`);
  runGuards(t, evaluate);

  const status =
    t.to === spec.doneState ? "done" : t.to === spec.rejectedState ? "rejected" : "active";
  let branchStates: BranchStates = {
    ...snapshot.branchStates,
    [branchKey]: { ...bs, state: t.to, status },
  };
  applied.push({
    transitionKey: t.key,
    branchKey,
    fromState: t.from,
    toState: t.to,
    system: t.system,
    effects: t.effects,
  });
  let next: Snapshot = { currentState: snapshot.currentState, branchStates };

  if (status === "rejected" && c.compound.onReject) {
    const rej = syntheticTransition(def, c.state.key, "$reject", c.compound.onReject);
    branchStates = skipActive(branchStates);
    next = enterState(def, rej.to, input);
    applied.push({
      transitionKey: rej.key,
      fromState: c.state.key,
      toState: rej.to,
      system: true,
      effects: rej.effects,
    });
  } else if (completionReached(c.compound, branchStates)) {
    const join = syntheticTransition(def, c.state.key, "$join", c.compound.onComplete);
    branchStates = skipActive(branchStates);
    next = enterState(def, join.to, input);
    applied.push({
      transitionKey: join.key,
      fromState: c.state.key,
      toState: join.to,
      system: true,
      effects: join.effects,
    });
  }
  return finish(def, next, applied);
}
