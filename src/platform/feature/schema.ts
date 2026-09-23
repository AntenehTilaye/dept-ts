import { z } from "zod";
import {
  PeriodKind as PrismaPeriodKind,
  PermissionLevel as PrismaPermissionLevel,
  SubjectType as PrismaSubjectType,
  TaskKind as PrismaTaskKind,
} from "@/generated/prisma/enums";
import { ActorRule, AssigneeRule, RoleKeySchema } from "../workflow/actor-rules";
import { CompletionRule } from "../workflow/schema";
import { FieldDef } from "../forms/field-schema";

// The FeatureDefinition aggregate (design part 03 §1) — the single source for the compiler, the
// validator, the wizard and every seeded built-in. A definition is authored data: it names the
// steps, who may act, what is asked, when it is due and where it ends, and compiles into the
// artefacts of the other kernels. Nothing here executes; adapters are referenced by key only.

export const KEY = /^[a-z][a-z0-9_]{1,40}$/;
const key = () => z.string().regex(KEY, "lower_snake_case, 2-41 characters");

/** Membership roles plus the global administrator — the roles a sidebar entry can be shown to. */
export const NavRoleKey = z.enum([
  "department_head",
  "deputy_head",
  "instructor",
  "committee_member",
  "student_rep",
  "student",
  "lab_staff",
  "admin",
]);
export type NavRoleKey = z.infer<typeof NavRoleKey>;

/** Everything NavRoleKey has, plus the RoleGrant-only `committee_chair`. */
export const RoleKey = RoleKeySchema;
export type RoleKey = z.infer<typeof RoleKey>;

export const NavGroup = z.enum([
  "operations",
  "academic",
  "people",
  "communication",
  "planning",
  "resources",
  "admin",
]);
export type NavGroup = z.infer<typeof NavGroup>;

/** How far a record reaches. `faculty` is stored as the ScopeType `global`. */
export const ScopeLevel = z.enum(["faculty", "department", "program", "section"]);
export type ScopeLevel = z.infer<typeof ScopeLevel>;

const values = <T extends Record<string, string>>(e: T) => Object.values(e) as [string, ...string[]];

/** Mirrors the generated Prisma enums; `tests/unit/feature/enums-in-sync.test.ts` guards them. */
export const SubjectTypeKey = z.enum(values(PrismaSubjectType));
export const CalendarPeriodKind = z.enum(values(PrismaPeriodKind));
export const TaskKind = z.enum(values(PrismaTaskKind));
export const PermissionLevel = z.enum(values(PrismaPermissionLevel));

// ---- audiences ---------------------------------------------------------------------------

export const AudienceSpec = z.object({
  roles: z.array(RoleKey).optional(),
  groups: z.array(z.string()).optional(),
  programs: z.array(z.string()).optional(),
  yearLevels: z.array(z.number().int()).optional(),
  sections: z.array(z.string()).optional(),
  sectionOfferings: z.array(z.string()).optional(),
  teachingIn: z.string().optional(),
  persons: z.array(z.string()).optional(),
  excludePersons: z.array(z.string()).optional(),
});
export type AudienceSpec = z.infer<typeof AudienceSpec>;

/** Who a notification goes to: a role of the record, a role key, a spec or a record field. */
export const AudienceRef = z.union([
  z.enum([
    "assignee",
    "owner",
    "creator",
    "parent_owner",
    "parent_members",
    "parent_chair",
    "requester",
    "participants",
    "all_step_assignees",
  ]),
  z.string().regex(/^role:[a-z_]+$/),
  z.object({ audienceSpec: AudienceSpec }),
  z.object({ recordField: z.string().min(1) }),
]);
export type AudienceRef = z.infer<typeof AudienceRef>;

// ---- deadlines, reminders, notifications, attachments --------------------------------------

export const DeadlineRule = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("fixed"), at: z.iso.datetime() }),
  z.object({
    rule: z.literal("relative"),
    offsetDays: z.number().int(),
    from: z.enum(["step_entered", "record_created", "parent_deadline", "record_field"]),
    fieldKey: z.string().optional(),
    hours: z.number().int().optional(),
  }),
  z.object({
    rule: z.literal("calendar"),
    periodKind: CalendarPeriodKind,
    edge: z.enum(["start", "end"]),
    offsetDays: z.number().int().default(0),
    termFrom: z.enum(["current_term", "record_field", "parent"]).default("current_term"),
    fieldKey: z.string().optional(),
  }),
]);
export type DeadlineRule = z.infer<typeof DeadlineRule>;

export const ReminderRule = z.object({
  scheduleKey: z.string().min(1),
  audience: z.enum(["assignee", "owner", "both"]).default("assignee"),
  escalateToRole: RoleKey.optional(),
});
export type ReminderRule = z.infer<typeof ReminderRule>;

export const NotificationRule = z.object({
  templateKey: z.string().min(1),
  to: AudienceRef,
  category: z.string().default("assignment"),
  ackRequired: z.boolean().default(false),
  declinable: z.boolean().default(false),
  channels: z.array(z.enum(["in_app", "email", "sms"])).optional(),
  dedupe: z.boolean().default(true),
});
export type NotificationRule = z.infer<typeof NotificationRule>;

export const AttachmentSlot = z.object({
  slotKey: key(),
  label: z.string().min(1),
  required: z.boolean().default(false),
  accept: z.array(z.string()).default(["application/pdf", "image/*", ".docx", ".xlsx"]),
  maxFiles: z.number().int().min(1).default(5),
});
export type AttachmentSlot = z.infer<typeof AttachmentSlot>;

// ---- actions ------------------------------------------------------------------------------

export const AutoRule = z.discriminatedUnion("when", [
  /** Fires at the step deadline. */
  z.object({ when: z.literal("deadline") }),
  /** Fires at a datetime held in a record field (campaign opensAt, announcement expiresAt). */
  z.object({ when: z.literal("field_datetime"), fieldKey: z.string().min(1) }),
  z.object({
    when: z.literal("after_days"),
    days: z.number().int().min(1).optional(),
    settingKey: z.string().min(1).optional(),
  }),
  z.object({
    when: z.literal("event"),
    eventName: z.string().min(1),
    match: z.record(z.string(), z.string()).optional(),
  }),
]);
export type AutoRule = z.infer<typeof AutoRule>;

export const ActionKind = z.enum([
  "submit",
  "approve",
  "reject",
  "request_revision",
  "complete",
  "cancel",
  "reopen",
  "assign",
  "custom",
  "auto",
]);

export const ActionDef = z.object({
  key: key(),
  label: z.string().min(1),
  kind: ActionKind,
  /** step | group | parallel | terminal key, or `$next` / `$self`. */
  to: z.string().min(1),
  actors: z.array(ActorRule).min(1),
  requiredComment: z.boolean().default(false),
  /** Question keys of this step's form, or record field keys. */
  requiredFields: z.array(z.string()).default([]),
  /** Slot keys of this step. */
  requiredAttachments: z.array(z.string()).default([]),
  /** Adapter keys; feature.actorAllowed and feature.stepComplete are always prepended. */
  guards: z.array(z.string()).default([]),
  /** Adapter keys run after the built-in effects. */
  effects: z.array(z.string()).default([]),
  /** Defaults to `feature.<featureKey>.act.<actionKey>`. */
  permission: z.string().min(1).optional(),
  confirm: z.object({ title: z.string(), message: z.string() }).optional(),
  auto: AutoRule.optional(),
  reassignTo: AssigneeRule.optional(),
});
export type ActionDef = z.infer<typeof ActionDef>;

// ---- step tree ----------------------------------------------------------------------------

export const StepType = z.enum(["form", "review", "upload", "adapter", "wait"]);

export const StepDef = z.object({
  kind: z.literal("step"),
  key: key(),
  label: z.string().min(1),
  description: z.string().optional(),
  stepType: StepType.default("form"),
  form: z
    .object({
      sectionTitle: z.string().min(1),
      questions: z.array(FieldDef).default([]),
      /** Reuse a published FormDefinition instead of inline questions. */
      formKey: z.string().min(1).optional(),
    })
    .nullable()
    .default(null),
  attachments: z.array(AttachmentSlot).default([]),
  assignee: AssigneeRule,
  actions: z.array(ActionDef).min(1),
  deadline: DeadlineRule.optional(),
  reminders: ReminderRule.optional(),
  notifications: z
    .object({
      onEnter: z.array(NotificationRule).default([]),
      onExit: z.array(NotificationRule).default([]),
    })
    .default({ onEnter: [], onExit: [] }),
  canView: z.array(ActorRule).default([{ type: "owner" }, { type: "assignee" }]),
  canEdit: z.array(ActorRule).default([{ type: "assignee" }]),
  /** Adapter keys (implicitly locked). */
  adapter: z
    .object({
      onEnter: z.string().optional(),
      onExit: z.string().optional(),
      compute: z.string().optional(),
      validate: z.string().optional(),
    })
    .optional(),
  /** Key into surfaces[featureKey].stepRenderers (implicitly locked). */
  surface: z.string().min(1).optional(),
  workItem: z
    .object({
      createTask: z.boolean().default(true),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    })
    .default({ createTask: true, priority: "normal" }),
});
export type StepDef = z.infer<typeof StepDef>;
/** A step as an author writes it, before defaults are applied (fixtures, the wizard's drafts). */
export type StepDefInput = z.input<typeof StepDef>;
export type ActionDefInput = z.input<typeof ActionDef>;

export interface StepGroup {
  kind: "group";
  key: string;
  label: string;
  steps: StepNode[];
}
export interface Branch {
  key: string;
  label: string;
  steps: StepNode[];
}
export interface ParallelGroup {
  kind: "parallel";
  key: string;
  label: string;
  branches:
    | { mode: "static"; items: Branch[] }
    | { mode: "dynamic"; perPerson: z.infer<typeof AssigneeRule>; branch: Branch };
  completion: z.infer<typeof CompletionRule>;
  onComplete: string;
  onAnyReject?: string;
}
export type StepNode = StepDef | StepGroup | ParallelGroup;

export const StepGroupSchema: z.ZodType<StepGroup> = z.lazy(() =>
  z.object({
    kind: z.literal("group"),
    key: key(),
    label: z.string().min(1),
    /** Sequential sub-steps; `$next` at the end resolves to the group's own `$next`. */
    steps: z.array(StepNodeSchema).min(1),
  }),
);

export const BranchSchema: z.ZodType<Branch> = z.lazy(() =>
  z.object({ key: key(), label: z.string().min(1), steps: z.array(StepNodeSchema).min(1) }),
);

export const ParallelGroupSchema: z.ZodType<ParallelGroup> = z.lazy(() =>
  z.object({
    kind: z.literal("parallel"),
    key: key(),
    label: z.string().min(1),
    branches: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("static"), items: z.array(BranchSchema).min(2) }),
      /** One branch per resolved person (every participant, every reviewer, ...). */
      z.object({ mode: z.literal("dynamic"), perPerson: AssigneeRule, branch: BranchSchema }),
    ]),
    completion: CompletionRule,
    onComplete: z.string().min(1),
    /** Where a branch rejection sends the record; the siblings become SKIPPED. */
    onAnyReject: z.string().min(1).optional(),
  }),
);

export const StepNodeSchema: z.ZodType<StepNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [StepDef, StepGroupSchema as never, ParallelGroupSchema as never]),
);

// ---- views, counters, report ---------------------------------------------------------------

export const ListView = z.object({
  key: key(),
  label: z.string().min(1),
  columns: z
    .array(
      z.object({
        /** Record field, a built-in (number, title, state, assignee, owner, deadline, parent,
         * createdAt) or `answer:<stepKey>.<questionKey>`. */
        field: z.string().min(1),
        label: z.string().min(1),
        sortable: z.boolean().default(true),
      }),
    )
    .min(1),
  filters: z
    .array(
      z.object({
        field: z.string().min(1),
        type: z.enum([
          "state",
          "person",
          "date_range",
          "select",
          "text",
          "parent",
          "mine",
          "overdue",
          "preset",
        ]),
      }),
    )
    .default([]),
  defaultSort: z
    .object({ field: z.string().min(1), dir: z.enum(["asc", "desc"]) })
    .default({ field: "createdAt", dir: "desc" }),
  visibleRoles: z.array(NavRoleKey).optional(),
  where: z
    .object({ states: z.array(z.string()).optional(), presetKey: z.string().optional() })
    .optional(),
});
export type ListView = z.infer<typeof ListView>;

export const Counter = z.object({
  key: key(),
  label: z.string().min(1),
  where: z.object({
    states: z.array(z.string()).optional(),
    assignedToMe: z.boolean().optional(),
    ownedByMe: z.boolean().optional(),
    overdue: z.boolean().optional(),
    parentMine: z.boolean().optional(),
    presetKey: z.string().optional(),
  }),
  roles: z.array(RoleKey),
  /** A list view key. */
  link: z.string().min(1),
  tone: z.enum(["neutral", "warning", "danger"]).default("neutral"),
});
export type Counter = z.infer<typeof Counter>;

export const ReportDef = z.object({
  key: key(),
  title: z.string().min(1),
  formats: z.array(z.enum(["pdf", "xlsx", "csv", "html"])).min(1),
  templateKey: z.string().min(1),
  /** `records`, `records_with_answers` or an adapter key (hook `export`, then locked). */
  dataSource: z.union([z.enum(["records", "records_with_answers"]), z.string().min(1)]),
  parameters: z.array(FieldDef).default([]),
  requiredPermission: z.string().min(1).optional(),
});
export type ReportDef = z.infer<typeof ReportDef>;

// ---- root ------------------------------------------------------------------------------------

export const RecordBacking = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feature_record") }),
  /** The record IS the Task row (task, case, student_issue, planned_activity). */
  z.object({
    kind: z.literal("task"),
    taskKind: TaskKind,
    extension: z.enum(["case", "planned_activity"]).optional(),
  }),
  /** A module row created by a `backing` adapter (Portfolio, Meeting, Campaign, ...). */
  z.object({ kind: z.literal("module"), adapter: z.string().min(1) }),
]);
export type RecordBacking = z.infer<typeof RecordBacking>;

export const PresetDef = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  /** Locked values written into record.data (e.g. kind = 'add_drop'). */
  fieldDefaults: z.record(z.string(), z.unknown()).default({}),
  /** stepKey -> FormDefinition key override. */
  formKeys: z.record(z.string(), z.string()).default({}),
  /** `<stepKey>.<hook>` or `<stepKey>.<actionKey>.guard|effect` -> adapter key. */
  adapters: z.record(z.string(), z.string()).default({}),
  /** `<prefix>.<action>` instead of `feature.<key>.act.<action>`. */
  permissionPrefix: z.string().min(1).optional(),
  parentSubjectType: SubjectTypeKey.optional(),
  visibleRoles: z.array(NavRoleKey).optional(),
  navLabel: z.string().min(1).optional(),
});
export type PresetDef = z.infer<typeof PresetDef>;

export const TerminalState = z.object({
  key: key(),
  label: z.string().min(1),
  category: z.enum(["success", "rejected", "cancelled"]),
  notifications: z.array(NotificationRule).default([]),
  effects: z.array(z.string()).default([]),
});
export type TerminalState = z.infer<typeof TerminalState>;

export const FeatureDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  key: key(),
  name: z.string().min(2),
  description: z.string().optional(),
  labels: z.object({ singular: z.string().min(1), plural: z.string().min(1) }),
  navigation: z.object({
    group: NavGroup,
    order: z.number().int(),
    /** A lucide icon name. */
    icon: z.string().min(1),
    visibleRoles: z.array(NavRoleKey).min(1),
    showInDashboard: z.boolean().default(true),
    showCounterInNav: z.boolean().default(false),
  }),
  scope: z.object({
    level: ScopeLevel,
    scopeFrom: z.enum(["department", "parent", "record_field"]).default("department"),
    fieldKey: z.string().optional(),
  }),
  parentSubject: z
    .object({
      subjectType: SubjectTypeKey,
      /** When subjectType is feature_record. */
      featureKey: z.string().optional(),
      relation: z.string().default("parent"),
      required: z.boolean().default(true),
      inheritPermissions: z.boolean().default(true),
      listUnderParent: z.boolean().default(true),
      createFromParent: z.boolean().default(true),
      /** Polymorphic optional parents, e.g. the context of a task. */
      allowedTypes: z.array(SubjectTypeKey).optional(),
    })
    .optional(),
  record: z.object({
    /** F-<prefix>-<year>-<seq>. */
    numberPrefix: z.string().regex(/^[A-Z]{1,4}$/),
    /** Mustache over record fields and parent variables. */
    titleTemplate: z.string().min(1),
    fields: z.array(FieldDef).default([]),
    canCreate: z.array(ActorRule).min(1),
    ownerRule: AssigneeRule.default({ type: "creator" }),
    backing: RecordBacking.default({ kind: "feature_record" }),
  }),
  /** Kind presets: campaign kinds, task kinds, import kinds. */
  presets: z.record(key(), PresetDef).default({}),
  /** Ordered tree; the first leaf is the initial state. */
  steps: z.array(StepNodeSchema).min(1),
  terminalStates: z.array(TerminalState).min(1),
  listViews: z.array(ListView).min(1),
  dashboardCounters: z.array(Counter).default([]),
  report: ReportDef.optional(),
  // partial: a definition names the roles it grants and stays silent about the rest
  permissions: z.object({ defaults: z.partialRecord(RoleKey, PermissionLevel) }),
  /** RFC 6901 pointers, merged with the implicit locks of part 03 §9. */
  lockedPaths: z.array(z.string().regex(/^\//)).default([]),
  // strict: a definition is an authored document, so a misspelled or obsolete key (`terminals`,
  // `hierarchy`) must be reported rather than silently dropped on the way to the compiler
}).strict();
export type FeatureDefinition = z.infer<typeof FeatureDefinitionSchema>;

/** The definition as an author writes it, before defaults are applied. */
export type FeatureDefinitionInput = z.input<typeof FeatureDefinitionSchema>;

export const NEXT = "$next";
export const SELF = "$self";

export function isStep(node: StepNode): node is StepDef {
  return node.kind === "step";
}
export function isGroup(node: StepNode): node is StepGroup {
  return node.kind === "group";
}
export function isParallel(node: StepNode): node is ParallelGroup {
  return node.kind === "parallel";
}

/** Branches of a parallel group, with the dynamic template as a single `$person` branch. */
export function branchesOf(group: ParallelGroup): Branch[] {
  return group.branches.mode === "static"
    ? group.branches.items
    : [{ ...group.branches.branch, key: "$person" }];
}

/** The ScopeType column value for an authored scope level. */
export function scopeTypeOf(level: ScopeLevel): "global" | "department" | "program" | "section" {
  return level === "faculty" ? "global" : level;
}
