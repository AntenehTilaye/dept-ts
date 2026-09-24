import {
  branchesOf,
  isGroup,
  isParallel,
  isStep,
  NEXT,
  SELF,
  type FeatureDefinition,
  type ParallelGroup,
  type StepDef,
  type StepNode,
} from "./schema";

// Walking the step tree is shared by the compiler and the validator: both need the ordered leaf
// list, where `$next` points and which JSON pointer a state came from. A group contributes
// ordering only — it is never a state — while a parallel group is one compound state whose
// branches hold leaves of their own.

/** Where a leaf sits: the top level, inside a group, or inside a branch of a parallel group. */
export interface LeafContext {
  /** Enclosing parallel group, if any. */
  groupKey?: string;
  /** Static branch key, or `$person` for a dynamic group. */
  branchKey?: string;
  /** The enclosing step groups, outermost first (ordering and the timeline only). */
  groups: string[];
}

export interface Leaf extends LeafContext {
  step: StepDef;
  /** RFC 6901 pointer into the definition. */
  path: string;
  /** Position among all leaves, in document order. */
  index: number;
}

export interface ParallelNode extends LeafContext {
  group: ParallelGroup;
  path: string;
}

export type StateKind = "step" | "parallel" | "terminal";

export interface StateEntry {
  kind: StateKind;
  path: string;
  groupKey?: string;
  branchKey?: string;
}

export interface Tree {
  leaves: Leaf[];
  parallels: ParallelNode[];
  /** Step key -> where `$next` points, absent when it falls off the end of the top level. */
  nextMap: Record<string, string>;
  /** Every addressable state: leaves, compound states and terminals. */
  stateIndex: Record<string, StateEntry>;
  /** Keys that may appear in an action's `to`, mapped to the state they enter. */
  targets: Record<string, string>;
  byKey: Record<string, Leaf>;
}

/** The state entered when a node is the target: a group enters its first leaf. */
export function entryState(node: StepNode): string {
  if (isStep(node)) return node.key;
  if (isParallel(node)) return node.key;
  const first = node.steps[0];
  return first ? entryState(first) : node.key;
}

/** The synthetic state a branch reaches when its last step completes. */
export function branchDoneState(groupKey: string, branchKey: string): string {
  return `${groupKey}.${branchKey}.$done`;
}

export function branchRejectedState(groupKey: string, branchKey: string): string {
  return `${groupKey}.${branchKey}.$rejected`;
}

/** Walks the tree once, in document order. */
export function buildTree(def: FeatureDefinition): Tree {
  const leaves: Leaf[] = [];
  const parallels: ParallelNode[] = [];
  const nextMap: Record<string, string> = {};
  const stateIndex: Record<string, StateEntry> = {};
  const targets: Record<string, string> = {};

  const walk = (
    nodes: StepNode[],
    path: string,
    containerNext: string | undefined,
    ctx: LeafContext,
  ): void => {
    nodes.forEach((node, i) => {
      const nodePath = `${path}/${i}`;
      // what follows this node inside its own container
      const after = nodes[i + 1];
      const next = after ? entryState(after) : containerNext;

      if (isStep(node)) {
        const leaf: Leaf = { step: node, path: nodePath, index: leaves.length, ...ctx };
        leaves.push(leaf);
        if (next) nextMap[node.key] = next;
        stateIndex[node.key] = {
          kind: "step",
          path: nodePath,
          groupKey: ctx.groupKey,
          branchKey: ctx.branchKey,
        };
        targets[node.key] = node.key;
        return;
      }

      if (isGroup(node)) {
        targets[node.key] = entryState(node);
        walk(node.steps, `${nodePath}/steps`, next, { ...ctx, groups: [...ctx.groups, node.key] });
        return;
      }

      parallels.push({ group: node, path: nodePath, ...ctx });
      stateIndex[node.key] = { kind: "parallel", path: nodePath, groupKey: ctx.groupKey };
      targets[node.key] = node.key;
      if (next) nextMap[node.key] = next;

      const branchPath =
        node.branches.mode === "static" ? `${nodePath}/branches/items` : `${nodePath}/branches`;
      branchesOf(node).forEach((branch, b) => {
        const thisPath =
          node.branches.mode === "static" ? `${branchPath}/${b}/steps` : `${branchPath}/branch/steps`;
        walk(branch.steps, thisPath, branchDoneState(node.key, branch.key), {
          groupKey: node.key,
          branchKey: branch.key,
          groups: [],
        });
      });
    });
  };

  walk(def.steps, "/steps", undefined, { groups: [] });

  for (const terminal of def.terminalStates) {
    stateIndex[terminal.key] = { kind: "terminal", path: `/terminalStates/${terminal.key}` };
    targets[terminal.key] = terminal.key;
  }

  const byKey = Object.fromEntries(leaves.map((l) => [l.step.key, l]));
  return { leaves, parallels, nextMap, stateIndex, targets, byKey };
}

export interface Resolution {
  /** The state an action enters, or null when the target cannot be resolved. */
  state: string | null;
  /** Why it could not be resolved. */
  reason?: "unknown" | "next_unresolved";
}

/** Resolves an action target (`$next`, `$self`, a step, group, parallel or terminal key). */
export function resolveTarget(tree: Tree, from: Leaf | ParallelNode, to: string): Resolution {
  const key = "step" in from ? from.step.key : from.group.key;
  if (to === SELF) return { state: key };
  if (to === NEXT) {
    const next = tree.nextMap[key];
    return next ? { state: next } : { state: null, reason: "next_unresolved" };
  }
  const target = tree.targets[to];
  return target ? { state: target } : { state: null, reason: "unknown" };
}

/** Leaves of one branch of a parallel group, in order. */
export function branchLeaves(tree: Tree, groupKey: string, branchKey: string): Leaf[] {
  return tree.leaves.filter((l) => l.groupKey === groupKey && l.branchKey === branchKey);
}
