import type { Definition, DefinitionIssue } from "./schema";

/** Structural validation beyond Zod shapes: keys, references, reachability, compound rules. */
export function validateDefinition(def: Definition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const issue = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const stateKeys = new Set<string>();
  const branchOwner = new Map<string, string>(); // branch state -> owning compound state

  for (const s of def.states) {
    if (stateKeys.has(s.key))
      issue("duplicate_state", `states.${s.key}`, `state "${s.key}" is declared twice`);
    stateKeys.add(s.key);
  }
  for (const s of def.states) {
    if (s.category === "terminal" && !s.terminalCategory)
      issue(
        "terminal_category",
        `states.${s.key}`,
        `terminal state "${s.key}" needs a terminalCategory`,
      );
    const c = s.compound;
    if (!c) continue;
    if (s.category !== "waiting")
      issue(
        "compound_category",
        `states.${s.key}`,
        `compound state "${s.key}" must be a waiting state`,
      );
    if (!stateKeys.has(c.onComplete))
      issue(
        "unknown_state",
        `states.${s.key}.compound.onComplete`,
        `onComplete "${c.onComplete}" is not a state`,
      );
    if (c.onReject && !stateKeys.has(c.onReject))
      issue(
        "unknown_state",
        `states.${s.key}.compound.onReject`,
        `onReject "${c.onReject}" is not a state`,
      );
    if (c.completion.rule === "quorum" && !c.dynamic && c.completion.n > c.branches.length)
      issue(
        "quorum_too_large",
        `states.${s.key}.compound.completion`,
        `quorum ${c.completion.n} exceeds ${c.branches.length} branches`,
      );
    if (c.dynamic && (c.branches.length !== 1 || c.branches[0]!.key !== "$person"))
      issue(
        "dynamic_branch",
        `states.${s.key}.compound.branches`,
        "a dynamic compound state carries exactly one $person branch",
      );
    for (const b of c.branches) {
      const declared = new Set(b.states);
      for (const k of [b.initialState, b.doneState, b.rejectedState]) {
        if (!declared.has(k))
          issue(
            "undeclared_branch_state",
            `states.${s.key}.compound.branches.${b.key}`,
            `branch state "${k}" is not declared in the branch`,
          );
      }
      for (const k of b.states) {
        if (stateKeys.has(k))
          issue(
            "branch_state_clash",
            `states.${s.key}.compound.branches.${b.key}`,
            `branch state "${k}" clashes with a top-level state`,
          );
        branchOwner.set(k, s.key);
      }
    }
  }
  if (!stateKeys.has(def.initialState))
    issue("unknown_state", "initialState", `initial state "${def.initialState}" is not a state`);

  const transitionKeys = new Set<string>();
  for (const t of def.transitions) {
    if (transitionKeys.has(t.key))
      issue(
        "duplicate_transition",
        `transitions.${t.key}`,
        `transition "${t.key}" is declared twice`,
      );
    transitionKeys.add(t.key);
    if (!stateKeys.has(t.from) && !branchOwner.has(t.from))
      issue("unknown_state", `transitions.${t.key}.from`, `from "${t.from}" is not a state`);
    if (!stateKeys.has(t.to) && !branchOwner.has(t.to))
      issue("unknown_state", `transitions.${t.key}.to`, `to "${t.to}" is not a state`);
    if (branchOwner.has(t.from) && !t.branch)
      issue(
        "branch_missing",
        `transitions.${t.key}`,
        `transition from branch state "${t.from}" must name its branch`,
      );
    if (
      branchOwner.has(t.from) &&
      branchOwner.has(t.to) &&
      branchOwner.get(t.from) !== branchOwner.get(t.to)
    )
      issue(
        "branch_crossing",
        `transitions.${t.key}`,
        "a branch transition cannot cross into another compound state",
      );
  }

  // reachability from the initial state over transitions plus compound onComplete/onReject
  const reachable = new Set<string>([def.initialState]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of def.transitions) {
      const from = branchOwner.get(t.from) ?? t.from;
      const to = branchOwner.get(t.to) ?? t.to;
      if (reachable.has(from) && !reachable.has(to)) {
        reachable.add(to);
        grew = true;
      }
    }
    for (const s of def.states) {
      if (!s.compound || !reachable.has(s.key)) continue;
      for (const k of [s.compound.onComplete, s.compound.onReject]) {
        if (k && !reachable.has(k)) {
          reachable.add(k);
          grew = true;
        }
      }
    }
  }
  for (const s of def.states) {
    if (s.category === "terminal" && !reachable.has(s.key))
      issue(
        "unreachable_terminal",
        `states.${s.key}`,
        `terminal state "${s.key}" is unreachable from "${def.initialState}"`,
      );
  }
  return issues;
}
