import { z } from "zod";
import { ActorRule } from "./actor-rules";

// The single State/Transition JSON contract (design part 03 §2b / part 04 §6). Every
// WorkflowDefinition write is validated here; the feature compiler emits exactly this shape.
// There is no joinPolicy, parallel.join, branchStateJson or `from: string[]` anywhere.

export const StateCategory = z.enum(["initial", "active", "waiting", "terminal"]);
export type StateCategory = z.infer<typeof StateCategory>;

export const BranchSpec = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  initialState: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  doneState: z.string().min(1),
  rejectedState: z.string().min(1),
});
export type BranchSpec = z.infer<typeof BranchSpec>;

export const CompletionRule = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("all") }),
  z.object({ rule: z.literal("quorum"), n: z.number().int().min(1) }),
  z.object({ rule: z.literal("any") }),
]);
export type CompletionRule = z.infer<typeof CompletionRule>;

export const CompoundSpec = z.object({
  branches: z.array(BranchSpec).min(1),
  completion: CompletionRule,
  /** One `$person` branch template instantiated per resolved person at runtime. */
  dynamic: z.boolean().default(false),
  onComplete: z.string().min(1),
  onReject: z.string().min(1).optional(),
});
export type CompoundSpec = z.infer<typeof CompoundSpec>;

export const WorkflowStateJson = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    category: StateCategory,
    slaHours: z.number().positive().optional(),
    terminalCategory: z.enum(["success", "rejected", "cancelled"]).optional(),
    compound: CompoundSpec.optional(),
  })
  .strict();
export type WorkflowStateJson = z.infer<typeof WorkflowStateJson>;

export const EffectKind = z.enum([
  "notify",
  "emit",
  "createTask",
  "setField",
  "invokeHandler",
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
]);
export type EffectKind = z.infer<typeof EffectKind>;

export const EffectSpec = z
  .object({ kind: EffectKind, args: z.record(z.string(), z.unknown()).default({}) })
  .strict();
export type EffectSpec = z.infer<typeof EffectSpec>;

export const WorkflowTransitionJson = z
  .object({
    /** "<state>.<action>" */
    key: z.string().min(1),
    /** One source; multi-source actions compile to one transition per source. */
    from: z.string().min(1),
    to: z.string().min(1),
    action: z.string().min(1),
    /** Set when `from` is a branch state of a compound state; "$person" for dynamic branches. */
    branch: z.string().min(1).optional(),
    system: z.boolean().default(false),
    requiredPermission: z.string().min(1).optional(),
    actorRules: z.array(ActorRule).default([]),
    requiredComment: z.boolean().default(false),
    requiredFields: z.array(z.string()).default([]),
    requiredAttachments: z.array(z.string()).default([]),
    guards: z.array(z.string()).default([]),
    effects: z.array(EffectSpec).default([]),
  })
  .strict();
export type WorkflowTransitionJson = z.infer<typeof WorkflowTransitionJson>;

export const BranchStatus = z.enum(["pending", "active", "done", "skipped", "rejected"]);
export const BranchState = z.object({
  state: z.string(),
  status: BranchStatus,
  enteredAt: z.string(),
  actorPersonId: z.string().optional(),
});
export type BranchState = z.infer<typeof BranchState>;
export type BranchStates = Record<string, BranchState>;

export const WorkflowDefinitionInput = z.object({
  key: z.string().min(1),
  version: z.number().int().min(1).optional(),
  subjectType: z.string().min(1),
  initialState: z.string().min(1),
  states: z.array(WorkflowStateJson).min(1),
  transitions: z.array(WorkflowTransitionJson),
  lockedPaths: z.array(z.string()).default([]),
  isSystem: z.boolean().default(false),
  departmentId: z.string().nullable().default(null),
  featureVersionId: z.string().nullable().default(null),
});
export type WorkflowDefinitionInput = z.infer<typeof WorkflowDefinitionInput>;

export interface Definition {
  key: string;
  version: number;
  subjectType: string;
  initialState: string;
  states: WorkflowStateJson[];
  transitions: WorkflowTransitionJson[];
}

export interface DefinitionIssue {
  code: string;
  path: string;
  message: string;
}

/** Parses raw JSON columns into a typed Definition (throws on shape errors). */
export function parseDefinition(row: {
  key: string;
  version: number;
  subjectType: string;
  initialState: string;
  statesJson: unknown;
  transitionsJson: unknown;
}): Definition {
  return {
    key: row.key,
    version: row.version,
    subjectType: row.subjectType,
    initialState: row.initialState,
    states: z.array(WorkflowStateJson).parse(row.statesJson),
    transitions: z.array(WorkflowTransitionJson).parse(row.transitionsJson),
  };
}
