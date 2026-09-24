import type { FieldDef } from "../forms/field-schema";
import { allLocks, lockedPathsChanged, type Pointer } from "./locks";
import {
  branchesOf,
  isGroup,
  isParallel,
  isStep,
  KEY,
  type ActionDef,
  type FeatureDefinition,
  type ScopeLevel,
  type StepNode,
} from "./schema";
import {
  branchDoneState,
  branchLeaves,
  branchRejectedState,
  buildTree,
  resolveTarget,
  type Tree,
} from "./tree";

// The rule list of design part 03 §4 and nothing else: every issue an administrator can see in
// the wizard is one of these codes, one of them per fixture in tests/unit/feature/validate.test.ts.
// Rules that need the world around the definition (adapters, templates, roles, published forms)
// only run when the caller passes that part of the context, so the wizard can validate a draft
// offline and publish can validate it completely.

export type IssueCode =
  | "KEY_FORMAT"
  | "KEY_UNIQUE"
  | "INITIAL_IS_STEP"
  | "TO_RESOLVES"
  | "NEXT_UNRESOLVED"
  | "REACHABLE"
  | "TERMINAL_EXISTS"
  | "DEAD_END"
  | "ACTOR_PRESENT"
  | "ASSIGNEE_RESOLVABLE"
  | "GRANT_SOURCE"
  | "PARALLEL_BRANCHES"
  | "PARALLEL_EXIT"
  | "REVISION_LOOP"
  | "REQUIRED_FIELDS"
  | "REQUIRED_ATTACHMENTS"
  | "FORM_REF"
  | "BINDING_ARGS"
  | "TEMPLATE_EXISTS"
  | "SCHEDULE_EXISTS"
  | "DEADLINE_FIELD"
  | "ROLE_EXISTS"
  | "PARENT_TYPE"
  | "SCOPE_CONSISTENT"
  | "ADAPTER_EXISTS"
  | "SURFACE_EXISTS"
  | "PRESET_CONSISTENT"
  | "LIST_COLUMNS"
  | "LOCK_VIOLATION"
  | "BACKING_LOCKED"
  | "WARN_NO_DEADLINE"
  | "WARN_NO_NOTIFY";

export interface Issue {
  code: IssueCode;
  /** RFC 6901 pointer at the offending node, so the wizard can deep-link to its screen. */
  path: string;
  severity: "error" | "warning";
  message: string;
}

export interface PublishedFeature {
  key: string;
  presets?: string[];
  scopeLevel?: ScopeLevel;
  /** The feature this one nests under, for the ancestor cycle check. */
  parentFeatureKey?: string | null;
}

export interface ValidationContext {
  isSystem?: boolean;
  /** Keys already used by another definition of the same scope. */
  takenKeys?: string[];
  publishedFeatures?: PublishedFeature[];
  /** Keys of published FormDefinitions. */
  publishedForms?: string[];
  templateKeys?: string[];
  scheduleKeys?: string[];
  /** Role keys that exist as rows (plus the derived ones). */
  roleKeys?: string[];
  /** Adapter key -> hook, from the AdapterRegistry. */
  adapters?: Record<string, string>;
  /** Feature key -> step renderer keys registered by a module surface. */
  surfaces?: Record<string, string[]>;
  /** Subject types the SubjectRegistry knows. */
  subjectTypes?: string[];
  /** The previously published version, for the lock comparison. */
  previous?: { json: unknown; locks?: Pointer[] };
}

const BUILT_IN_COLUMNS = new Set([
  "number",
  "title",
  "state",
  "assignee",
  "owner",
  "deadline",
  "parent",
  "createdAt",
  "preset",
  "updatedAt",
]);

const RELATIONSHIPS_NEEDING_PARENT = new Set([
  "parent_owner",
  "parent_chair",
  "parent_member",
  "teaching_staff_of_parent",
]);

/** Which RoleGrant a relationship rule leans on, and which parents can produce it. */
const GRANT_SOURCES: Record<string, { roleKey: string; scopeType: string; parents: string[] }> = {
  parent_chair: { roleKey: "committee_chair", scopeType: "committee", parents: ["committee", "group"] },
  parent_member: {
    roleKey: "committee_member",
    scopeType: "committee",
    parents: ["committee", "group"],
  },
  section_rep: { roleKey: "student_rep", scopeType: "section", parents: ["section", "section_offering"] },
  teaching_staff_of_parent: {
    roleKey: "instructor",
    scopeType: "section_offering",
    parents: ["section_offering", "course_offering", "course"],
  },
};

const SCOPE_ORDER: Record<ScopeLevel, number> = { faculty: 0, department: 1, program: 2, section: 3 };

const BINDINGS_NEEDING_PARENT = new Set([
  "members_of_parent",
  "tasks_in_context",
  "participants_of_parent",
]);

const PERSON_FIELD_TYPES = new Set(["person_picker", "group_picker"]);
const DATE_FIELD_TYPES = new Set(["date", "datetime", "term_picker"]);
const SCOPE_FIELD_TYPES = new Set(["program_picker", "section_picker"]);

export function validateDefinition(
  def: FeatureDefinition,
  ctx: ValidationContext = {},
): Issue[] {
  const issues: Issue[] = [];
  const add = (
    code: IssueCode,
    path: string,
    message: string,
    severity: "error" | "warning" = "error",
  ) => issues.push({ code, path, severity, message });

  const tree = buildTree(def);

  keyFormat(def, tree, add);
  keyUnique(def, tree, ctx, add);
  initialIsStep(def, add);
  targetsResolve(def, tree, add);
  reachable(def, tree, add);
  terminalExists(def, add);
  deadEnds(def, tree, add);
  actorsPresent(def, tree, add);
  assigneesResolvable(def, tree, add);
  grantSources(def, tree, add);
  parallelRules(def, tree, add);
  revisionLoops(def, tree, add);
  requiredReferences(def, tree, add);
  formRefs(def, tree, ctx, add);
  bindingArgs(def, tree, ctx, add);
  templatesAndSchedules(def, tree, ctx, add);
  deadlineFields(def, tree, add);
  rolesExist(def, tree, ctx, add);
  parentType(def, ctx, add);
  scopeConsistent(def, ctx, add);
  adaptersExist(def, tree, ctx, add);
  surfacesExist(def, tree, ctx, add);
  presetsConsistent(def, tree, add);
  listColumns(def, tree, add);
  locks(def, ctx, add);
  warnings(def, tree, add);

  return issues;
}

type Add = (code: IssueCode, path: string, message: string, severity?: "error" | "warning") => void;

// ---- keys ---------------------------------------------------------------------------------

function everyField(fields: FieldDef[] | undefined, base: string): { field: FieldDef; path: string }[] {
  const out: { field: FieldDef; path: string }[] = [];
  (fields ?? []).forEach((field, i) => {
    out.push({ field, path: `${base}/${i}` });
    out.push(...everyField(field.fields, `${base}/${i}/fields`));
  });
  return out;
}

function keyFormat(def: FeatureDefinition, tree: Tree, add: Add): void {
  const check = (value: string, path: string, what: string) => {
    if (!KEY.test(value)) add("KEY_FORMAT", path, `${what} "${value}" is not a lower_snake_case key`);
  };
  check(def.key, "/key", "The feature key");
  // the aggregate constrains step, action, terminal, view and preset keys; field keys come from
  // the form contract, which allows longer and looser keys than a state name may be
  for (const { field, path } of everyField(def.record.fields, "/record/fields"))
    check(field.key, path, "The record field");
  for (const leaf of tree.leaves)
    for (const { field, path } of everyField(leaf.step.form?.questions, `${leaf.path}/form/questions`))
      check(field.key, path, "The question");
}

function keyUnique(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  if (ctx.takenKeys?.includes(def.key))
    add("KEY_UNIQUE", "/key", `Another feature already uses the key "${def.key}"`);

  const seen = new Map<string, string>();
  const claim = (key: string, path: string, what: string) => {
    const first = seen.get(key);
    if (first) add("KEY_UNIQUE", path, `${what} "${key}" is already used at ${first}`);
    else seen.set(key, path);
  };

  const walk = (nodes: StepNode[], base: string) => {
    nodes.forEach((node, i) => {
      const at = `${base}/${i}`;
      claim(node.key, at, node.kind === "step" ? "The step key" : "The group key");
      if (isGroup(node)) walk(node.steps, `${at}/steps`);
      if (isParallel(node)) {
        if (node.branches.mode === "static")
          node.branches.items.forEach((branch, b) => walk(branch.steps, `${at}/branches/items/${b}/steps`));
        else walk(node.branches.branch.steps, `${at}/branches/branch/steps`);
      }
    });
  };
  walk(def.steps, "/steps");

  def.terminalStates.forEach((terminal, i) =>
    claim(terminal.key, `/terminalStates/${i}`, "The terminal key"),
  );

  for (const leaf of tree.leaves) {
    const actions = new Set<string>();
    leaf.step.actions.forEach((action, a) => {
      if (actions.has(action.key))
        add("KEY_UNIQUE", `${leaf.path}/actions/${a}`, `Step "${leaf.step.key}" has two actions "${action.key}"`);
      actions.add(action.key);
    });
    duplicateFieldKeys(leaf.step.form?.questions, `${leaf.path}/form/questions`, add);
  }
  duplicateFieldKeys(def.record.fields, "/record/fields", add);

  const views = new Set<string>();
  def.listViews.forEach((view, i) => {
    if (views.has(view.key)) add("KEY_UNIQUE", `/listViews/${i}`, `Two list views use "${view.key}"`);
    views.add(view.key);
  });
  const counters = new Set<string>();
  def.dashboardCounters.forEach((counter, i) => {
    if (counters.has(counter.key))
      add("KEY_UNIQUE", `/dashboardCounters/${i}`, `Two counters use "${counter.key}"`);
    counters.add(counter.key);
  });
}

function duplicateFieldKeys(fields: FieldDef[] | undefined, base: string, add: Add): void {
  const seen = new Set<string>();
  (fields ?? []).forEach((field, i) => {
    if (seen.has(field.key))
      add("KEY_UNIQUE", `${base}/${i}`, `Two questions use the key "${field.key}"`);
    seen.add(field.key);
    duplicateFieldKeys(field.fields, `${base}/${i}/fields`, add);
  });
}

// ---- graph --------------------------------------------------------------------------------

function initialIsStep(def: FeatureDefinition, add: Add): void {
  const first = def.steps[0];
  if (first && !isStep(first))
    add(
      "INITIAL_IS_STEP",
      "/steps/0",
      "The first node must be a step: a record enters its lifecycle in one place, not in a parallel group",
    );
}

function targetsResolve(def: FeatureDefinition, tree: Tree, add: Add): void {
  for (const leaf of tree.leaves)
    leaf.step.actions.forEach((action, a) => {
      const path = `${leaf.path}/actions/${a}`;
      const resolution = resolveTarget(tree, leaf, action.to);
      if (resolution.state) return;
      if (resolution.reason === "next_unresolved")
        add(
          "NEXT_UNRESOLVED",
          path,
          `"$next" has nothing to point at: "${leaf.step.key}" is the last step, so name a terminal state`,
        );
      else add("TO_RESOLVES", path, `Action "${action.key}" points at the unknown state "${action.to}"`);
    });

  for (const parallel of tree.parallels) {
    const { group, path } = parallel;
    for (const [field, value] of [
      ["onComplete", group.onComplete],
      ["onAnyReject", group.onAnyReject],
    ] as const) {
      if (!value) continue;
      const resolution = resolveTarget(tree, parallel, value);
      if (resolution.state) continue;
      if (resolution.reason === "next_unresolved")
        add("NEXT_UNRESOLVED", `${path}/${field}`, `"$next" has nothing to point at after "${group.key}"`);
      else add("TO_RESOLVES", `${path}/${field}`, `"${field}" points at the unknown state "${value}"`);
    }
  }
}

/** Edges of the compiled graph, used for reachability. */
function edges(def: FeatureDefinition, tree: Tree): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const link = (from: string, to: string | null) => {
    if (!to) return;
    out.set(from, [...(out.get(from) ?? []), to]);
  };

  for (const leaf of tree.leaves) {
    const from = leaf.step.key;
    for (const action of leaf.step.actions) link(from, resolveTarget(tree, leaf, action.to).state);
  }
  for (const parallel of tree.parallels) {
    const { group } = parallel;
    for (const branch of branchesOf(group)) {
      const first = branchLeaves(tree, group.key, branch.key)[0];
      if (first) link(group.key, first.step.key);
      // the synthetic join and reject transitions
      link(branchDoneState(group.key, branch.key), resolveTarget(tree, parallel, group.onComplete).state);
      if (group.onAnyReject)
        link(
          branchRejectedState(group.key, branch.key),
          resolveTarget(tree, parallel, group.onAnyReject).state,
        );
    }
  }
  return out;
}

function reachable(def: FeatureDefinition, tree: Tree, add: Add): void {
  const first = tree.leaves[0];
  if (!first) return;
  const graph = edges(def, tree);
  const seen = new Set<string>([first.step.key]);
  const queue = [first.step.key];
  while (queue.length) {
    const state = queue.shift()!;
    for (const next of graph.get(state) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  for (const leaf of tree.leaves)
    if (!seen.has(leaf.step.key))
      add("REACHABLE", leaf.path, `Nothing leads to the step "${leaf.step.key}"`);
  for (const parallel of tree.parallels)
    if (!seen.has(parallel.group.key))
      add("REACHABLE", parallel.path, `Nothing leads to the parallel group "${parallel.group.key}"`);
  def.terminalStates.forEach((terminal, i) => {
    if (!seen.has(terminal.key))
      add("REACHABLE", `/terminalStates/${i}`, `Nothing leads to the terminal state "${terminal.key}"`);
  });
}

function terminalExists(def: FeatureDefinition, add: Add): void {
  if (!def.terminalStates.some((t) => t.category === "success"))
    add(
      "TERMINAL_EXISTS",
      "/terminalStates",
      "A feature needs at least one terminal state with the category success",
    );
}

function deadEnds(def: FeatureDefinition, tree: Tree, add: Add): void {
  for (const leaf of tree.leaves) {
    const leaving = leaf.step.actions.filter((action) => {
      const target = resolveTarget(tree, leaf, action.to).state;
      return target && target !== leaf.step.key;
    });
    if (leaving.length) continue;
    const auto = leaf.step.actions.some((a) => a.kind === "auto");
    add(
      "DEAD_END",
      leaf.path,
      auto
        ? `Only an automatic action leaves "${leaf.step.key}"; a person cannot move the record on`
        : `No action leaves the step "${leaf.step.key}"`,
      auto ? "warning" : "error",
    );
  }
}

// ---- actors and assignees --------------------------------------------------------------------

function actorsPresent(def: FeatureDefinition, tree: Tree, add: Add): void {
  for (const leaf of tree.leaves)
    leaf.step.actions.forEach((action, a) => {
      const path = `${leaf.path}/actions/${a}`;
      if (!action.actors.length) add("ACTOR_PRESENT", path, `Action "${action.key}" has no actor rule`);
      const system = action.actors.some((rule) => rule.type === "system");
      if (system && action.kind !== "auto")
        add("ACTOR_PRESENT", path, `Only an automatic action may be performed by the system`);
      if (action.kind === "auto" && !action.auto)
        add("ACTOR_PRESENT", path, `The automatic action "${action.key}" does not say when it fires`);
      if (action.auto?.when === "after_days" && !action.auto.days && !action.auto.settingKey)
        add("ACTOR_PRESENT", path, `"after_days" needs either days or a setting key`);
    });
}

function assigneesResolvable(def: FeatureDefinition, tree: Tree, add: Add): void {
  const fieldByKey = new Map(def.record.fields.map((f) => [f.key, f]));
  const check = (rule: { type: string; fieldKey?: string; rel?: string }, path: string, what: string) => {
    if (rule.type === "record_field") {
      const field = rule.fieldKey ? fieldByKey.get(rule.fieldKey) : undefined;
      if (!field)
        add("ASSIGNEE_RESOLVABLE", path, `${what} names the record field "${rule.fieldKey}", which does not exist`);
      else if (!PERSON_FIELD_TYPES.has(field.type))
        add(
          "ASSIGNEE_RESOLVABLE",
          path,
          `${what} names "${field.key}", which is a ${field.type} and cannot hold a person`,
        );
    }
    if (rule.type === "relationship" && rule.rel && RELATIONSHIPS_NEEDING_PARENT.has(rule.rel) && !def.parentSubject)
      add(
        "ASSIGNEE_RESOLVABLE",
        path,
        `${what} resolves through the parent ("${rule.rel}"), but this feature has no parent subject`,
      );
  };

  check(def.record.ownerRule, "/record/ownerRule", "The owner rule");
  def.record.canCreate.forEach((rule, i) => check(rule, `/record/canCreate/${i}`, "A create rule"));
  for (const leaf of tree.leaves) {
    check(leaf.step.assignee, `${leaf.path}/assignee`, `The assignee of "${leaf.step.key}"`);
    leaf.step.actions.forEach((action, a) =>
      action.actors.forEach((rule, r) =>
        check(rule, `${leaf.path}/actions/${a}/actors/${r}`, `An actor of "${action.key}"`),
      ),
    );
  }
  for (const parallel of tree.parallels)
    if (parallel.group.branches.mode === "dynamic")
      check(
        parallel.group.branches.perPerson,
        `${parallel.path}/branches/perPerson`,
        `The person source of "${parallel.group.key}"`,
      );
}

function grantSources(def: FeatureDefinition, tree: Tree, add: Add): void {
  const parent = def.parentSubject?.subjectType;
  const types = [parent, ...(def.parentSubject?.allowedTypes ?? [])].filter(Boolean) as string[];
  const check = (rule: { type: string; rel?: string }, path: string) => {
    if (rule.type !== "relationship" || !rule.rel) return;
    const grant = GRANT_SOURCES[rule.rel];
    if (!grant) return;
    if (!types.length || types.some((t) => grant.parents.includes(t))) return;
    add(
      "GRANT_SOURCE",
      path,
      `"${rule.rel}" needs a ${grant.roleKey} grant on a ${grant.parents.join(" or ")}, but the parent is a ${types.join(" or ")}`,
    );
  };
  for (const leaf of tree.leaves) {
    check(leaf.step.assignee, `${leaf.path}/assignee`);
    leaf.step.actions.forEach((action, a) =>
      action.actors.forEach((rule, r) => check(rule, `${leaf.path}/actions/${a}/actors/${r}`)),
    );
  }
}

/** The RoleGrants the compiled feature relies on; also reported by simulate. */
export function grantRequirements(
  def: FeatureDefinition,
): { stepKey: string; actionKey?: string; roleKey: string; scopeType: string; derivedFrom: string }[] {
  const tree = buildTree(def);
  const out: { stepKey: string; actionKey?: string; roleKey: string; scopeType: string; derivedFrom: string }[] = [];
  const push = (stepKey: string, actionKey: string | undefined, rel: string) => {
    const grant = GRANT_SOURCES[rel];
    if (!grant) return;
    out.push({ stepKey, actionKey, roleKey: grant.roleKey, scopeType: grant.scopeType, derivedFrom: rel });
  };
  for (const leaf of tree.leaves) {
    if (leaf.step.assignee.type === "relationship") push(leaf.step.key, undefined, leaf.step.assignee.rel);
    for (const action of leaf.step.actions)
      for (const rule of action.actors)
        if (rule.type === "relationship") push(leaf.step.key, action.key, rule.rel);
        else if (rule.type === "role" && rule.scope === "parent")
          out.push({
            stepKey: leaf.step.key,
            actionKey: action.key,
            roleKey: rule.roles.join("|"),
            scopeType: "parent",
            derivedFrom: "role@parent",
          });
  }
  return out;
}

// ---- parallel groups ---------------------------------------------------------------------

function parallelRules(def: FeatureDefinition, tree: Tree, add: Add): void {
  for (const parallel of tree.parallels) {
    const { group, path } = parallel;
    const branches = branchesOf(group);

    if (group.branches.mode === "static") {
      if (branches.length < 2)
        add("PARALLEL_BRANCHES", path, `"${group.key}" needs at least two branches to run in parallel`);
      branches.forEach((branch, b) => {
        if (!branch.steps.length)
          add("PARALLEL_BRANCHES", `${path}/branches/items/${b}`, `Branch "${branch.key}" has no steps`);
      });
      if (group.completion.rule === "quorum" && group.completion.n > branches.length)
        add(
          "PARALLEL_BRANCHES",
          `${path}/completion`,
          `A quorum of ${group.completion.n} can never be reached with ${branches.length} branches`,
        );
    } else if (group.completion.rule === "quorum") {
      add(
        "PARALLEL_BRANCHES",
        `${path}/completion`,
        `A quorum of ${group.completion.n} is only checked at run time: a dynamic group may resolve fewer people`,
        "warning",
      );
    }

    for (const branch of branches) {
      const nested = branch.steps.filter(isParallel);
      for (const inner of nested)
        add(
          "PARALLEL_BRANCHES",
          path,
          `Branch "${branch.key}" contains the parallel group "${inner.key}"; parallel groups cannot be nested`,
        );

      const leaves = branchLeaves(tree, group.key, branch.key);
      const inBranch = new Set(leaves.map((l) => l.step.key));
      const done = branchDoneState(group.key, branch.key);
      const rejected = branchRejectedState(group.key, branch.key);
      let reachesDone = false;

      for (const leaf of leaves)
        leaf.step.actions.forEach((action, a) => {
          const target = resolveTarget(tree, leaf, action.to).state;
          if (!target) return;
          if (target === done) reachesDone = true;
          if (inBranch.has(target) || target === done || target === rejected) return;
          if (isRejection(action) && group.onAnyReject) {
            reachesDone = reachesDone || false;
            return;
          }
          add(
            "PARALLEL_EXIT",
            `${leaf.path}/actions/${a}`,
            `"${action.key}" leaves the branch for "${action.to}"; only a rejection may leave a branch, through onAnyReject`,
          );
        });

      if (!reachesDone)
        add(
          "PARALLEL_EXIT",
          path,
          `Branch "${branch.key}" never finishes: its last step needs an action with "$next" so the branch can join`,
        );
    }
  }
}

function isRejection(action: ActionDef): boolean {
  return action.kind === "reject" || action.kind === "request_revision";
}

function revisionLoops(def: FeatureDefinition, tree: Tree, add: Add): void {
  const order = new Map(tree.leaves.map((leaf, i) => [leaf.step.key, i]));
  for (const leaf of tree.leaves)
    leaf.step.actions.forEach((action, a) => {
      if (action.kind !== "request_revision") return;
      const target = resolveTarget(tree, leaf, action.to).state;
      if (!target) return;
      const targetLeaf = tree.byKey[target];
      if (!targetLeaf) {
        add(
          "REVISION_LOOP",
          `${leaf.path}/actions/${a}`,
          `"${action.key}" asks for a revision but points at "${action.to}", which is not a step`,
        );
        return;
      }
      const earlier = (order.get(target) ?? 0) < (order.get(leaf.step.key) ?? 0);
      if (!earlier && targetLeaf.step.stepType !== "form")
        add(
          "REVISION_LOOP",
          `${leaf.path}/actions/${a}`,
          `"${action.key}" sends the record forward to "${target}"; a revision goes back to a step someone can edit`,
        );
    });
}

// ---- forms, attachments, bindings ----------------------------------------------------------

function requiredReferences(def: FeatureDefinition, tree: Tree, add: Add): void {
  const recordFields = new Set(def.record.fields.map((f) => f.key));
  for (const leaf of tree.leaves) {
    const questions = new Set(
      everyField(leaf.step.form?.questions, "").map(({ field }) => field.key),
    );
    const slots = new Set(leaf.step.attachments.map((s) => s.slotKey));
    leaf.step.actions.forEach((action, a) => {
      const path = `${leaf.path}/actions/${a}`;
      for (const field of action.requiredFields)
        if (!questions.has(field) && !recordFields.has(field))
          add(
            "REQUIRED_FIELDS",
            path,
            `"${action.key}" requires the answer "${field}", which is neither a question of "${leaf.step.key}" nor a record field`,
          );
      for (const slot of action.requiredAttachments)
        if (!slots.has(slot))
          add(
            "REQUIRED_ATTACHMENTS",
            path,
            `"${action.key}" requires the attachment "${slot}", which "${leaf.step.key}" does not ask for`,
          );
    });
  }
}

function formRefs(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  const checkFields = (fields: FieldDef[] | undefined, base: string) => {
    for (const { field, path } of everyField(fields, base)) {
      if (field.type === "repeating_group" && !field.fields?.length)
        add("FORM_REF", path, `The repeating group "${field.key}" has no questions inside it`);
      if (field.computedBy && ctx.adapters && !ctx.adapters[field.computedBy])
        add("ADAPTER_EXISTS", `${path}/computedBy`, `No adapter "${field.computedBy}" is registered`);
    }
  };
  checkFields(def.record.fields, "/record/fields");
  for (const leaf of tree.leaves) {
    const form = leaf.step.form;
    if (!form) continue;
    if (form.formKey && ctx.publishedForms && !ctx.publishedForms.includes(form.formKey))
      add("FORM_REF", `${leaf.path}/form/formKey`, `No published form "${form.formKey}" exists`);
    if (form.formKey && form.questions.length)
      add(
        "FORM_REF",
        `${leaf.path}/form`,
        `"${leaf.step.key}" both reuses the form "${form.formKey}" and defines questions; pick one`,
      );
    checkFields(form.questions, `${leaf.path}/form/questions`);
  }
}

function bindingArgs(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  const published = new Map((ctx.publishedFeatures ?? []).map((f) => [f.key, f]));
  const check = (fields: FieldDef[] | undefined, base: string) => {
    for (const { field, path } of everyField(fields, base)) {
      const binding = field.sourceBinding ?? "none";
      if (BINDINGS_NEEDING_PARENT.has(binding) && !def.parentSubject)
        add(
          "BINDING_ARGS",
          `${path}/sourceBinding`,
          `"${binding}" reads the parent of the record, but this feature has no parent subject`,
        );
      const wanted =
        binding === "records_of_feature"
          ? (field.bindingArgs?.featureKey as string | undefined)
          : field.recordPicker?.featureKey;
      if (!wanted) continue;
      if (!ctx.publishedFeatures) continue;
      const target = published.get(wanted);
      if (!target) {
        add("BINDING_ARGS", path, `"${field.key}" offers records of "${wanted}", which is not published`);
        continue;
      }
      const preset = field.recordPicker?.presetKey;
      if (preset && target.presets && !target.presets.includes(preset))
        add("BINDING_ARGS", path, `"${wanted}" has no preset "${preset}"`);
    }
  };
  check(def.record.fields, "/record/fields");
  for (const leaf of tree.leaves) check(leaf.step.form?.questions, `${leaf.path}/form/questions`);
}

function templatesAndSchedules(
  def: FeatureDefinition,
  tree: Tree,
  ctx: ValidationContext,
  add: Add,
): void {
  const template = (key: string, path: string) => {
    if (ctx.templateKeys && !ctx.templateKeys.includes(key))
      add("TEMPLATE_EXISTS", path, `No template "${key}" exists`);
  };
  for (const leaf of tree.leaves) {
    leaf.step.notifications.onEnter.forEach((rule, i) =>
      template(rule.templateKey, `${leaf.path}/notifications/onEnter/${i}`),
    );
    leaf.step.notifications.onExit.forEach((rule, i) =>
      template(rule.templateKey, `${leaf.path}/notifications/onExit/${i}`),
    );
    if (leaf.step.reminders && ctx.scheduleKeys && !ctx.scheduleKeys.includes(leaf.step.reminders.scheduleKey))
      add(
        "SCHEDULE_EXISTS",
        `${leaf.path}/reminders/scheduleKey`,
        `No reminder schedule "${leaf.step.reminders.scheduleKey}" exists`,
      );
  }
  def.terminalStates.forEach((terminal, i) =>
    terminal.notifications.forEach((rule, n) =>
      template(rule.templateKey, `/terminalStates/${i}/notifications/${n}`),
    ),
  );
  if (def.report) template(def.report.templateKey, "/report/templateKey");
}

function deadlineFields(def: FeatureDefinition, tree: Tree, add: Add): void {
  const fieldByKey = new Map(def.record.fields.map((f) => [f.key, f]));
  const dateField = (key: string | undefined, path: string, what: string) => {
    const field = key ? fieldByKey.get(key) : undefined;
    if (!field) {
      add("DEADLINE_FIELD", path, `${what} names the record field "${key}", which does not exist`);
      return;
    }
    if (!DATE_FIELD_TYPES.has(field.type))
      add("DEADLINE_FIELD", path, `${what} names "${field.key}", which is a ${field.type} and holds no date`);
  };

  for (const leaf of tree.leaves) {
    const deadline = leaf.step.deadline;
    if (deadline?.rule === "relative" && deadline.from === "record_field")
      dateField(deadline.fieldKey, `${leaf.path}/deadline`, "The deadline of this step");
    if (deadline?.rule === "calendar" && deadline.termFrom === "record_field")
      dateField(deadline.fieldKey, `${leaf.path}/deadline`, "The term of this deadline");
    leaf.step.actions.forEach((action, a) => {
      if (action.auto?.when === "field_datetime")
        dateField(action.auto.fieldKey, `${leaf.path}/actions/${a}/auto`, `The trigger of "${action.key}"`);
    });
  }
}

// ---- roles, parents, scope ------------------------------------------------------------------

function rolesExist(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  const known = ctx.roleKeys;
  const check = (roles: string[], path: string) => {
    if (!known) return;
    for (const role of roles)
      if (!known.includes(role)) add("ROLE_EXISTS", path, `No role "${role}" exists`);
  };
  check(def.navigation.visibleRoles, "/navigation/visibleRoles");
  check(Object.keys(def.permissions.defaults), "/permissions/defaults");
  def.dashboardCounters.forEach((counter, i) => check(counter.roles, `/dashboardCounters/${i}/roles`));
  for (const leaf of tree.leaves) {
    if (leaf.step.assignee.type === "role") check(leaf.step.assignee.roles, `${leaf.path}/assignee/roles`);
    leaf.step.actions.forEach((action, a) =>
      action.actors.forEach((rule, r) => {
        if (rule.type === "role") check(rule.roles, `${leaf.path}/actions/${a}/actors/${r}/roles`);
      }),
    );
  }
}

function parentType(def: FeatureDefinition, ctx: ValidationContext, add: Add): void {
  const parent = def.parentSubject;
  if (!parent) return;
  const types = [parent.subjectType, ...(parent.allowedTypes ?? [])];
  if (ctx.subjectTypes)
    for (const type of types)
      if (!ctx.subjectTypes.includes(type))
        add("PARENT_TYPE", "/parentSubject", `The subject type "${type}" is not registered`);

  if (parent.subjectType === "feature_record") {
    if (!parent.featureKey) {
      add("PARENT_TYPE", "/parentSubject", "A feature_record parent must name the feature it nests under");
      return;
    }
    if (parent.featureKey === def.key) {
      add("PARENT_TYPE", "/parentSubject/featureKey", "A feature cannot be its own parent");
      return;
    }
    const published = ctx.publishedFeatures;
    if (!published) return;
    const byKey = new Map(published.map((f) => [f.key, f]));
    if (!byKey.has(parent.featureKey)) {
      add("PARENT_TYPE", "/parentSubject/featureKey", `No published feature "${parent.featureKey}" exists`);
      return;
    }
    const seen = new Set<string>([def.key]);
    let cursor = byKey.get(parent.featureKey);
    while (cursor) {
      if (seen.has(cursor.key)) {
        add("PARENT_TYPE", "/parentSubject/featureKey", `"${def.key}" would become its own ancestor`);
        return;
      }
      seen.add(cursor.key);
      cursor = cursor.parentFeatureKey ? byKey.get(cursor.parentFeatureKey) : undefined;
    }
  }

  for (const [key, preset] of Object.entries(def.presets))
    if (preset.parentSubjectType && ctx.subjectTypes && !ctx.subjectTypes.includes(preset.parentSubjectType))
      add("PARENT_TYPE", `/presets/${key}/parentSubjectType`, `The subject type "${preset.parentSubjectType}" is not registered`);
}

function scopeConsistent(def: FeatureDefinition, ctx: ValidationContext, add: Add): void {
  if (def.scope.scopeFrom === "record_field") {
    const field = def.record.fields.find((f) => f.key === def.scope.fieldKey);
    if (!field)
      add("SCOPE_CONSISTENT", "/scope/fieldKey", `The scope names the record field "${def.scope.fieldKey}", which does not exist`);
    else if (!SCOPE_FIELD_TYPES.has(field.type))
      add(
        "SCOPE_CONSISTENT",
        "/scope/fieldKey",
        `The scope reads "${field.key}", which is a ${field.type}; it needs a programme or section picker`,
      );
  }
  if (def.scope.scopeFrom === "parent" && !def.parentSubject)
    add("SCOPE_CONSISTENT", "/scope/scopeFrom", "The scope comes from the parent, but this feature has no parent subject");

  const parentKey = def.parentSubject?.featureKey;
  const parent = parentKey ? (ctx.publishedFeatures ?? []).find((f) => f.key === parentKey) : undefined;
  if (parent?.scopeLevel && SCOPE_ORDER[def.scope.level] < SCOPE_ORDER[parent.scopeLevel])
    add(
      "SCOPE_CONSISTENT",
      "/scope/level",
      `A ${def.scope.level} record cannot sit under a ${parent.scopeLevel} one`,
    );
}

// ---- code references ---------------------------------------------------------------------

function adaptersExist(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  const registry = ctx.adapters;
  if (!registry) return;
  const check = (key: string | undefined, hook: string, path: string) => {
    if (!key) return;
    const found = registry[key];
    if (!found) add("ADAPTER_EXISTS", path, `No adapter "${key}" is registered`);
    else if (found !== hook)
      add("ADAPTER_EXISTS", path, `The adapter "${key}" is a ${found} adapter, not a ${hook} one`);
  };

  if (def.record.backing.kind === "module")
    check(def.record.backing.adapter, "backing", "/record/backing/adapter");
  for (const leaf of tree.leaves) {
    check(leaf.step.adapter?.onEnter, "on_enter", `${leaf.path}/adapter/onEnter`);
    check(leaf.step.adapter?.onExit, "on_exit", `${leaf.path}/adapter/onExit`);
    check(leaf.step.adapter?.compute, "compute", `${leaf.path}/adapter/compute`);
    check(leaf.step.adapter?.validate, "validate", `${leaf.path}/adapter/validate`);
    leaf.step.actions.forEach((action, a) => {
      action.guards.forEach((key, g) => check(key, "guard", `${leaf.path}/actions/${a}/guards/${g}`));
      action.effects.forEach((key, e) => check(key, "effect", `${leaf.path}/actions/${a}/effects/${e}`));
    });
  }
  def.terminalStates.forEach((terminal, i) =>
    terminal.effects.forEach((key, e) => check(key, "effect", `/terminalStates/${i}/effects/${e}`)),
  );
  for (const [key, preset] of Object.entries(def.presets))
    for (const [slot, adapter] of Object.entries(preset.adapters)) {
      const hook = slot.endsWith(".guard") ? "guard" : slot.endsWith(".effect") ? "effect" : slot.split(".").pop()!;
      check(adapter, hook, `/presets/${key}/adapters/${slot}`);
    }
  if (def.report && !["records", "records_with_answers"].includes(def.report.dataSource))
    check(def.report.dataSource, "export", "/report/dataSource");
}

function surfacesExist(def: FeatureDefinition, tree: Tree, ctx: ValidationContext, add: Add): void {
  if (!ctx.surfaces) return;
  const registered = ctx.surfaces[def.key] ?? [];
  for (const leaf of tree.leaves)
    if (leaf.step.surface && !registered.includes(leaf.step.surface))
      add(
        "SURFACE_EXISTS",
        `${leaf.path}/surface`,
        `No surface "${leaf.step.surface}" is registered for "${def.key}"`,
      );
}

function presetsConsistent(def: FeatureDefinition, tree: Tree, add: Add): void {
  const stepKeys = new Set(tree.leaves.map((l) => l.step.key));
  const recordFields = new Set(def.record.fields.map((f) => f.key));
  const presets = Object.entries(def.presets);
  const withPrefix = presets.filter(([, p]) => p.permissionPrefix).length;
  if (withPrefix && withPrefix !== presets.length)
    add(
      "PRESET_CONSISTENT",
      "/presets",
      "Either every preset has its own permission prefix or none does; a mixture makes the permission of an action depend on the preset",
    );

  for (const [key, preset] of presets) {
    for (const stepKey of Object.keys(preset.formKeys))
      if (!stepKeys.has(stepKey))
        add("PRESET_CONSISTENT", `/presets/${key}/formKeys/${stepKey}`, `"${stepKey}" is not a step of this feature`);
    for (const slot of Object.keys(preset.adapters)) {
      const stepKey = slot.split(".")[0]!;
      if (!stepKeys.has(stepKey))
        add("PRESET_CONSISTENT", `/presets/${key}/adapters/${slot}`, `"${stepKey}" is not a step of this feature`);
    }
    for (const fieldKey of Object.keys(preset.fieldDefaults))
      if (!recordFields.has(fieldKey))
        add(
          "PRESET_CONSISTENT",
          `/presets/${key}/fieldDefaults/${fieldKey}`,
          `"${fieldKey}" is not a record field, so the preset cannot fix its value`,
        );
  }
}

function listColumns(def: FeatureDefinition, tree: Tree, add: Add): void {
  const recordFields = new Set(def.record.fields.map((f) => f.key));
  const states = new Set([
    ...tree.leaves.map((l) => l.step.key),
    ...tree.parallels.map((p) => p.group.key),
    ...def.terminalStates.map((t) => t.key),
  ]);
  const presetKeys = new Set(Object.keys(def.presets));
  const views = new Set(def.listViews.map((v) => v.key));

  const answerRef = (field: string, path: string) => {
    const [stepKey, questionKey] = field.slice("answer:".length).split(".");
    const leaf = stepKey ? tree.byKey[stepKey] : undefined;
    if (!leaf) {
      add("LIST_COLUMNS", path, `"${field}" names the step "${stepKey}", which does not exist`);
      return;
    }
    const known = everyField(leaf.step.form?.questions, "").some(({ field: f }) => f.key === questionKey);
    if (!known) add("LIST_COLUMNS", path, `"${stepKey}" has no question "${questionKey}"`);
  };

  def.listViews.forEach((view, i) => {
    view.columns.forEach((column, c) => {
      const path = `/listViews/${i}/columns/${c}`;
      if (column.field.startsWith("answer:")) answerRef(column.field, path);
      else if (!BUILT_IN_COLUMNS.has(column.field) && !recordFields.has(column.field))
        add("LIST_COLUMNS", path, `"${column.field}" is neither a record field nor a built-in column`);
    });
    for (const state of view.where?.states ?? [])
      if (!states.has(state)) add("LIST_COLUMNS", `/listViews/${i}/where/states`, `"${state}" is not a state of this feature`);
    if (view.where?.presetKey && !presetKeys.has(view.where.presetKey))
      add("LIST_COLUMNS", `/listViews/${i}/where/presetKey`, `"${view.where.presetKey}" is not a preset`);
  });

  def.dashboardCounters.forEach((counter, i) => {
    if (!views.has(counter.link))
      add("LIST_COLUMNS", `/dashboardCounters/${i}/link`, `The counter links to "${counter.link}", which is not a list view`);
    for (const state of counter.where.states ?? [])
      if (!states.has(state))
        add("LIST_COLUMNS", `/dashboardCounters/${i}/where/states`, `"${state}" is not a state of this feature`);
    if (counter.where.presetKey && !presetKeys.has(counter.where.presetKey))
      add("LIST_COLUMNS", `/dashboardCounters/${i}/where/presetKey`, `"${counter.where.presetKey}" is not a preset`);
  });
}

// ---- locks and warnings ---------------------------------------------------------------------

function locks(def: FeatureDefinition, ctx: ValidationContext, add: Add): void {
  const previous = ctx.previous;
  if (!previous) return;
  const pointers = previous.locks ?? allLocks(def, ctx.isSystem ?? false);
  for (const diff of lockedPathsChanged(previous.json, def, pointers)) {
    const backing = diff.path === "/record/backing" || /^\/presets\/[^/]+\/adapters/.test(diff.path);
    add(
      backing ? "BACKING_LOCKED" : "LOCK_VIOLATION",
      diff.path,
      backing
        ? `"${diff.path}" is backed by code and cannot be changed here`
        : `"${diff.path}" is locked by the system definition and cannot be changed`,
    );
  }
}

function warnings(def: FeatureDefinition, tree: Tree, add: Add): void {
  for (const leaf of tree.leaves) {
    const reviewing =
      leaf.step.stepType === "review" ||
      leaf.step.actions.some((a) => a.kind === "approve" || a.kind === "reject");
    if (reviewing && !leaf.step.deadline)
      add(
        "WARN_NO_DEADLINE",
        leaf.path,
        `"${leaf.step.key}" waits for a decision but has no deadline, so nothing will chase it`,
        "warning",
      );
    if (!leaf.step.workItem.createTask && !leaf.step.notifications.onEnter.length)
      add(
        "WARN_NO_NOTIFY",
        leaf.path,
        `"${leaf.step.key}" creates no task and sends no notification: its assignee will not learn about it`,
        "warning",
      );
  }
}

/** Convenience for callers that only care whether the definition may be published. */
export function errorsOnly(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === "error");
}
