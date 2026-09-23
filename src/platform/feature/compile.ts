import type { FormKind, Priority } from "@/generated/prisma/enums";
import type { FieldDef } from "../forms/field-schema";
import type {
  BranchSpec,
  EffectSpec,
  WorkflowDefinitionInput,
  WorkflowStateJson,
  WorkflowTransitionJson,
} from "../workflow/schema";
import { allLocks } from "./locks";
import {
  branchesOf,
  FeatureDefinitionSchema,
  type ActionDef,
  type AssigneeRuleType as AssigneeRule,
  type AudienceRef,
  type DeadlineRule,
  type FeatureDefinition,
  type NotificationRule,
  type ParallelGroup,
  type StepDef,
  type TerminalState,
} from "./schema";
import {
  branchDoneState,
  branchLeaves,
  branchRejectedState,
  buildTree,
  resolveTarget,
  type Leaf,
  type StateEntry,
  type Tree,
} from "./tree";

// Compiling a definition (design part 03 §3) is the whole point of the builder: an authored
// document becomes artefacts of the kernels that already exist — one WorkflowDefinition, a form
// per step, a task template per leaf, reminder subscriptions, permission rows — so the runtime
// has nothing feature-specific left to interpret. It is pure: the same definition always
// compiles to the same artefacts, which is what makes it snapshot-testable and simulatable.

export interface CompiledForm {
  /** Step key, or `record` for the record header. */
  stepKey: string;
  key: string;
  kind: FormKind;
  title: string;
  fields: FieldDef[];
  /** Set when the step reuses an existing FormDefinition instead of inline questions. */
  reuseFormKey?: string;
}

export interface TaskTemplate {
  stepKey: string;
  branchKey?: string;
  /** False for task-backed features: the record already is the task. */
  createTask: boolean;
  kind: "feature_step";
  titleTemplate: string;
  assignee: AssigneeRule;
  priority: Priority;
  expectedDeliverables: { key: string; label: string; required: boolean }[];
  deadline?: DeadlineRule;
  reminderScheduleKey?: string;
  contextRef: "feature_record";
}

export interface ReminderTemplate {
  stepKey: string;
  scheduleKey: string;
  audience: "assignee" | "owner" | "both";
  escalateToRole?: string;
  deadline: DeadlineRule;
}

export interface GrantRequirement {
  stepKey: string;
  actionKey?: string;
  roleKey: string;
  scopeType: string;
  derivedFrom: string;
}

export interface RolePermission {
  roleKey: string;
  permissionKey: string;
  level: string;
}

export interface CompiledReport {
  key: string;
  title: string;
  templateKey: string;
  formats: string[];
  dataSourceKey: string;
  parameters: FieldDef[];
  requiredPermission?: string;
}

export interface CompiledFeature {
  workflow: WorkflowDefinitionInput;
  forms: Record<string, CompiledForm>;
  taskTemplates: Record<string, TaskTemplate>;
  reminderTemplates: Record<string, ReminderTemplate>;
  permissionKeys: string[];
  rolePermissions: RolePermission[];
  grantRequirements: GrantRequirement[];
  report?: CompiledReport;
  stateIndex: Record<string, StateEntry>;
  nextMap: Record<string, string>;
  /** Handler keys for `auto` actions that wait for a domain event. */
  eventSubscriptions: { handlerKey: string; eventName: string; match?: Record<string, string>; stepKey: string; actionKey: string }[];
  /**
   * Time-based `auto` actions per step. The runtime schedules them when it enters the step and
   * cancels them when it leaves: the ledger key needs the step instance id, which only exists
   * then, so the compiler describes the trigger instead of emitting a scheduling effect.
   */
  autoTriggers: Record<string, AutoTrigger[]>;
  locks: string[];
}

export interface AutoTrigger {
  stepKey: string;
  actionKey: string;
  transitionKey: string;
  /** deadline | field_datetime | after_days (an `event` trigger is an outbox subscription). */
  when: string;
  fieldKey?: string;
  days?: number;
  settingKey?: string;
}

export interface CompileContext {
  isSystem?: boolean;
  departmentId?: string | null;
}

const ALWAYS_GUARDS = ["feature.actorAllowed", "feature.stepComplete"];
/** The branch key a join uses to mean "every branch still open in this group". */
export const GROUP_BRANCH = "$group";

/** 1. normalise: apply the schema defaults and derive what the code owns. */
export function normalise(def: unknown, ctx: CompileContext = {}): { def: FeatureDefinition; locks: string[] } {
  const parsed = FeatureDefinitionSchema.parse(def);
  return { def: parsed, locks: allLocks(parsed, ctx.isSystem ?? false) };
}

/** 2 + 3. flattenGroups and resolveNext live in tree.ts, which the validator shares. */
export { buildTree as flattenGroups } from "./tree";

/** 4. states: one per leaf, one compound state per parallel group, one per terminal. */
export function compileStates(def: FeatureDefinition, tree: Tree): WorkflowStateJson[] {
  const states: WorkflowStateJson[] = [];

  // a leaf inside a parallel group is a state OF ITS BRANCH, never of the record: the workflow
  // contract keeps the two lists disjoint, so the record's state stays a single answer
  tree.leaves
    .filter((leaf) => !leaf.groupKey)
    .forEach((leaf) => {
      states.push({
        key: leaf.step.key,
        label: leaf.step.label,
        category:
          leaf.index === 0 ? "initial" : leaf.step.stepType === "wait" ? "waiting" : "active",
      });
    });

  for (const parallel of tree.parallels) {
    const group = parallel.group;
    const branches: BranchSpec[] = branchesOf(group).map((branch) => {
      const leaves = branchLeaves(tree, group.key, branch.key);
      const done = branchDoneState(group.key, branch.key);
      const rejected = branchRejectedState(group.key, branch.key);
      return {
        key: branch.key,
        label: branch.label,
        initialState: leaves[0]?.step.key ?? done,
        states: [...leaves.map((l) => l.step.key), done, rejected],
        doneState: done,
        rejectedState: rejected,
      };
    });

    states.push({
      key: group.key,
      label: group.label,
      category: "waiting",
      compound: {
        branches,
        completion: group.completion,
        dynamic: group.branches.mode === "dynamic",
        onComplete: resolveTarget(tree, parallel, group.onComplete).state ?? group.onComplete,
        onReject: group.onAnyReject
          ? (resolveTarget(tree, parallel, group.onAnyReject).state ?? group.onAnyReject)
          : undefined,
      },
    });
  }

  for (const terminal of def.terminalStates)
    states.push({
      key: terminal.key,
      label: terminal.label,
      category: "terminal",
      terminalCategory: terminal.category,
    });

  return states;
}

function notifyEffect(rule: NotificationRule): EffectSpec {
  return { kind: "notify", args: { ...audienceArgs(rule.to), templateKey: rule.templateKey, category: rule.category, ackRequired: rule.ackRequired, declinable: rule.declinable, dedupe: rule.dedupe, actionUrlRule: "subject" } };
}

/** Turns an authored audience into the notify effect's recipient arguments. */
export function audienceArgs(to: AudienceRef): Record<string, unknown> {
  if (typeof to === "string") {
    if (to.startsWith("role:")) return { audienceSpec: { roles: [to.slice("role:".length)] } };
    return { recipientRule: `feature_${to}` };
  }
  if ("audienceSpec" in to) return { audienceSpec: to.audienceSpec };
  return { recipientRule: `feature_record_field:${to.recordField}` };
}

function enterEffect(def: FeatureDefinition, tree: Tree, target: string, leaf?: Leaf): EffectSpec[] {
  const entry = tree.stateIndex[target];
  if (entry?.kind === "parallel") return [{ kind: "enterParallel", args: { groupKey: target } }];
  if (entry?.kind === "step")
    return [
      {
        kind: "enterStep",
        args: { stepKey: target, ...(entry.groupKey ? { groupKey: entry.groupKey, branchKey: entry.branchKey } : {}) },
      },
    ];

  const terminal = def.terminalStates.find((t) => t.key === target);
  if (terminal) return terminalEffects(terminal);

  // a branch end: the engine takes the record on through $join / $reject
  if (target.endsWith(".$done") && leaf)
    return [{ kind: "completeBranch", args: { groupKey: leaf.groupKey, branchKey: leaf.branchKey } }];
  if (target.endsWith(".$rejected") && leaf)
    return [{ kind: "rejectBranch", args: { groupKey: leaf.groupKey, branchKey: leaf.branchKey } }];
  return [];
}

function terminalEffects(terminal: TerminalState): EffectSpec[] {
  return [
    { kind: "setTerminal", args: { stateKey: terminal.key, category: terminal.category } },
    ...terminal.notifications.map(notifyEffect),
    ...terminal.effects.map((key) => invoke(key)),
  ];
}

function invoke(adapterKey: string): EffectSpec {
  return { kind: "invokeHandler", args: { handler: adapterKey } };
}

function permissionKeyOf(def: FeatureDefinition, action: ActionDef): string {
  if (action.permission) return action.permission;
  const prefixes = Object.values(def.presets)
    .map((p) => p.permissionPrefix)
    .filter(Boolean) as string[];
  if (prefixes.length) return `${prefixes[0]}.${action.key}`;
  return `feature.${def.key}.act.${action.key}`;
}

/** 5 + 6. transitions, including the automatic ones and the synthetic branch joins. */
export function compileTransitions(
  def: FeatureDefinition,
  tree: Tree,
): { transitions: WorkflowTransitionJson[]; eventSubscriptions: CompiledFeature["eventSubscriptions"] } {
  const transitions: WorkflowTransitionJson[] = [];
  const eventSubscriptions: CompiledFeature["eventSubscriptions"] = [];

  for (const leaf of tree.leaves) {
    const group = leaf.groupKey
      ? tree.parallels.find((p) => p.group.key === leaf.groupKey)?.group
      : undefined;

    for (const action of leaf.step.actions) {
      const rejecting =
        group?.onAnyReject &&
        leaf.branchKey &&
        (action.kind === "reject" || action.kind === "request_revision");
      const resolved = rejecting
        ? branchRejectedState(leaf.groupKey!, leaf.branchKey!)
        : (resolveTarget(tree, leaf, action.to).state ?? action.to);

      transitions.push({
        key: `${leaf.step.key}.${action.key}`,
        from: leaf.step.key,
        to: resolved,
        action: action.key,
        ...(leaf.branchKey ? { branch: leaf.branchKey } : {}),
        system: action.kind === "auto",
        requiredPermission: permissionKeyOf(def, action),
        actorRules: action.actors,
        requiredComment: action.requiredComment,
        requiredFields: action.requiredFields,
        requiredAttachments: action.requiredAttachments,
        guards: [...ALWAYS_GUARDS, ...action.guards],
        effects: [
          { kind: "exitStep", args: { stepKey: leaf.step.key, actionKey: action.key, branchKey: leaf.branchKey } },
          ...leaf.step.notifications.onExit.map(notifyEffect),
          ...action.effects.map(invoke),
          ...enterEffect(def, tree, resolved, leaf),
        ],
      });

      if (action.auto?.when === "event")
        eventSubscriptions.push({
          handlerKey: `feature.autoOnEvent:${def.key}:${leaf.step.key}:${action.key}`,
          eventName: action.auto.eventName,
          match: action.auto.match,
          stepKey: leaf.step.key,
          actionKey: action.key,
        });
    }
  }

  for (const parallel of tree.parallels) {
    const group = parallel.group;
    const onComplete = resolveTarget(tree, parallel, group.onComplete).state ?? group.onComplete;
    transitions.push({
      key: `${group.key}.$join`,
      from: group.key,
      to: onComplete,
      action: "$join",
      system: true,
      actorRules: [],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: ["feature.parallelComplete"],
      // the group is over: whatever branch is still open is skipped before the record moves on
      effects: [
        { kind: "completeBranch", args: { groupKey: group.key, branchKey: GROUP_BRANCH } },
        ...enterEffect(def, tree, onComplete),
      ],
    });
    if (group.onAnyReject) {
      const onReject = resolveTarget(tree, parallel, group.onAnyReject).state ?? group.onAnyReject;
      transitions.push({
        key: `${group.key}.$reject`,
        from: group.key,
        to: onReject,
        action: "$reject",
        system: true,
        actorRules: [],
        requiredComment: false,
        requiredFields: [],
        requiredAttachments: [],
        guards: [],
        effects: enterEffect(def, tree, onReject),
      });
    }
  }

  return { transitions, eventSubscriptions };
}

/** 7. forms: the record header and one per step with inline questions. */
export function compileForms(def: FeatureDefinition, tree: Tree): Record<string, CompiledForm> {
  const forms: Record<string, CompiledForm> = {};
  if (def.record.fields.length)
    forms.record = {
      stepKey: "record",
      key: `${def.key}.record`,
      kind: "generic",
      title: `${def.name} — details`,
      fields: def.record.fields,
    };
  for (const leaf of tree.leaves) {
    const form = leaf.step.form;
    if (!form) continue;
    forms[leaf.step.key] = {
      stepKey: leaf.step.key,
      key: `${def.key}.${leaf.step.key}`,
      kind: "feature_step",
      title: form.sectionTitle,
      fields: form.questions,
      ...(form.formKey ? { reuseFormKey: form.formKey } : {}),
    };
  }
  return forms;
}

/** 8. one task template per leaf; task-backed features re-assign their own task instead. */
export function compileTaskTemplates(
  def: FeatureDefinition,
  tree: Tree,
): Record<string, TaskTemplate> {
  const taskBacked = def.record.backing.kind === "task";
  const out: Record<string, TaskTemplate> = {};
  for (const leaf of tree.leaves)
    out[leaf.step.key] = {
      stepKey: leaf.step.key,
      branchKey: leaf.branchKey,
      createTask: taskBacked ? false : leaf.step.workItem.createTask,
      kind: "feature_step",
      titleTemplate: "{{feature_name}}: {{step_label}} — {{record_title}}",
      assignee: leaf.step.assignee,
      priority: leaf.step.workItem.priority,
      expectedDeliverables: leaf.step.attachments.map((slot) => ({
        key: slot.slotKey,
        label: slot.label,
        required: slot.required,
      })),
      ...(leaf.step.deadline ? { deadline: leaf.step.deadline } : {}),
      ...(leaf.step.reminders ? { reminderScheduleKey: leaf.step.reminders.scheduleKey } : {}),
      contextRef: "feature_record",
    };
  return out;
}

/** 9. reminder templates for every step that has both a deadline and a schedule. */
export function compileReminderTemplates(tree: Tree): Record<string, ReminderTemplate> {
  const out: Record<string, ReminderTemplate> = {};
  for (const leaf of tree.leaves) {
    const { reminders, deadline } = leaf.step;
    if (!reminders || !deadline) continue;
    out[leaf.step.key] = {
      stepKey: leaf.step.key,
      scheduleKey: reminders.scheduleKey,
      audience: reminders.audience,
      ...(reminders.escalateToRole ? { escalateToRole: reminders.escalateToRole } : {}),
      deadline,
    };
  }
  return out;
}

/** 10. permissions, role rows and the RoleGrants the actor rules lean on. */
export function compilePermissions(
  def: FeatureDefinition,
  tree: Tree,
): { permissionKeys: string[]; rolePermissions: RolePermission[]; grantRequirements: GrantRequirement[] } {
  const keys = new Set<string>([
    `feature.${def.key}.view`,
    `feature.${def.key}.create`,
    `feature.${def.key}.manage`,
  ]);
  for (const leaf of tree.leaves)
    for (const action of leaf.step.actions) keys.add(permissionKeyOf(def, action));

  const permissionKeys = Array.from(keys).sort();
  const rolePermissions: RolePermission[] = [];
  for (const [roleKey, level] of Object.entries(def.permissions.defaults)) {
    if (!level || level === "none") continue;
    for (const permissionKey of permissionKeys)
      rolePermissions.push({ roleKey, permissionKey, level });
  }

  const grantRequirements: GrantRequirement[] = [];
  const GRANTS: Record<string, { roleKey: string; scopeType: string }> = {
    parent_chair: { roleKey: "committee_chair", scopeType: "committee" },
    parent_member: { roleKey: "committee_member", scopeType: "committee" },
    section_rep: { roleKey: "student_rep", scopeType: "section" },
    teaching_staff_of_parent: { roleKey: "instructor", scopeType: "section_offering" },
  };
  const requireGrant = (stepKey: string, actionKey: string | undefined, rel: string) => {
    const grant = GRANTS[rel];
    if (!grant) return;
    grantRequirements.push({ stepKey, actionKey, ...grant, derivedFrom: rel });
  };
  for (const leaf of tree.leaves) {
    if (leaf.step.assignee.type === "relationship")
      requireGrant(leaf.step.key, undefined, leaf.step.assignee.rel);
    for (const action of leaf.step.actions)
      for (const rule of action.actors) {
        if (rule.type === "relationship") requireGrant(leaf.step.key, action.key, rule.rel);
        if (rule.type === "role" && rule.scope === "parent")
          grantRequirements.push({
            stepKey: leaf.step.key,
            actionKey: action.key,
            roleKey: rule.roles.join("|"),
            scopeType: "parent",
            derivedFrom: "role@parent",
          });
      }
  }

  return { permissionKeys, rolePermissions, grantRequirements };
}

/** 11. the report definition, when the feature declares one. */
export function compileReport(def: FeatureDefinition): CompiledReport | undefined {
  if (!def.report) return undefined;
  const built = ["records", "records_with_answers"].includes(def.report.dataSource);
  return {
    key: `feature.${def.key}.${def.report.key}`,
    title: def.report.title,
    templateKey: def.report.templateKey,
    formats: def.report.formats,
    dataSourceKey: built ? `feature.${def.report.dataSource}` : def.report.dataSource,
    parameters: def.report.parameters,
    ...(def.report.requiredPermission ? { requiredPermission: def.report.requiredPermission } : {}),
  };
}

/** 6. the time-based automatic actions, per step. */
export function compileAutoTriggers(tree: Tree): Record<string, AutoTrigger[]> {
  const out: Record<string, AutoTrigger[]> = {};
  for (const leaf of tree.leaves) {
    const triggers = leaf.step.actions
      .filter((action) => action.auto && action.auto.when !== "event")
      .map((action) => {
        const auto = action.auto!;
        return {
          stepKey: leaf.step.key,
          actionKey: action.key,
          transitionKey: `${leaf.step.key}.${action.key}`,
          when: auto.when,
          ...("fieldKey" in auto ? { fieldKey: auto.fieldKey } : {}),
          ...("days" in auto ? { days: auto.days } : {}),
          ...("settingKey" in auto ? { settingKey: auto.settingKey } : {}),
        };
      });
    if (triggers.length) out[leaf.step.key] = triggers;
  }
  return out;
}

/** The whole pipeline. 12. navigation, list views and counters stay in the json. */
export function compile(input: unknown, ctx: CompileContext = {}): CompiledFeature {
  const { def, locks } = normalise(input, ctx);
  const tree = buildTree(def);
  const states = compileStates(def, tree);
  const { transitions, eventSubscriptions } = compileTransitions(def, tree);
  const { permissionKeys, rolePermissions, grantRequirements } = compilePermissions(def, tree);

  const workflow: WorkflowDefinitionInput = {
    key: `feature:${def.key}`,
    subjectType: "feature_record",
    initialState: tree.leaves[0]?.step.key ?? def.terminalStates[0]!.key,
    states,
    transitions,
    lockedPaths: [],
    isSystem: ctx.isSystem ?? false,
    departmentId: ctx.departmentId ?? null,
    featureVersionId: null,
  };

  return {
    workflow,
    forms: compileForms(def, tree),
    taskTemplates: compileTaskTemplates(def, tree),
    reminderTemplates: compileReminderTemplates(tree),
    permissionKeys,
    rolePermissions,
    grantRequirements,
    report: compileReport(def),
    stateIndex: tree.stateIndex,
    nextMap: tree.nextMap,
    eventSubscriptions,
    autoTriggers: compileAutoTriggers(tree),
    locks,
  };
}

/** Automatic actions of a step, with the trigger the runtime schedules them from. */
export function autoActions(step: StepDef): ActionDef[] {
  return step.actions.filter((a) => a.kind === "auto" && a.auto);
}

/** The parallel group a step belongs to, if any. */
export function groupOf(tree: Tree, stepKey: string): ParallelGroup | undefined {
  const leaf = tree.byKey[stepKey];
  if (!leaf?.groupKey) return undefined;
  return tree.parallels.find((p) => p.group.key === leaf.groupKey)?.group;
}
