SOURCE: repair:builder

===== FEATURE BUILDER =====
 # Feature builder (Feature Runtime kernel service)

## 0. Position, invariants, files

`src/platform/feature/` is a kernel service beside Workflow, Form/Campaign, WorkItem, Scheduler/Notification, Template, Document, Identity. It never re-implements them: a **FeatureDefinition** is compiled at publish time into their artefacts (WorkflowDefinition, FormDefinitions, TaskTemplates, ReminderSubscription templates, Permission/RolePermission rows, RoleGrant requirements, ReportDefinition) and a **generic runtime** orchestrates calls to them per record.

**Canonical status of this part.** Section 1 (Zod schema), section 2 (Prisma models), section 3 (compile), section 4 (validation codes) and section 2b (workflow State/Transition JSON contract) are the single source for every other part: P9's `schema.ts`/`validate.ts`/`compile.ts` deliverables and tests use exactly these names (no `hierarchy{nav,parent,scope}`, no `terminals`, no `DUP_KEY`/`BAD_TARGET`/`UNREACHABLE`); prismaSchema §7 is the `feature.prisma` file printed in section 2 (there is no `FeatureVersion`, `FeatureStepRun` or `FeatureCounterCache`); prismaSchema §6 and P4's `parallel.ts` copy section 2b verbatim; every module seed paragraph in P12-P24 describes its definition with the `seededFeatures` list of this part (navigation / scope / parentSubject / record.backing / steps / terminalStates), and `tests/unit/feature/seeds.test.ts` snapshots the compiled result of those seeds.

Invariants (enforced by code and by review rules):
- **Ids**: text `cuid()` ids everywhere (better-auth tables included); `Department.id === Organization.id` (the better-auth organization id, created through `auth.api.createOrganization` in P2, never a fixed UUID); RLS policies compare `department_id` (text) to `current_setting('app.current_department_id', true)` with **no cast**. `prisma/scripts/gen-rls.ts` reads DMMF `dbName` so policies use snake_case table/column names.
- `WorkflowInstance` is the **only** owner of lifecycle state. `FeatureRecord.currentStateKey`, `FeatureRecord.branchStatesCache`, `FeatureRecord.deadlineAt`, `FeatureRecord.closedAt` and every module timestamp (`Portfolio.submittedAt`, `Group.status` for committees, `Announcement.publishedAt`, ...) are **derived caches written only by the compiled `feature.enterStep` / `feature.exitStep` / `feature.setTerminal` effects**, never by server actions.
- **One Task table.** Every active step of a feature whose `record.backing.kind = 'feature_record' | 'module'` is backed by exactly one `Task` row (`kind = feature_step`, `Task.featureStepInstanceId`), so it appears in My Work / inbox with ack, comments and DocumentLink deliverables. Features whose `record.backing.kind = 'task'` (task, case, student_issue, planned_activity) ARE the Task row (`Task.featureRecordId`), and their steps do **not** spawn extra tasks. There is no second work-item source.
- Deliverables = `DocumentLink(linkRole='deliverable', slotKey)` on the step instance; acknowledgement = the assignment `Notification` (`dedupeKey` required); deadlines = `ReminderSubscription` + `ScheduledJob` ledger rows (`status` scheduled|running|done|failed|cancelled; idempotency key `feature_step_instance:<id>:<scheduleKey>:<offset>`); outbox handlers (`DomainEvent.publishedAt/deadAt`) write `EventHandlerReceipt(eventId, handlerKey)` before acting.
- Tenancy: `FeatureRecord`, `FeatureStepInstance`, `FeatureNumberSequence`, `FeatureMigration` carry `departmentId NOT NULL` and get RLS from `gen-rls.ts`; `FeatureDefinition`/`FeatureDefinitionVersion` are global-or-tenant (`departmentId NULL` = faculty-wide) and get the `nullable-tenant` policy variant (`department_id IS NULL OR department_id = current_setting('app.current_department_id', true)`). `Person` is global (no departmentId) and linked to departments through `DepartmentPerson`; the link to a login is `Person.userId @unique` only.
- Roles: the seven better-auth membership roles (`department_head, deputy_head, instructor, committee_member, student_rep, student, lab_staff`) plus the global `admin` (`user.role`) are `NavRoleKey`; `committee_chair` is a **RoleGrant-only derived role** (`COMMITTEE_CHAIR@committee`), never a membership role, so it is valid in actor rules / counters / `permissions.defaults` (`RoleKey`) but not in `navigation.visibleRoles`. `Actor.roles` = membership roles; `Actor.grantRoleKeys` = active `RoleGrant` role keys in the department (incl. derived); actor `role` rules match the union.

Files:
```
src/platform/feature/
  schema.ts            Zod 4 FeatureDefinition aggregate (section 1)
  validate.ts          validateDefinition(def, ctx) -> Issue[]  (section 4)
  compile.ts           compile(def, ctx) -> CompiledFeature       (section 3)
  simulate.ts          simulate(def, script) -> SimulationTrace   (section 5)
  publish.ts           publishVersion(): validate -> compile -> upsert artefacts (one tx)
  migrate.ts           planMigration / runMigrationBatch           (section 6)
  locks.ts             deriveImplicitLocks, assertLockedPathsUnchanged, lockedHash
  nav.ts               getNav(actor, dept)
  counters.ts          featureCounters(actor, dept)
  runtime/
    create.ts          createRecord()
    steps.ts           enterStep(), enterParallel(), completeBranch(), exitStep()
    act.ts             act()  (the only path that calls Workflow.apply for features)
    assign.ts          resolveAssignee(), reassign()
    queries.ts         list/detail/step read models (scoped client)
    subject.ts         SubjectRegistry.register('feature_record' | 'feature_step_instance')
    effects.ts         registers feature.* effects and guards with the Workflow Engine
  adapters/
    registry.ts        AdapterRegistry (register/get/list/assertExists)
    builtin.ts         feature.actorAllowed, feature.stepComplete, feature.parallelComplete, feature.parentActive, feature.deadlineNotPassed, feature.autoOnEvent
  seed/
    index.ts           seedFeatures(db)  (section 9)
    merge.ts           mergeLocked(currentJson, codeJson, lockedPaths)
prisma/seed/features/<key>.ts          one TypeScript FeatureDefinition object per built-in (section 9)
prisma/seed/features/index.ts          ordered list (parents first)
src/modules/<module>/adapters.ts       registerAdapter(...) calls (code-backed parts)
src/modules/<module>/surface.tsx       surfaces[featureKey] = { detailExtras, stepRenderers, listExtras, createExtras }
src/modules/index.ts                   imports every module's adapters + surfaces (imported by src/lib/bootstrap.ts and apps/worker/src/index.ts)
```

## 1. FeatureDefinition aggregate — Zod schema (`src/platform/feature/schema.ts`, canonical)

```ts
import { z } from 'zod';

export const KEY = /^[a-z][a-z0-9_]{1,40}$/;
export const NavRoleKey = z.enum(['department_head','deputy_head','instructor','committee_member','student_rep','student','lab_staff','admin']); // membership roles + global admin
export const RoleKey    = z.enum([...NavRoleKey.options, 'committee_chair']);                                                              // + RoleGrant-only derived roles
export const NavGroup = z.enum(['operations','academic','people','communication','planning','resources','admin']);
export const ScopeLevel = z.enum(['faculty','department','program','section']);
// mirrors enums.prisma SubjectType (merged list: P1 ∪ prismaSchema, with feature_step_instance); publish additionally checks SubjectRegistry.types()
export const SubjectTypeKey = z.enum(['person','group','committee','course','course_offering','section_offering','section','program','term','academic_year','calendar_period','enrollment','resource','asset','meeting','thread','comment','campaign','campaign_invitation','form_definition','submission','template','availability_block','document','feature_definition','feature_record','feature_step_instance','task','import_batch','exam_session','lab_session','report','generated_report']);
export const CalendarPeriodKind = z.enum(['registration','add_drop','course_preference','elective_selection','teaching','examination','portfolio_submission','evaluation','custom']);
export const TaskKind = z.enum(['general','committee_task','department_task','instructor_task','student_activity','administrative','action_item','case','student_issue','planned_activity','cqi_action','maintenance','lab_activity','feature_step']);
export const PermissionLevel = z.enum(['full','manage','review','own','assigned','participate','limited','view','submit','none']);

// ---- who may act / who is assigned -------------------------------------------------
const actorVariants = {
  owner:        z.object({ type: z.literal('owner') }),
  creator:      z.object({ type: z.literal('creator') }),
  assignee:     z.object({ type: z.literal('assignee') }),                   // assignee of the current step (person, or member of the assigned group)
  role:         z.object({ type: z.literal('role'), roles: z.array(RoleKey).min(1), scope: z.enum(['department','parent']).default('department') }),
  relationship: z.object({ type: z.literal('relationship'), rel: z.enum(['parent_owner','parent_chair','parent_member','requester','reviewer','participant','section_rep','teaching_staff_of_parent']) }),
  permission:   z.object({ type: z.literal('permission'), key: z.string() }), // explicit key, e.g. 'portfolio.review', 'committee.manage'
  person:       z.object({ type: z.literal('person'), personId: z.string() }),
  group:        z.object({ type: z.literal('group'), groupId: z.string() }),
  record_field: z.object({ type: z.literal('record_field'), fieldKey: z.string() }), // person_picker/group_picker header field
  system:       z.object({ type: z.literal('system') }),                     // auto actions only
};
export const ActorRule    = z.discriminatedUnion('type', Object.values(actorVariants) as any);
export const AssigneeRule = z.discriminatedUnion('type', [actorVariants.owner, actorVariants.creator, actorVariants.role, actorVariants.relationship, actorVariants.person, actorVariants.group, actorVariants.record_field] as any);

export const AudienceSpec = z.object({ roles: z.array(RoleKey).optional(), groups: z.array(z.string()).optional(), programs: z.array(z.string()).optional(), yearLevels: z.array(z.number().int()).optional(), sections: z.array(z.string()).optional(), sectionOfferings: z.array(z.string()).optional(), teachingIn: z.string().optional(), persons: z.array(z.string()).optional(), excludePersons: z.array(z.string()).optional() });
export const AudienceRef = z.union([
  z.enum(['assignee','owner','creator','parent_owner','parent_members','parent_chair','requester','participants','all_step_assignees']),
  z.string().regex(/^role:[a-z_]+$/),
  z.object({ audienceSpec: AudienceSpec }),
  z.object({ recordField: z.string() }),                                    // audience picker field on the record header
]);

// ---- fields / questions --------------------------------------------------------------
export const FieldType = z.enum(['short_text','long_text','number','date','datetime','boolean','single_choice','multi_choice','likert','scale','person_picker','group_picker','course_picker','offering_picker','section_picker','term_picker','resource_picker','task_picker','record_picker','audience_picker','ranked_list','file','repeating_group','section_header','computed']);
export const SourceBinding = z.enum(['offerings_in_term','courses_in_program','electives_in_campaign','own_enrollments','staff_in_department','tasks_in_context','members_of_parent','prior_cqi_items','resources_of_kind','records_of_feature','participants_of_parent']);
export type FieldDef = { key: string; label: string; help?: string; type: z.infer<typeof FieldType>; required: boolean; options?: {value:string;label:string}[]; sourceBinding?: z.infer<typeof SourceBinding>; bindingArgs?: Record<string,unknown>; validation?: {min?:number;max?:number;regex?:string;maxRank?:number;maxItems?:number;accept?:string[]}; defaultValue?: unknown; children?: FieldDef[]; computedBy?: string; readOnly?: boolean; visibleTo?: z.infer<typeof ActorRule>[]; recordPicker?: { featureKey: string; presetKey?: string; states?: string[] } };
export const FieldDef: z.ZodType<FieldDef> = z.lazy(() => z.object({
  key: z.string().regex(KEY), label: z.string().min(1), help: z.string().optional(),
  type: FieldType, required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  sourceBinding: SourceBinding.optional(), bindingArgs: z.record(z.string(), z.unknown()).optional(),
  validation: z.object({ min: z.number().optional(), max: z.number().optional(), regex: z.string().optional(), maxRank: z.number().int().optional(), maxItems: z.number().int().optional(), accept: z.array(z.string()).optional() }).optional(),
  defaultValue: z.unknown().optional(),
  children: z.array(FieldDef).optional(),           // repeating_group only
  computedBy: z.string().optional(),                // adapter key (hook 'compute'); implicitly locked
  readOnly: z.boolean().optional(), visibleTo: z.array(ActorRule).optional(),
  recordPicker: z.object({ featureKey: z.string(), presetKey: z.string().optional(), states: z.array(z.string()).optional() }).optional(),
}));

// ---- deadlines, reminders, notifications, attachments --------------------------------
export const DeadlineRule = z.discriminatedUnion('rule', [
  z.object({ rule: z.literal('fixed'),    at: z.string().datetime() }),
  z.object({ rule: z.literal('relative'), offsetDays: z.number().int(), from: z.enum(['step_entered','record_created','parent_deadline','record_field']), fieldKey: z.string().optional(), hours: z.number().int().optional() }),
  z.object({ rule: z.literal('calendar'), periodKind: CalendarPeriodKind, edge: z.enum(['start','end']), offsetDays: z.number().int().default(0), termFrom: z.enum(['current_term','record_field','parent']).default('current_term'), fieldKey: z.string().optional() }),
]);
export const ReminderRule = z.object({ scheduleKey: z.string(), audience: z.enum(['assignee','owner','both']).default('assignee'), escalateToRole: RoleKey.optional() });
export const NotificationRule = z.object({ templateKey: z.string(), to: AudienceRef, category: z.string().default('assignment'), ackRequired: z.boolean().default(false), declinable: z.boolean().default(false), channels: z.array(z.enum(['in_app','email','sms'])).optional(), dedupe: z.boolean().default(true) });
export const AttachmentSlot = z.object({ slotKey: z.string().regex(KEY), label: z.string(), required: z.boolean().default(false), accept: z.array(z.string()).default(['application/pdf','image/*','.docx','.xlsx']), maxFiles: z.number().int().min(1).default(5) });

// ---- actions / transitions ------------------------------------------------------------
export const AutoRule = z.discriminatedUnion('when', [
  z.object({ when: z.literal('deadline') }),                                  // fires at the step deadline
  z.object({ when: z.literal('field_datetime'), fieldKey: z.string() }),      // e.g. campaign opensAt/closesAt, announcement expiresAt
  z.object({ when: z.literal('after_days'), days: z.number().int().min(1).optional(), settingKey: z.string().optional() }), // e.g. case auto-close (SystemSetting case.autoCloseDays)
  z.object({ when: z.literal('event'), eventName: z.string(), match: z.record(z.string(), z.string()).optional() }), // e.g. campaign.closed -> load_cycle close_preferences
]);
export const ActionDef = z.object({
  key: z.string().regex(KEY), label: z.string(),
  kind: z.enum(['submit','approve','reject','request_revision','complete','cancel','reopen','assign','custom','auto']),
  to: z.string(),                        // step key | group key | parallel key | terminal key | '$next' | '$self'
  actors: z.array(ActorRule).min(1),
  requiredComment: z.boolean().default(false),
  requiredFields: z.array(z.string()).default([]),       // question keys of this step's form or record field keys
  requiredAttachments: z.array(z.string()).default([]),  // slotKeys of this step
  guards: z.array(z.string()).default([]),               // adapter keys (hook 'guard'); 'feature.actorAllowed','feature.stepComplete' are always prepended
  effects: z.array(z.string()).default([]),              // adapter keys (hook 'effect') run after the built-in effects
  permission: z.string().optional(),                     // explicit key; default `feature.<featureKey>.act.<actionKey>`
  confirm: z.object({ title: z.string(), message: z.string() }).optional(),
  auto: AutoRule.optional(),                             // only when kind === 'auto'
  reassignTo: AssigneeRule.optional(),                   // only when kind === 'assign'
});

// ---- step tree ------------------------------------------------------------------------
export const StepDef = z.object({
  kind: z.literal('step'), key: z.string().regex(KEY), label: z.string(), description: z.string().optional(),
  stepType: z.enum(['form','review','upload','adapter','wait']).default('form'),
  form: z.object({ sectionTitle: z.string(), questions: z.array(FieldDef), formKey: z.string().optional() /* reuse an existing FormDefinition instead of inline questions */ }).nullable().default(null),
  attachments: z.array(AttachmentSlot).default([]),
  assignee: AssigneeRule,
  actions: z.array(ActionDef).min(1),
  deadline: DeadlineRule.optional(),
  reminders: ReminderRule.optional(),
  notifications: z.object({ onEnter: z.array(NotificationRule).default([]), onExit: z.array(NotificationRule).default([]) }).default({ onEnter: [], onExit: [] }),
  canView: z.array(ActorRule).default([{ type: 'owner' }, { type: 'assignee' }]),
  canEdit: z.array(ActorRule).default([{ type: 'assignee' }]),
  adapter: z.object({ onEnter: z.string().optional(), onExit: z.string().optional(), compute: z.string().optional(), validate: z.string().optional() }).optional(), // implicitly locked
  surface: z.string().optional(),        // key into surfaces[featureKey].stepRenderers; implicitly locked
  workItem: z.object({ createTask: z.boolean().default(true), priority: z.enum(['low','normal','high','urgent']).default('normal') }).default({ createTask: true, priority: 'normal' }),
});
export type StepNode = z.infer<typeof StepDef> | { kind: 'group'; key: string; label: string; steps: StepNode[] } | { kind: 'parallel'; key: string; label: string; branches: any; completion: any; onComplete: string; onAnyReject?: string };
export const StepGroup: z.ZodType<any> = z.lazy(() => z.object({
  kind: z.literal('group'), key: z.string().regex(KEY), label: z.string(),
  steps: z.array(StepNode).min(1),       // sequential sub-steps; '$next' inside resolves to the next sibling, at the end to the group's own '$next'
}));
export const Branch: z.ZodType<any> = z.lazy(() => z.object({ key: z.string().regex(KEY), label: z.string(), steps: z.array(StepNode).min(1) }));
export const CompletionRule = z.discriminatedUnion('rule', [ z.object({ rule: z.literal('all') }), z.object({ rule: z.literal('quorum'), n: z.number().int().min(1) }), z.object({ rule: z.literal('any') }) ]);
export const ParallelGroup: z.ZodType<any> = z.lazy(() => z.object({
  kind: z.literal('parallel'), key: z.string().regex(KEY), label: z.string(),
  branches: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('static'),  items: z.array(Branch).min(2) }),
    z.object({ mode: z.literal('dynamic'), perPerson: AssigneeRule, branch: Branch }),   // one branch per resolved person (e.g. every meeting participant)
  ]),
  completion: CompletionRule,
  onComplete: z.string(),                // step/group/terminal key or '$next'
  onAnyReject: z.string().optional(),    // where a branch action of kind 'reject' | 'request_revision' sends the whole record; siblings become SKIPPED
}));
export const StepNode: z.ZodType<StepNode> = z.lazy(() => z.discriminatedUnion('kind', [StepDef, StepGroup, ParallelGroup] as any));

// ---- views, counters, report ----------------------------------------------------------
export const ListView = z.object({
  key: z.string().regex(KEY), label: z.string(),
  columns: z.array(z.object({ field: z.string() /* record field | 'number' | 'title' | 'state' | 'assignee' | 'owner' | 'deadline' | 'parent' | 'createdAt' | `answer:<stepKey>.<questionKey>` */, label: z.string(), sortable: z.boolean().default(true) })).min(1),
  filters: z.array(z.object({ field: z.string(), type: z.enum(['state','person','date_range','select','text','parent','mine','overdue','preset']) })).default([]),
  defaultSort: z.object({ field: z.string(), dir: z.enum(['asc','desc']) }).default({ field: 'createdAt', dir: 'desc' }),
  visibleRoles: z.array(NavRoleKey).optional(), where: z.object({ states: z.array(z.string()).optional(), presetKey: z.string().optional() }).optional(),
});
export const Counter = z.object({ key: z.string().regex(KEY), label: z.string(), where: z.object({ states: z.array(z.string()).optional(), assignedToMe: z.boolean().optional(), ownedByMe: z.boolean().optional(), overdue: z.boolean().optional(), parentMine: z.boolean().optional(), presetKey: z.string().optional() }), roles: z.array(RoleKey), link: z.string() /* listView key */, tone: z.enum(['neutral','warning','danger']).default('neutral') });
export const ReportDef = z.object({ key: z.string().regex(KEY), title: z.string(), formats: z.array(z.enum(['pdf','xlsx','csv','html'])).min(1), templateKey: z.string(), dataSource: z.enum(['records','records_with_answers']).or(z.string() /* adapter key hook 'export' (locked) */), parameters: z.array(FieldDef).default([]), requiredPermission: z.string().optional() });

// ---- root -----------------------------------------------------------------------------
export const FeatureDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().regex(KEY), name: z.string().min(2), description: z.string().optional(),
  labels: z.object({ singular: z.string(), plural: z.string() }),
  navigation: z.object({ group: NavGroup, order: z.number().int(), icon: z.string() /* lucide */, visibleRoles: z.array(NavRoleKey).min(1), showInDashboard: z.boolean().default(true), showCounterInNav: z.boolean().default(false) }),
  scope: z.object({ level: ScopeLevel, scopeFrom: z.enum(['department','parent','record_field']).default('department'), fieldKey: z.string().optional() }),
  parentSubject: z.object({ subjectType: SubjectTypeKey, featureKey: z.string().optional() /* when subjectType='feature_record' */, relation: z.string().default('parent'), required: z.boolean().default(true), inheritPermissions: z.boolean().default(true), listUnderParent: z.boolean().default(true), createFromParent: z.boolean().default(true), allowedTypes: z.array(SubjectTypeKey).optional() /* polymorphic optional parents, e.g. task context */ }).optional(),
  record: z.object({
    numberPrefix: z.string().regex(/^[A-Z]{1,4}$/),              // F-CR-2026-0012
    titleTemplate: z.string(),                                    // mustache over record fields + parent variables
    fields: z.array(FieldDef),
    canCreate: z.array(ActorRule).min(1),
    ownerRule: AssigneeRule.default({ type: 'creator' }),
    backing: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('feature_record') }),
      z.object({ kind: z.literal('task'), taskKind: TaskKind, extension: z.enum(['case','planned_activity']).optional() }),   // the record IS the Task row
      z.object({ kind: z.literal('module'), adapter: z.string() }),                                                         // module row created by a 'backing' adapter (Portfolio, Meeting, Campaign, ...)
    ]).default({ kind: 'feature_record' }),
  }),
  presets: z.record(z.string().regex(KEY), z.object({                // "kind presets" (campaign kinds, task kinds, import kinds)
    label: z.string(), description: z.string().optional(),
    fieldDefaults: z.record(z.string(), z.unknown()).default({}),   // locked values written into record.data (e.g. kind='add_drop')
    formKeys: z.record(z.string(), z.string()).default({}),         // stepKey -> FormDefinition key override
    adapters: z.record(z.string(), z.string()).default({}),         // `<stepKey>.<hook>` or `<stepKey>.<actionKey>.guard|effect` -> adapter key
    permissionPrefix: z.string().optional(),                        // '{prefix}.{action}' with fallback to the feature key (evaluation.close)
    parentSubjectType: SubjectTypeKey.optional(),                   // per-preset parent (import_batch)
    visibleRoles: z.array(NavRoleKey).optional(), navLabel: z.string().optional(),
  })).default({}),
  steps: z.array(StepNode).min(1),                                  // ordered tree; first leaf is the initial state
  terminalStates: z.array(z.object({ key: z.string().regex(KEY), label: z.string(), category: z.enum(['success','rejected','cancelled']), notifications: z.array(NotificationRule).default([]), effects: z.array(z.string()).default([]) })).min(1),
  listViews: z.array(ListView).min(1),
  dashboardCounters: z.array(Counter).default([]),
  report: ReportDef.optional(),
  permissions: z.object({ defaults: z.record(RoleKey, PermissionLevel) }),
  lockedPaths: z.array(z.string().regex(/^\/.*/)).default([]),      // JSON pointers (RFC 6901) into this document; merged with implicit locks
});
export type FeatureDefinition = z.infer<typeof FeatureDefinitionSchema>;
```

Resolution of `to`: `'$next'` = next sibling leaf in the same container (group/branch/top level); at the end of a group or branch it becomes the container's `$next` (a branch end resolves to the synthetic `<parallel>.<branch>.$done`); at the end of the top-level list it is an error (`NEXT_UNRESOLVED`) unless the last node is followed by a terminal via explicit `to`. `'$self'` re-enters the same step (used by `extend`, `regenerate`).

## 2. Prisma models (`prisma/schema/feature.prisma`; enums in `prisma/schema/enums.prisma`; snake_case `@@map/@map` on every model and column)

```prisma
enum FeatureVersionStatus   { DRAFT PUBLISHED RETIRED }
enum FeatureStepStatus      { PENDING ACTIVE DONE SKIPPED REJECTED }
enum FeatureMigrationStatus { PLANNED RUNNING DONE FAILED BLOCKED }
enum AdapterHook            { guard effect on_enter on_exit compute validate auto backing export source_binding relationship projection }

model FeatureDefinition {
  id              String   @id @default(cuid())
  key             String
  departmentId    String?  @map("department_id")  // NULL = faculty-wide (built-ins, admin faculty definitions); a department row with the same key shadows it
  name            String
  description     String?
  icon            String
  navGroup        String   @map("nav_group")
  navOrder        Int      @map("nav_order")
  scopeLevel      ScopeType @map("scope_level")
  isSystem        Boolean  @default(false) @map("is_system")
  activeVersionId String?  @unique @map("active_version_id")
  activeVersion   FeatureDefinitionVersion? @relation("ActiveVersion", fields: [activeVersionId], references: [id])
  versions        FeatureDefinitionVersion[] @relation("Versions")
  records         FeatureRecord[]
  createdBy       String   @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  @@unique([key, departmentId])                 // + partial unique index feature_definition_key_global(key) WHERE department_id IS NULL (hand-written in the P9 `<ts>_constraints_p9` migration)
  @@index([departmentId, navGroup, navOrder])
  @@map("feature_definition")
}
model FeatureDefinitionVersion {
  id                   String  @id @default(cuid())
  definitionId         String  @map("definition_id")
  definition           FeatureDefinition @relation("Versions", fields: [definitionId], references: [id])
  version              Int
  status               FeatureVersionStatus
  json                 Json                     // the validated FeatureDefinition aggregate
  compiledJson         Json?   @map("compiled_json")   // CompiledFeature (artefact ids, taskTemplates, reminderTemplates, permissionKeys, grantRequirements, stateIndex)
  jsonHash             String  @map("json_hash")       // sha256 of canonical JSON
  lockedHash           String  @map("locked_hash")     // sha256 of the locked subtree (section 9) — the seed baseline comparison
  changeNote           String? @map("change_note")     // 'seed:<lockedHash>' | 'seed-upgrade:<lockedHash>' | admin text
  workflowDefinitionId String? @map("workflow_definition_id")  // WorkflowDefinition row compiled for this version
  publishedAt          DateTime? @map("published_at")
  publishedBy          String?   @map("published_by")
  createdBy            String    @map("created_by")
  createdAt            DateTime  @default(now()) @map("created_at")
  @@unique([definitionId, version])
  @@map("feature_definition_version")
}
model FeatureRecord {
  id                  String   @id @default(cuid())
  departmentId        String   @map("department_id")
  definitionId        String   @map("definition_id")
  definition          FeatureDefinition @relation(fields: [definitionId], references: [id])
  definitionVersionId String   @map("definition_version_id")   // PINNED version; the runtime renders from this version's json
  number              String                    // F-<prefix>-<year>-<seq>
  title               String
  data                Json                      // record header fields (+ locked ids written by backing adapters: taskId, portfolioId, campaignId, ...)
  presetKey           String?  @map("preset_key")
  parentSubjectType   SubjectType? @map("parent_subject_type")
  parentSubjectId     String?  @map("parent_subject_id")
  scopeType           ScopeType @map("scope_type")
  scopeId             String?  @map("scope_id")
  ownerPersonId       String   @map("owner_person_id")
  createdByPersonId   String   @map("created_by_person_id")
  workflowInstanceId  String   @unique @map("workflow_instance_id")
  currentStateKey     String   @map("current_state_key")   // DERIVED CACHE of WorkflowInstance.currentState; written only by feature.enterStep/exitStep/setTerminal effects
  branchStatesCache   Json?    @map("branch_states_cache") // DERIVED CACHE of WorkflowInstance.branchStates while inside a parallel group
  deadlineAt          DateTime? @map("deadline_at")        // derived: deadline of the active step (earliest across branches)
  firstEditedAt       DateTime? @map("first_edited_at")
  closedAt            DateTime? @map("closed_at")          // derived: set by feature.setTerminal
  taskId              String?  @unique @map("task_id")     // when record.backing.kind = 'task'
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")
  steps               FeatureStepInstance[]
  @@unique([departmentId, number])
  @@index([departmentId, definitionId, currentStateKey])
  @@index([parentSubjectType, parentSubjectId])
  @@index([departmentId, ownerPersonId])
  @@index([departmentId, deadlineAt])
  @@index([data(ops: JsonbPathOps)], type: Gin)
  @@map("feature_record")
}
model FeatureStepInstance {
  id                  String   @id @default(cuid())
  departmentId        String   @map("department_id")
  recordId            String   @map("record_id")
  record              FeatureRecord @relation(fields: [recordId], references: [id], onDelete: Cascade)
  stepKey             String   @map("step_key")
  groupKey            String?  @map("group_key")     // enclosing parallel group key
  branchKey           String?  @map("branch_key")    // static branch key or personId for dynamic branches
  sequence            Int      @default(1)           // nth entry into this step (revision loops)
  status              FeatureStepStatus
  assigneeType        String?  @map("assignee_type") // 'person' | 'group'
  assigneeId          String?  @map("assignee_id")
  taskId              String?  @unique @map("task_id")        // Task(kind=feature_step) backing this step (NULL for task-backed features)
  submissionId        String?  @unique @map("submission_id")  // Form engine standalone Submission for this step
  deadlineAt          DateTime? @map("deadline_at")
  enteredAt           DateTime @default(now()) @map("entered_at")
  completedAt         DateTime? @map("completed_at")
  completedByPersonId String?   @map("completed_by_person_id")
  outcomeActionKey    String?   @map("outcome_action_key")
  @@unique([recordId, stepKey, branchKey, sequence])
  @@index([departmentId, assigneeType, assigneeId, status])
  @@index([departmentId, status, deadlineAt])
  @@map("feature_step_instance")
}
model FeatureNumberSequence { departmentId String @map("department_id"); definitionId String @map("definition_id"); year Int; next Int @default(1)  @@id([departmentId, definitionId, year]) @@map("feature_number_sequence") }
model FeatureMigration {
  id              String   @id @default(cuid())
  departmentId    String   @map("department_id")   // one migration run per department (RLS); faculty admin starts one per department from the wizard
  definitionId    String   @map("definition_id")
  fromVersionId   String   @map("from_version_id")
  toVersionId     String   @map("to_version_id")
  stateMap        Json     @map("state_map")   // { "<oldState|group.branch.state>": "<newState>" | "$block" }
  stepMap         Json     @map("step_map")    // { "<oldStepKey>": "<newStepKey>" } used to carry submissions/attachments forward
  plan            Json                          // preview: counts per current state, blocked states, warnings
  status          FeatureMigrationStatus
  recordsTotal    Int      @default(0) @map("records_total")
  recordsMigrated Int      @default(0) @map("records_migrated")
  recordsBlocked  Int      @default(0) @map("records_blocked")
  blockedIds      Json?    @map("blocked_ids")  // record ids the map cannot place (stay pinned to fromVersion)
  pgBossJobId     String?  @map("pg_boss_job_id")
  startedBy       String   @map("started_by")
  startedAt       DateTime? @map("started_at")
  finishedAt      DateTime? @map("finished_at")
  error           String?
  @@index([departmentId, definitionId, status])
  @@map("feature_migration")
}
model AdapterRegistration {                     // refreshed at boot by web and worker from AdapterRegistry; admin listing + publish-time existence check
  key          String      @id
  module       String
  hook         AdapterHook
  description  String
  simulable    Boolean     @default(false)
  version      Int         @default(1)
  registeredAt DateTime    @updatedAt @map("registered_at")
  @@map("adapter_registration")
}
```
Schema changes elsewhere that this part requires (owned by the schema part; stated here so seeds are consistent): `enums.prisma` `SubjectType` is the merged list of section 1 (`feature_record`, `feature_step_instance`, never `feature_step_run`); `TaskKind` gains `feature_step`; `PermissionLevel` uses `none`; `Task` gains `featureRecordId String? @unique` and `featureStepInstanceId String? @unique` (Task has no `workflowInstanceId`; the workflow subject of a task-backed feature is its FeatureRecord); `WorkflowInstance` gains `branchStates Json?`; module rows (`Portfolio`, `CQIReport`, `Campaign`, `Appointment`, `Meeting`, `Committee`, `CommitteeReport`, `AnnualPlan`, `QuarterlyReport`, `ExamSchedule`, `LabSchedule`, `LoadCycle`, `ImportBatch`, `Announcement`, `CourseOffering`) carry `featureRecordId String @unique` **instead of** `workflowInstanceId` (files `committee.prisma`, `portfolio.prisma`, `meeting.prisma`, `planning.prisma`, `scheduling.prisma`, `load.prisma`, `notification.prisma`, `academic.prisma`) — the FeatureRecord is always the workflow subject (`subjectType='feature_record'`), which is what lets one runtime, one inbox and one counter query serve every built-in. Counters are grouped-count queries (section 8); there is no `FeatureCounterCache`.

## 2b. Workflow State/Transition JSON contract (single definition; `src/platform/workflow/schema.ts`; prismaSchema §6 `WorkflowDefinition.statesJson/transitionsJson` and P4 `parallel.ts` copy this verbatim)

```ts
export const StateCategory = z.enum(['initial','active','waiting','terminal']);
export const BranchSpec = z.object({ key: z.string(), label: z.string(), initialState: z.string(), states: z.array(z.string()), doneState: z.string(), rejectedState: z.string() });
export const WorkflowStateJson = z.object({
  key: z.string(), label: z.string(), category: StateCategory, slaHours: z.number().optional(),
  terminalCategory: z.enum(['success','rejected','cancelled']).optional(),
  compound: z.object({ branches: z.array(BranchSpec), completion: CompletionRule /* all | quorum(n) | any */, dynamic: z.boolean().default(false), onComplete: z.string(), onReject: z.string().optional() }).optional(),
});
export const EffectSpec = z.object({ kind: z.enum(['notify','emit','createTask','setField','invokeHandler','registerBlocks','scheduleAutoTransition','cancelScheduled','feature']), args: z.record(z.string(), z.unknown()).default({}) });
export const WorkflowTransitionJson = z.object({
  key: z.string(), from: z.string() /* one source; multi-source actions compile to one transition per source */, to: z.string(), action: z.string(),
  branch: z.string().optional() /* set when `from` is a branch state of a compound state; '$person' for dynamic branches */, system: z.boolean().default(false),
  requiredPermission: z.string().optional(), actorRules: z.array(ActorRule).default([]),
  requiredComment: z.boolean().default(false), requiredFields: z.array(z.string()).default([]), requiredAttachments: z.array(z.string()).default([]),
  guards: z.array(z.string()).default([]), effects: z.array(EffectSpec).default([]),
});
// WorkflowInstance.currentState: string; WorkflowInstance.branchStates: Record<branchKey, { state: string; enteredAt: string; status: 'active'|'done'|'rejected'|'skipped' }> | null
```
Engine semantics (P4 `parallel.ts`): while `currentState` is a compound state, `apply(instanceId, transitionKey, actor, { branchKey })` moves `branchStates[branchKey].state`; when a branch reaches its `doneState` the engine evaluates `completion` over `branchStates` and auto-applies the synthetic system transition `<group>.$join` (`from: group, to: compound.onComplete, guard feature.parallelComplete`); when a branch reaches `rejectedState` and `onReject` is set it auto-applies `<group>.$reject` (`to: onReject`) and marks the other branches `skipped`. Dynamic compound states carry one `BranchSpec` with `key: '$person'`; `start`/`enterParallel` instantiates `branchStates` per resolved person id. There is no `joinPolicy`, `parallel.join`, `branchStateJson` or `from: string[]` anywhere.

## 3. Compile at publish (`compile(def, ctx) -> CompiledFeature`, pure, snapshot-tested)

```ts
type CompiledFeature = {
  workflow: WorkflowDefinitionInput;                       // key `feature:<key>`, subjectType 'feature_record', statesJson/transitionsJson per section 2b
  forms: Record<string /*stepKey|'record'*/, FormDefinitionInput>;
  taskTemplates: Record<string /*stepKey*/, TaskTemplate>;
  reminderTemplates: Record<string /*stepKey*/, ReminderTemplate>;
  permissionKeys: string[]; rolePermissions: { roleKey; permissionKey; level }[];
  grantRequirements: { stepKey; actionKey?; roleKey; scopeType; derivedFrom: string }[];   // RoleGrant rows the actor rules rely on (validated + simulated, never created here)
  report?: ReportDefinitionInput;
  stateIndex: Record<string, { kind: 'step'|'parallel'|'terminal'; path: string /* JSON pointer */; groupKey?; branchKey? }>;
  nextMap: Record<string, string>;                         // resolved '$next' per leaf
  locks: string[];                                         // explicit + implicit locked pointers
};
```
Algorithm (each step is a named function in `compile.ts`, unit-tested in isolation):
1. **normalise**: `FeatureDefinitionSchema.parse(json)` (applies defaults); `deriveImplicitLocks(def)` (section 9) merged into `locks`.
2. **flattenGroups**: depth-first walk producing an ordered leaf list per container; `StepGroup` nodes contribute no state — only ordering and `$next` scope. Group membership is kept in `stateIndex[stepKey].path` for the timeline UI.
3. **resolveNext**: builds `nextMap` (rules in section 1). Errors become validation issues (`NEXT_UNRESOLVED`).
4. **states**: every leaf `StepDef` -> `WorkflowStateJson { key: step.key, label, category: index===0 ? 'initial' : (stepType==='wait' ? 'waiting' : 'active'), slaHours? }`; every `ParallelGroup` -> one **compound** state `{ key: group.key, category: 'waiting', compound: { branches: [...], completion, dynamic: branches.mode==='dynamic', onComplete: resolve(onComplete), onReject: resolve(onAnyReject) } }` whose `BranchSpec.states` are the branch's leaf steps plus synthetic `<group>.<branch>.$done` (doneState) and `<group>.<branch>.$rejected` (rejectedState); dynamic groups compile one `BranchSpec` with `key: '$person'`; terminals -> `{ key, label, category: 'terminal', terminalCategory }`.
5. **transitions**: for each leaf step and each action: `WorkflowTransitionJson { key: `${stepKey}.${actionKey}`, from: stepKey, to: resolve(action.to), action: actionKey, branch?: branchKey, requiredPermission: action.permission ?? `feature.${key}.act.${actionKey}` (or `{preset.permissionPrefix}.${actionKey}` with fallback when any preset declares `permissionPrefix`), actorRules: action.actors, requiredComment, requiredFields, requiredAttachments, guards: ['feature.actorAllowed','feature.stepComplete', ...action.guards], effects: [ feature.exitStep, ...notifications.onExit.map(notify), ...action.effects.map(invokeHandler), enterEffect(to) ] }` where `enterEffect(to)` is `feature.enterStep(to)` | `feature.enterParallel(to)` | `feature.setTerminal(to)` (+ terminal notifications/effects) | `feature.completeBranch` when `to` is `<group>.<branch>.$done`. A `reject`/`request_revision` action inside a branch whose parallel group declares `onAnyReject` compiles to `to: <group>.<branch>.$rejected` + effect `feature.rejectBranch`; the engine's `$reject` then enters `onAnyReject` and marks siblings SKIPPED. Every compound state gets the two synthetic system transitions `<group>.$join` and `<group>.$reject` (section 2b).
6. **auto actions**: `kind:'auto'` compiles to a `scheduleAutoTransition` effect on entering the step (`when: deadline|field_datetime|after_days` -> `ScheduledJob` idempotency key `feature_step_instance:<id>:auto:<actionKey>`, worker queue `workflow.auto_transition` (`apps/worker/src/handlers/workflow.auto_transition.ts`) calling `Workflow.apply` as system) or to an outbox subscription (`when:'event'` -> handler key `feature.autoOnEvent:<featureKey>:<stepKey>:<actionKey>`, idempotent via `EventHandlerReceipt`). Leaving the step emits `cancelScheduled` by key prefix.
7. **forms**: each leaf with inline questions -> `FormDefinition { key: `${key}.${stepKey}`, kind: 'feature_step' }`; record header -> `${key}.record`; `formKey` references are validated to exist and be published. A new FormDefinition version is created only when the question hash changed (`questionsHash` compare), otherwise the existing version is pinned in `compiledJson.forms[stepKey].versionId`.
8. **taskTemplates** for **every** leaf step (not only reviews): `{ kind: 'feature_step', titleTemplate: '{{feature_name}}: {{step_label}} — {{record_title}}', assigneeRule, priority, expectedDeliverables: attachments.map(a => ({ key: a.slotKey, label, required })), deadlineRule, reminderScheduleKey, contextRef: 'feature_record' }`. For `record.backing.kind='task'` the templates are emitted with `createTask:false` and the runtime instead updates `TaskAssignment` of the record's own Task on step entry.
9. **reminderTemplates** per step with a deadline: `{ deadlineSpec: fixed|relative|{periodKind,edge,offsetDays}, scheduleKey, audience, escalateToRole }`, instantiated on step entry via `Scheduler.subscribeReminders(subjectRef=feature_step_instance:<id>)` (P5 materialises `ScheduledJob` rows synchronously inside `subscribeReminders`).
10. **permissions**: emits `feature.<key>.view|create|manage` + one key per action (default or explicit) + per-preset keys `<prefix>.<action>`; `rolePermissions` from `permissions.defaults` (level per role) — existing rows for explicit keys such as `portfolio.review` are left untouched (seeded matrix wins); relationship levels (`own`, `assigned`, `participate`, `limited`) are evaluated live through `SubjectRegistry.relationships('feature_record')`, no rows. **grantRequirements**: every `relationship` actor/assignee rule and every `role` rule with `scope:'parent'` records the derived RoleGrant it relies on (`parent_member` -> `COMMITTEE_MEMBER@committee`, `parent_chair` -> `COMMITTEE_CHAIR@committee`, `section_rep` -> `STUDENT_REP@section`, `teaching_staff_of_parent` -> `INSTRUCTOR@section_offering`, lab parents -> `LAB_STAFF@lab_schedule`); validation (`GRANT_SOURCE`) checks the parent type can produce that grant, simulate reports which grant the actor would need.
11. **report**: `ReportDefinition { key: `feature.${key}.${report.key}`, dataSourceKey: 'feature.records' | 'feature.records_with_answers' | adapterKey, templateKey, formats, parametersSchemaJson: zodFromFields(parameters), requiredPermission }`.
12. **nav/list/counters** are read from `json` at request time (no artefact).

`publishVersion(definitionId, versionId, actor)` is one transaction (`withTenantBypass` for faculty-wide definitions): `validateDefinition` (0 errors) -> `compile` -> upsert `WorkflowDefinition` (new version), FormDefinitions, Permission/RolePermission rows, ReportDefinition -> write `compiledJson`, `status=PUBLISHED`, `publishedAt/By`, `FeatureDefinition.activeVersionId` -> `Audit.record(actor,'publish', feature_definition)` -> `DomainEvent feature.published { key, version }` (handlers: nav cache bust `updateTag('nav:<dept>')`, AdapterRegistration refresh, search doc).

## 4. Validation rules (`validateDefinition(def, ctx) -> Issue[]`, `Issue = { code, path, severity: 'error'|'warning', message }`; `tests/unit/feature/validate.test.ts` holds one failing fixture per code; these codes are the only ones)

| Code | Rule |
|---|---|
| KEY_FORMAT | `key`, step/group/branch/action/field/slot/terminal/listView/counter/preset keys match `KEY` |
| KEY_UNIQUE | step keys unique across the whole tree (incl. inside branches); action keys unique per step; terminal keys unique and disjoint from step keys; field keys unique per form and per record |
| INITIAL_IS_STEP | the first leaf of the tree is a `StepDef` (not a parallel group) |
| TO_RESOLVES | every `action.to`, `onComplete`, `onAnyReject` resolves to a step, group, parallel, terminal, `$next` or `$self` |
| NEXT_UNRESOLVED | `$next` at the end of the top-level list |
| REACHABLE | every step and every terminal is reachable from the initial step over transitions (graph BFS incl. `$join`, `$reject`, auto) |
| TERMINAL_EXISTS | at least one terminal with category `success` |
| DEAD_END | a non-terminal step with no outgoing action (warning if it has an `auto` action) |
| ACTOR_PRESENT | every action has >= 1 actor; `system` allowed only on `kind:'auto'`; `auto` actions have `auto`; `after_days` has `days` or `settingKey` |
| ASSIGNEE_RESOLVABLE | `record_field` assignee references a `person_picker`/`group_picker` record field; `relationship` rules that need a parent (`parent_*`, `teaching_staff_of_parent`) require `parentSubject` |
| GRANT_SOURCE | a `relationship` rule's derived grant (compile step 10) can be produced by `parentSubject.subjectType` |
| PARALLEL_BRANCHES | static branches >= 2, each non-empty; quorum `n <= branches` (dynamic: warning, evaluated at runtime); no `ParallelGroup` nested inside a branch (v1) |
| PARALLEL_EXIT | every branch's last leaf reaches `$next` or an explicit `<group>.<branch>.$done`; a branch action may not target a step outside its branch except through `onAnyReject` |
| REVISION_LOOP | `request_revision` targets an earlier step (topological order) or a step marked `stepType:'form'` |
| REQUIRED_FIELDS | `requiredFields` reference questions of that step's form (or record fields) |
| REQUIRED_ATTACHMENTS | `requiredAttachments` reference that step's slots |
| FORM_REF | `form.formKey` exists and is published; inline questions have unique keys; `repeating_group` has children; `computedBy` adapters exist |
| BINDING_ARGS | `sourceBinding` that needs a parent (`members_of_parent`, `tasks_in_context`, `participants_of_parent`) requires `parentSubject`; `records_of_feature`/`recordPicker` name a published feature (and preset) |
| TEMPLATE_EXISTS | every `templateKey` exists (kind message/reminder) and declares only variables from the `feature_record` + `feature_step_instance` variable lists |
| SCHEDULE_EXISTS | every `reminders.scheduleKey` exists |
| DEADLINE_FIELD | `relative.from='record_field'` / `calendar.termFrom='record_field'` / `auto.field_datetime` name a `date`/`datetime` / `term_picker` record field |
| ROLE_EXISTS | `visibleRoles` ⊆ `NavRoleKey`; actor rules, counters, `permissions.defaults` roles ⊆ `RoleKey` and exist in `Role` |
| PARENT_TYPE | `parentSubject.subjectType` (and `allowedTypes`, preset `parentSubjectType`) registered in `SubjectRegistry`; `featureKey` published; no cycle (a feature may not be its own ancestor) |
| SCOPE_CONSISTENT | `scope.level` <= parent's scope level when nested; `scopeFrom:'record_field'` names a program/section picker |
| ADAPTER_EXISTS | every adapter key (guards, effects, adapter.*, computedBy, backing, report dataSource, preset adapters) exists in `AdapterRegistry` with the matching hook |
| SURFACE_EXISTS | `surface` keys exist in `surfaces[featureKey].stepRenderers` |
| PRESET_CONSISTENT | preset `formKeys`/`adapters` reference existing steps; `fieldDefaults` reference record fields; all presets share the same permission prefix scheme |
| LIST_COLUMNS | list columns / counters reference record fields, built-ins or `answer:<step>.<q>` that exist; counter `link` names a list view; counter/list states and presetKeys exist |
| LOCK_VIOLATION | any locked pointer differs from the previous published version (or from the seed baseline for system definitions) |
| BACKING_LOCKED | `record.backing` and `presets.*.adapters` are always locked on `isSystem` definitions |
| WARN_NO_DEADLINE | review/approval steps without a deadline (warning) |
| WARN_NO_NOTIFY | steps with an assignee but no `onEnter` notification and `createTask:false` (warning) |

## 5. Simulate / dry-run (`simulate(def, script) -> SimulationTrace`, no DB writes)

```ts
type SimulationScript = { actor: { roles: RoleKey[]; grantRoleKeys: string[]; relationships: string[]; personId: 'sim-actor' }; parent?: { subjectType; label }; presetKey?; record: Record<string,unknown>; path: Array<{ stepKey; branchKey?; actionKey; answers?; attachments?: string[]; comment?; at?: string }>; dynamicBranchPersons?: string[] };
type SimulationTrace = { states: string[]; branchStates: Record<string, unknown>[]; steps: { stepKey; branchKey?; assignee: string; task: TaskTemplate | null; deadline?: string; reminders: string[] /* offsets */ }[]; notifications: { templateKey; to; renderedSubject }[]; guards: { key; result: 'pass'|'fail'|'would_run' }[]; grantsNeeded: string[]; issues: Issue[] };
```
Uses the compiled definition and an in-memory workflow runner (the same `src/platform/workflow/engine.ts` pure transition function used by the engine, with an in-memory store): built-in guards run for real (required fields/attachments/comment/actor rule/parallel completion); adapters flagged `simulable:true` run against a stub context; others are reported as `would_run`. Reminder offsets are materialised from the deadline rule using a fixed `now` and a sample term. Exposed as wizard step 7 and as `docker compose run --rm test npx tsx scripts/feature-simulate.ts prisma/seed/features/portfolio.ts tests/fixtures/sim/portfolio-happy.json` (`tests/unit/feature/simulate.test.ts` runs a happy and a rejection path for every seeded feature).

## 6. Versioning, instance pinning, migration wizard

- Records pin `definitionVersionId` and `WorkflowInstance.definitionVersion`; the runtime renders forms, actions, timeline and step pages from the pinned version's `json`, so publishing never touches running records.
- "Edit" on a published definition creates version N+1 `DRAFT` (copy of json); only one DRAFT per definition. Publishing compiles as in section 3; the old version becomes `RETIRED` only when no record pins it (`retireVersion` refuses otherwise). Retired versions with zero records may be deleted by the admin.
- **Migration wizard** `/admin/features/[key]/migrate` (three screens): (1) *Diff*: step/terminal keys added, removed, renamed (heuristic by label) between two versions; for every removed or renamed state and every `group.branch.state` the admin picks a target state or `$block`; `stepMap` for carrying `FeatureStepInstance.submissionId`/attachments to renamed steps. (2) *Preview*: `planMigration()` returns counts per current state per department, records that would be blocked, warnings ("target step has required fields the records will not have"). (3) *Run*: `FeatureMigration` rows (one per department, status `PLANNED`) and pg-boss queue `feature.migrate` (`apps/worker/src/handlers/feature.migrate.ts`; singleton key `feature-migrate:<migrationId>`, batches of 200, resumable: the job re-selects records `WHERE definition_version_id = $from`, so re-runs are idempotent). Per record, in one `withTenantTx(departmentId)` transaction: map `currentState` (and each `branchStates` entry), write `WorkflowTransitionLog { transitionKey: 'migrate', payload: { fromVersion, toVersion, stateMap } }`, update `WorkflowInstance.definitionVersion/currentState/branchStates`, `FeatureRecord.definitionVersionId/currentStateKey/branchStatesCache`, rename step instances via `stepMap`, re-subscribe reminders for the new active step, audit. Records whose state maps to `$block` or whose branch set cannot be mapped are counted in `recordsBlocked`/`blockedIds` and stay pinned. Records in terminal states migrate by version pointer only. `tests/integration/feature/versioning.test.ts` covers: publish v2 while v1 records exist, records still act on v1, migrate with a rename, migrate a record inside a parallel group, blocked record stays on v1, re-run is a no-op.

## 7. Admin "create feature" wizard (`src/app/(admin)/admin/features/`)

Routes: `page.tsx` (list: name, key, version, status, system badge, "system update pending" badge when a `seed-upgrade:` DRAFT exists), `new/page.tsx` (wizard on a fresh DRAFT), `[key]/edit/page.tsx` (same wizard on the DRAFT of an existing definition), `[key]/versions/page.tsx`, `[key]/versions/[v]/simulate/page.tsx`, `[key]/migrate/page.tsx`, `[key]/records/page.tsx` (counts per version/state). Server actions in `actions.ts` (all behind `requireAdmin()`): `saveDraftAction(key, patch)` (autosave per screen, `assertLockedPathsUnchanged`), `validateDraftAction`, `simulateDraftAction`, `publishVersionAction`, `retireVersionAction`, `planMigrationAction`, `startMigrationAction`, `cloneDefinitionAction` (copy any published definition, incl. `generic_request`, as a starting point).

Screens (react-hook-form + the Zod sub-schema of that screen; `src/components/admin/feature-wizard/*`):
1. **Identity** — name, key (auto-slug, immutable after publish), singular/plural labels, icon picker, description; "clone from" picker.
2. **Hierarchy** — (a) navigation placement: group, order (drag list of existing entries), visible roles (`NavRoleKey`), dashboard/nav counter toggles; (b) organizational scope: level + where the scope comes from; (c) parent nesting: subject type picker (registered types + published features), relation label, required, inherit permissions, list under parent, create from parent.
3. **Record fields** — field builder (`FieldBuilder`: drag order, type, options, source binding, validation, repeating groups), number prefix, title template with variable list, who may create, owner rule, presets table (for non-system definitions: key/label/field defaults/form overrides).
4. **Steps** — `StepTree` (dnd-kit): add step, add sub-step group, add parallel group (static branches or "one branch per person"), completion rule all / quorum(n) / any; per step a `StepDrawer` with tabs *Form* (inline questions or pick FormDefinition), *Attachments* (slots), *Assignee*, *Actions & transitions* (action table + `TransitionGraph` SVG preview with rejection/revision back-edges highlighted; `auto` actions with their trigger; required fields/attachments/comment per action), *Deadline & reminders* (rule + schedule picker with offset preview), *Notifications* (template picker with variable list, on enter/exit, ack/declinable), *Who may view/edit*. Locked controls render with `LockBadge` ("system-locked: backed by code") and are read-only.
5. **Terminals, lists & counters** — terminal states table; list view builder (columns from record fields/answers, filters, default sort, roles); dashboard counters.
6. **Report** — optional: title, formats, template picker (document/report kinds), data source (records / with answers / locked adapter), parameters.
7. **Validate, simulate & publish** — issues list grouped by screen with deep links; `SimulatePanel` (choose role, preset, parent, scripted actions; shows resulting states, branch states, tasks, notifications, reminders, grants needed per step); Publish enabled at 0 errors (warnings acknowledged); for a published definition the button reads "Publish version N+1" and, when states changed, offers "Plan migration" afterwards.

## 8. Generic runtime binding (summary; routes/DAL in runtimeAndRouting)

- `createRecord(defKey, actor, { data, presetKey, parentRef, scopeRef })`: load active (or department-shadowing) definition, `zodFromFields(record.fields)` validation, resolve owner/scope, number from `FeatureNumberSequence` (`SELECT ... FOR UPDATE`), insert `FeatureRecord`, run backing adapter (`task` -> `WorkItem.createTask` and set `taskId`; `module` -> adapter creates module row with `featureRecordId` and writes locked ids into `data`), `Workflow.start('feature:<key>', feature_record ref)`, `enterStep(firstLeaf)`, audit, `feature.record.created` event.
- `enterStep(record, step, { branchKey })`: `resolveAssignee(rule)` (person or group; `parent_*` via `SubjectRegistry.contextOf(parent)`; `staff_in_department`/role rules through `DepartmentPerson` + `RoleGrant`; dynamic branches pass the branch person), create `FeatureStepInstance ACTIVE` (sequence = previous + 1), `WorkItem.createTask(taskTemplate)` unless task-backed (then `WorkItem.reassign(record.taskId, assignee)`), compute deadline (`Academic.resolveAnchor` for calendar rules), `Scheduler.subscribeReminders`, `scheduleAutoTransition` for auto actions, `Notification.notify(onEnter)`, `adapter.onEnter`, write caches (`currentStateKey`, `deadlineAt`), `SubjectRegistry.onChanged`.
- `enterParallel(record, group)`: creates one ACTIVE step instance per branch head (static) or per resolved person (dynamic; `WorkflowInstance.branchStates[personId]`), each with its own Task.
- `act(recordId, stepKey, actionKey, actor, { answers, comment, branchKey })`: `Identity.can(actor, permissionKey, recordRef)` + actor rules; `FormEngine.saveStandalone(submission, answers)`; `Workflow.apply(instanceId, `${stepKey}.${actionKey}`, actor, { comment, fields, branchKey })` — guards `feature.actorAllowed`, `feature.stepComplete` (required fields via Submission answers, attachments via `Document.listFor(stepInstanceRef,'deliverable',slot)`, comment), adapter guards; effects run in order (exit: mark DONE/REJECTED, complete Task, cancel reminders and auto jobs by prefix, notify onExit; custom effects; enter next / join / terminal).
- `SubjectRegistry.register('feature_record', { label: number + title, contextOf: { departmentId, ownerPersonId, parent's context when inheritPermissions }, relationships: owner|creator|assignee (any ACTIVE step instance, incl. via group)|parent relationships delegated|module relationships via backing adapter (hook `relationship`), variables: {{record_number}} {{record_title}} {{feature_name}} {{step_label}} {{deadline}} {{owner_name}} {{assignee_name}} {{parent_label}} {{link}} {{answer.<step>.<q>}}, url: /d/<dept>/f/<key>/<id>, indexDoc, accessResolver })` and `'feature_step_instance'` (label, contextOf -> record, variables incl. {{step_deadline}}, url -> step page).

## 9. Seeding built-ins, system locks, adapters, surfaces, presets

- `prisma/seed/features/<key>.ts` exports `const def: FeatureDefinition = {...}` (typed, so a schema change breaks the seed at compile time); `prisma/seed/features/index.ts` lists them in dependency order (parents first). `prisma/seed.ts` calls `seedFeatures(db)` after roles, templates, reminder schedules and forms. **The `seededFeatures` list of this part is the canonical description of every seed** (portfolio: parallel `dh_review`/`dpt_review` quorum 1; committee_report: draft -> submitted -> reviewed -> approved/revision_required; meeting: dynamic per-participant circulation with completion `all` and `onAnyReject`; task: one preset per non-extension TaskKind; campaign: five kind presets); each module phase's seed paragraph repeats it, and `tests/unit/feature/seeds.test.ts` snapshots `compile(def)` for every seed.
- `seedFeatures` per definition: `validateDefinition` must be clean (seed aborts otherwise); `lockedHash = sha256(canonical(pick(def, allLocks(def))))`. If no row exists: create definition (`isSystem:true`, `departmentId:null`), version 1, publish through `publishVersion` with `changeNote='seed:<lockedHash>'`. If the active version's `lockedHash` equals the code's: no-op (admin edits preserved). If it differs (code-backed parts changed in a release): create DRAFT version N+1 = `mergeLocked(active.json, codeJson, allLocks)` (`src/platform/feature/seed/merge.ts`: admin-edited unlocked parts kept, locked subtree replaced), `changeNote='seed-upgrade:<lockedHash>'`; the admin list shows "system update pending" and the admin publishes/migrates; `SEED_AUTO_PUBLISH=1` (set in `compose.yaml` for the `test` and `e2e` services) publishes it immediately. Seeding never overwrites an admin-edited version. **Phase placement**: `seed/index.ts`, `seed/merge.ts`, the badge and `tests/integration/feature/seed.test.ts` are P9 deliverables (P9 seeds `generic_request`, `task`, `case`); every other seed file is delivered by the phase that delivers its module (P12 committee/committee_report, P13 portfolio/cqi/import_batch, P14 campaign/course_offering, P16 meeting, P17 appointment, P24 student_issue/announcement; annual_plan/planned_activity/quarterly_report, exam_schedule, lab_schedule and load_cycle in their module phases), each adding its seed to `prisma/seed/features/index.ts` and its snapshot to `seeds.test.ts`.
- **Locks**: `allLocks(def) = def.lockedPaths ∪ deriveImplicitLocks(def)` where implicit locks on `isSystem` definitions are `/key`, `/record/backing`, `/presets/*/adapters`, `/presets/*/fieldDefaults`, `/presets/*/permissionPrefix`, `/presets/*/parentSubjectType`, every `.../adapter`, `.../guards`, `.../effects`, `.../computedBy`, `.../surface`, `.../sourceBinding`, `.../auto`, `/report/dataSource` when it is an adapter, and any record field listed in the seed's `lockedPaths` (e.g. portfolio `/record/fields/0` = courseOfferingId). `assertLockedPathsUnchanged(prev, next, locks)` compares structurally (RFC 6901 pointer resolution; `*` wildcard for arrays) and is called on every draft save and at publish (`LOCK_VIOLATION`). `tests/integration/feature/seed.test.ts`: seed twice is idempotent; editing an unlocked label creates v2 and re-seed keeps it; editing a locked pointer is rejected; changing a locked value in code produces a `seed-upgrade` draft; `SEED_AUTO_PUBLISH=1` publishes it.
- **AdapterRegistry** (`src/platform/feature/adapters/registry.ts`): `registerAdapter({ key, module, hook, description, simulable, inputSchema?, run(ctx: AdapterCtx, input) })`; `AdapterCtx = { db (scoped), actor, services, record, stepInstance?, definition, preset?, transition? }`. Guards return `{ ok, reason? }`; effects return void and run inside the workflow transaction; `backing` adapters implement `{ create(ctx, data) -> { ids }, relationships(ctx, personId), variables(ctx), onDelete }`; `source_binding` adapters serve picker options; `projection` adapters feed `DashboardProjection`. Modules register in `src/modules/<module>/adapters.ts`; `src/modules/index.ts` is imported by `src/lib/bootstrap.ts` (web) and `apps/worker/src/index.ts` so both processes have identical registries; boot writes `AdapterRegistration` rows.
- **Surfaces** (`src/modules/<module>/surface.tsx`): `export const surface: FeatureSurface = { featureKey, detailExtras?: ComponentType<{ record, definition, actor }>, stepRenderers?: Record<stepKey, ComponentType<StepRendererProps>>, listExtras?: ComponentType, createExtras?: ComponentType }` with `StepRendererProps = { record, step, stepInstance, submission, actor, availableActions, act(actionKey, payload) }`; collected in `src/modules/surfaces.ts` and consumed by `StepPage`/`RecordDetail`. Seeds reference them by `surface: '<stepKey>'` (locked). Examples: `assessment` grid (portfolio), `comparison` charts (cqi), `slot_picker` (appointment), `attendance_and_minutes` (meeting), `board` (exam_schedule), `review_grid` (load_cycle), `preview` (import_batch), `participation` (campaign).
- **Kind presets**: one `campaign` feature with presets `add_drop | elective | preference | evaluation | survey`; one `task` feature with presets for every non-extension `TaskKind`; one `import_batch` feature with presets per import kind. A preset fixes locked record values (`kind`), form overrides, adapter overrides, the optional parent type and the permission prefix, so an admin edit to the shared lifecycle (e.g. adding a "Reviewed by DPT" step before `analyzed`) applies to every kind once, while `evaluation.close`/`evaluation.analyze` remain DH-only through `permissionPrefix`. The nav shows one entry per preset when `presets.*.navLabel` is set (`/d/<dept>/f/campaign?preset=evaluation`).

## 10. Tests and commands (all inside Docker; compose files `compose.yaml` + `compose.e2e.yaml`; env `BASE_URL`, `MAILPIT_URL`, `SMTP_URL`)

- Unit (`docker compose run --rm test npx vitest run --project unit tests/unit/feature`): `schema.test.ts` (defaults, recursion), `validate.test.ts` (one fixture per code above), `compile.test.ts` (snapshot of compiled artefacts for `generic_request`, `portfolio`, `meeting`, `campaign`; group flattening; `$next`; compound states per section 2b; auto actions; preset permission keys; grantRequirements), `simulate.test.ts`, `locks.test.ts`, `seeds.test.ts`.
- Integration (`docker compose run --rm test npx vitest run --project integration tests/integration/feature`): `runtime.test.ts` (create -> act through a parallel quorum -> terminal; step Task rows, reminders as `ScheduledJob` rows, notifications, RLS isolation between two departments), `versioning.test.ts`, `seed.test.ts`, `counters.test.ts`.
- Worker (`docker compose run --rm test npx vitest run --project worker tests/worker/feature`): `auto-transition.test.ts` (pg-boss job fires `auto` action once; `EventHandlerReceipt` prevents duplicate `feature.autoOnEvent`), `migrate.test.ts`.
- E2E (`docker compose -f compose.yaml -f compose.e2e.yaml run --rm e2e npx playwright test tests/e2e/feature-builder.spec.ts tests/e2e/feature-runtime.spec.ts`): admin creates `leave_request` through the wizard (two parallel reviewers, quorum 1, revision loop), publishes, an instructor files a record, a reviewer approves from the inbox, the DH dashboard counter updates; editing a locked portfolio step shows the lock and is refused.
- P9 closes with `git commit -m "feat(feature): feature definition kernel, generic runtime, admin builder"`; each module phase's seed lands in that phase's commit.

===== RUNTIME AND ROUTING =====
 # Runtime and routing

Naming used throughout (shared with tenancyAndAuth, repoLayout, workerAndJobs and the phases): `src/lib/db/prisma.ts` exports `prismaRoot`; `src/lib/db/scoped.ts` exports `forDepartment(departmentId)` (Prisma query extension) and `getDb(ctx)`; `src/lib/db/tenant.ts` exports `withTenantTx(departmentId, fn)` (transaction with `set_config('app.current_department_id', $1, true)`) and `withTenantBypass(fn)` (`dept_migrator` connection, admin/faculty reads only); `src/lib/auth/require.ts` exports `requireContext()`, `requireDeptContext(dept)`, `requireAdmin()`, `requireCan(ctx, permissionKey, subjectRef?)`. The department URL segment is `[dept]` (the organization slug). Worker entry is `apps/worker/src/index.ts` with handlers `apps/worker/src/handlers/<queue>.ts`.

## Route table (`src/app/`; one table, used by every part)

```
(auth)/login/page.tsx                            public; client form against better-auth
(auth)/reset-password/[token]/page.tsx
(auth)/set-password/[token]/page.tsx
c/[token]/page.tsx                               campaign invitation entry without login (P8; rate-limited, CSRF token)
a/[hostSlug]/page.tsx                            public appointment request form (P17; creates an `appointment` record via the appointment.publicIntake adapter)
(app)/select-department/page.tsx                 lists memberships; sets session.activeOrganizationId; redirects to /d/<slug>/dashboard (auto-redirect when exactly one membership)
(app)/page.tsx                                   redirects to /select-department
(app)/d/[dept]/layout.tsx                        requireDeptContext(dept) + getNav(actor) sidebar (groups operations/academic/people/communication/planning/resources) + inbox badge + DepartmentSwitcher
(app)/d/[dept]/dashboard/page.tsx                role widgets gated by requireCan(); featureCounters strip
(app)/d/[dept]/inbox/page.tsx                    Notification inbox (read/ack/decline)
(app)/d/[dept]/my-work/page.tsx                  Task rows for the actor (one table: feature_step tasks + task-backed records), grouped by feature, with state and deadline
(app)/d/[dept]/upcoming/page.tsx                 Scheduler.upcoming feed
(app)/d/[dept]/f/[featureKey]/...                GENERIC FEATURE RUNTIME (below)
(app)/d/[dept]/(modules)/...                     only pages richer than the runtime: assessment/import/[batchId] grid, portfolios/consolidated/[offeringId], campaigns/[id]/results, availability, calendar, search, documents, people, courses, resources
(admin)/admin/{users,departments,roles,calendar,templates,reminders,forms,workflows,features,export-specs,jobs,audit,settings}/...   faculty System Administrator (user.role==='admin'); layout calls requireAdmin()
api/auth/[...all]/route.ts                       toNextJsHandler(auth)
api/uploads/route.ts                             multipart, 25 MB cap, file-type magic check, StorageProvider, creates Document + DocumentLink(subjectRef, linkRole, slotKey)  (P6)
api/documents/[id]/v/[versionNo]/download/route.ts   signed download, Content-Disposition: attachment, X-Content-Type-Options: nosniff, audited  (P6)
api/health/route.ts
```
Built-in "nice" URLs are **rewrites, not pages**: `next.config.ts` `rewrites()` maps `/d/:dept/committees/:path*` -> `/d/:dept/f/committee/:path*`, `/d/:dept/tasks/:path*` -> `/d/:dept/f/task/:path*`, `/d/:dept/portfolios/:path*` -> `/d/:dept/f/portfolio/:path*`, `/d/:dept/campaigns/:path*` -> `/d/:dept/f/campaign/:path*`, `/d/:dept/meetings`, `/appointments`, `/cases`, `/announcements` likewise. `SubjectRegistry.url` always returns the canonical `/d/<dept>/f/<key>/<id>` form; there is one implementation of every page.

## Generic feature routes (`src/app/(app)/d/[dept]/f/[featureKey]/`)

| Route | File | Renders |
|---|---|---|
| `/d/[dept]/f/[featureKey]` | `page.tsx` | `FeatureList`: definition's default `ListView` (or `?view=`), `Counters` strip, TanStack table with URL-state filters (`?state=&mine=1&overdue=1&parent=committee:ID&preset=`), "New" button when `can(create)`; `generateMetadata` = definition name; `notFound()` when unpublished or role not in `visibleRoles` |
| `/d/[dept]/f/[featureKey]/new` | `new/page.tsx` | `RecordForm` (react-hook-form + `zodFromFields(record.fields)`), preset picker, parent picker prefilled from `?parent=`, then redirects to the first step page |
| `/d/[dept]/f/[featureKey]/[recordId]` | `[recordId]/page.tsx` | `RecordDetail`: header (number, title, state badge, owner, parent link, deadline), `StepTimeline` with `ParallelLanes`, current step panel(s) with `ActionBar`, `AttachmentSlots`, `DocumentList`, `ThreadPanel`, `AuditPanel` (AuditEvent + WorkflowTransitionLog), `surfaces[featureKey].detailExtras` |
| `/d/[dept]/f/[featureKey]/[recordId]/steps/[stepKey]` | `[recordId]/steps/[stepKey]/page.tsx` | `StepPage` (`?branch=` for parallel branches): `FormRenderer` of the pinned FormDefinition version (draft autosave), attachment slots (posts to `/api/uploads`), `ActionBar` from `availableActions(actor)`, or the registered `stepRenderers[stepKey]` surface; read-only unless actor satisfies `canEdit` |
| `/d/[dept]/f/[featureKey]/[recordId]/history` | `[recordId]/history/page.tsx` | full transition log + step instances + migrations |
| `/d/[dept]/f/[parentKey]/[parentId]/f/[childKey]` | `[recordId]/f/[childKey]/page.tsx` | `FeatureList` with `parentRef` fixed (also mounted as a tab on module parents: `/d/[dept]/f/committee/[id]` shows `committee_report` and `task` lists via `parentSubject.listUnderParent`) |
| `/d/[dept]/f/[featureKey]/report/[reportKey]` | `report/[reportKey]/page.tsx` | parameter form -> `Reporting.generate` (sync for html/csv, worker queue `report.generate` for pdf/xlsx) |

`actions.ts` (`'use server'`) beside these pages: `createRecordAction`, `saveStepDraftAction`, `actOnStepAction`, `reassignStepAction`, `cancelRecordAction`, `resolveOptionsAction(sourceBinding, args)`; every action takes `dept` + `featureKey`, is wrapped by `safeAction` and delegates to `src/platform/feature/runtime/*`. Server Components read through `src/platform/feature/runtime/queries.ts` (`getDefinition(dept, key)`, `listRecords(dept, def, view, filters, actor)`, `getRecord(...)`, `getStepContext(...)`), never Prisma directly.

Inbox / My Work / counters / navigation:
- Step entry emits `notify(category:'assignment', ackRequired: step.notifications.onEnter[].ackRequired, dedupeKey: 'feature_step_instance:<id>:enter:<personId>')`; a step Task is a `Task(kind=feature_step)` so `/my-work` is one query over `task` + `task_assignment` joined to `feature_record.current_state_key` / `feature_step_instance.deadline_at`.
- `featureCounters(actor, dept)` (`src/platform/feature/counters.ts`): one grouped query per published definition visible to the actor — `SELECT current_state_key, count(*) FROM feature_record WHERE department_id = $1 AND definition_id = $2 GROUP BY 1` plus `assignedToMe` (join `feature_step_instance` ACTIVE for actor person/groups) and `overdue` (`deadline_at < now()`); the dashboard "Features" widget and the nav badges consume it; `DashboardProjection` is not used for these (cheap indexed counts, no `FeatureCounterCache`).
- `getNav(actor, dept)` merges the static entries (dashboard, inbox, my-work, upcoming, search) with published definitions filtered by `navigation.visibleRoles` against `actor.roles ∪ {admin}` (membership roles; `committee_chair` never appears in visibleRoles) and preset `visibleRoles`, grouped by `navigation.group`, ordered by `navigation.order`; department-scoped definitions shadow faculty ones by key; cached per (dept, roles) with `updateTag('nav:<dept>')` on `feature.published`.

## DAL and server-action layout

- `src/lib/safe-action.ts`: `safeAction(schema, handler)` parses input with Zod 4, builds `ctx = await requireDeptContext(input.dept)`, runs `handler({ db, ctx, input })` inside `withTenantTx(ctx.departmentId, db => ...)` (each batch in a transaction with `set_config('app.current_department_id', $1, true)`; `db` is `prismaRoot.$extends(forDepartment(ctx.departmentId))` bound to that transaction) and `audit.withCorrelation`, maps `ForbiddenError | ValidationError | LockViolation` to `{ ok:false, code, issues }`, calls `revalidatePath`. Admin actions use `requireAdmin()` and `withTenantBypass()` only where a faculty-level read/write is needed (feature definitions with `departmentId NULL`, migrations across departments).
- `requireDeptContext(dept)` (`src/lib/auth/require.ts`): `auth.api.getSession({ headers: await headers() })` -> membership lookup by organization slug (`Department.id === Organization.id`, `Organization.slug === Department.code.toLowerCase()`) -> `Person` by `Person.userId` -> `Actor { userId, personId, departmentId, roles: member.role.split(','), grantRoleKeys: active RoleGrant keys in the department (incl. derived committee_chair), isAdmin: user.role==='admin', correlationId }`; the URL slug is the authority, `session.activeOrganizationId` is only updated by `/select-department` and `DepartmentSwitcher` (`setActiveOrganizationAction`).
- Kernel services: `createServices(db, actor)` (`src/platform/index.ts`) returns one object `{ identity, people, academic, workflow, workItem, forms, scheduler, templates, documents, threads, audit, imports, availability, reporting, search, dashboard, feature }` sharing the scoped client; modules never instantiate services themselves.
- Reads: `src/platform/**/queries.ts` (server-only, scoped client); writes: `src/platform/**/repo.ts`; module logic in `src/modules/<module>/{service.ts, adapters.ts, surface.tsx, forms.ts, templates.ts, reports.ts}`.
- Types: `PageProps<'/d/[dept]/f/[featureKey]/[recordId]'>`, `await props.params`, `await props.searchParams`; CI `docker compose run --rm web npx next typegen && docker compose run --rm web npx tsc --noEmit`.

## `src/proxy.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
const PUBLIC = ['/login', '/reset-password', '/set-password'];
export async function proxy(req: NextRequest) {
  const cookie = getSessionCookie(req);
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'));
  if (!cookie && !isPublic)
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname + search)}`, req.url));
  if (cookie && pathname === '/login') return NextResponse.redirect(new URL('/select-department', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|c/|a/).*)'] };
```
Optimistic only (no DB, Node runtime); `/c/[token]` and `/a/[hostSlug]` are excluded by the matcher; every layout, page, action and route handler re-checks session and `requireCan()`.

## UI component structure

- `src/components/ui/*` shadcn (radix base); `src/components/shell/{AppShell,Sidebar,Topbar,DepartmentSwitcher,InboxPopover,CommandSearch}`.
- Feature runtime (`src/components/feature/`): `FieldRenderer` (switch on `FieldDef.type`; pickers call `resolveOptionsAction`), `RecordForm`, `FormRenderer` (pinned FormDefinition -> react-hook-form + generated Zod), `StepPage`, `ActionBar` (buttons from `availableActions`, confirm dialogs, comment sheet), `AttachmentSlots`, `StepTimeline` + `ParallelLanes` (one lane per branch with status/assignee from `branchStatesCache`), `FeatureList` (TanStack table v9, URL-state filters), `Counters`, `StateBadge`, `RecordHeader`.
- Builder (`src/components/admin/feature-wizard/`): `Wizard` (7 screens, autosave), `FieldBuilder`, `StepTree` (dnd-kit), `StepDrawer` (tabs), `TransitionGraph` (SVG), `PresetTable`, `ListViewBuilder`, `CounterBuilder`, `IssuesPanel`, `SimulatePanel`, `LockBadge`, `MigrationDiff`, `MigrationPreview`.
- Shared: `PersonPicker`, `GroupPicker`, `CoursePicker`, `OfferingPicker`, `SectionPicker`, `TermPicker`, `ResourcePicker`, `AudiencePicker`, `DocumentList`, `ThreadPanel`, `AuditPanel`, `InboxList`, `TemplatePicker` (with variable list), `RankedList`, `RepeatingGroup`; charts in `src/components/charts` (recharts).

## Tests for this part (Docker only)

- Components (`docker compose run --rm test npx vitest run --project components tests/components/feature`): `FieldRenderer`, `ActionBar`, `StepTimeline/ParallelLanes`, `FeatureList` filters.
- Integration: `tests/integration/feature/nav.test.ts` (visibleRoles filtering, department shadowing, cache tag), `tests/integration/auth/proxy.test.ts` (matcher exclusions, `/select-department` redirect).
- E2E: `tests/e2e/feature-runtime.spec.ts` (list -> new -> step -> inbox -> counter) and `tests/e2e/select-department.spec.ts`.

===== SEEDED FEATURES =====
- committee [Committee Management (§3.1) | seeded in P12 | navigation {group:'operations', order:10, icon:'users', visibleRoles:[department_head,deputy_head,instructor,committee_member]} | scope {level:'department'} | record {numberPrefix:'CM', backing:{kind:'module', adapter:'committee.backing'}} (Committee + Group kind=committee; Group.status is a derived cache of the workflow state) | permissions.defaults {department_head:full, deputy_head:full, instructor:assigned, committee_member:assigned, committee_chair:assigned}] parent=none; children listed under it: committee_report, task (preset committee_task), meeting (relation 'context')
    steps: setup (form: name, purpose, type, startDate, endDate, chair person_picker, members person_picker[multi], responsibilities long_text; slot tor required; assignee role department_head|deputy_head; activate -> active) -> active (stepType wait; actions: deactivate -> inactive (requiredComment), update_members -> $self) -> inactive (wait; reactivate -> active; dissolve -> dissolved) | terminalStates: dissolved (cancelled) | listViews: all, active, mine | counters: active_committees (roles DH/DPT), pending_reports (child committee_report in submitted), overdue_committee_tasks
    adapters: backing committee.backing (creates Committee + Group, syncs GroupMembership/chair from record fields on every save), effect committee.syncGroupStatus (on_enter active/inactive -> Group.status, emits group.status.changed -> derived COMMITTEE_MEMBER/COMMITTEE_CHAIR grants), guard committee.chairIsMember, surface activity_history (union of task transitions, reports, meetings, comments by contextRef=committee), source_binding members_of_parent
- committee_report [Committee Management — progress report (§3.1) | seeded in P12 | navigation {group:'operations', order:11, icon:'file-text', visibleRoles:[department_head,deputy_head,instructor,committee_member]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'CR', backing:{kind:'module', adapter:'committee_report.backing'}} (CommitteeReport row + standalone Submission of form committee_report) | permissions.defaults {department_head:full, deputy_head:full, committee_member:own, committee_chair:own, instructor:own}] parent={subjectType:'committee', relation:'parent', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:true}
    steps: draft (form committee_report: period_from date, period_to date, progress_summary long_text, completed_tasks task_picker[sourceBinding tasks_in_context], recommendations long_text, issues_requiring_attention repeating_group{issue, urgency single_choice}; slot attachments; assignee relationship parent_member; deadline relative 0d from record_field period_to; reminders default_7_3_1_0_overdue; submit -> submitted (guard committee.memberGuard)) -> submitted (assignee role department_head|deputy_head; onEnter notify committee_report_submitted to role:department_head; review -> reviewed) -> reviewed (assignee role department_head|deputy_head; approve -> approved (effect committee.completeReportedTasks optional); request_revision -> revision_required (requiredComment)) -> revision_required (assignee owner; resubmit -> submitted) | terminalStates: approved (success; effect committee_report.setSubmittedAt cache already set on submit) | permission keys committee.report.submit (submit/resubmit), committee.manage (review/approve/request_revision) | listViews: by_committee, pending_review (states submitted, reviewed; roles DH/DPT)
    adapters: backing committee_report.backing (CommitteeReport row, submission binding), guard committee.memberGuard (actor is member/chair of parent group), effect committee.escalateIssueToCase (Thread.escalateAnswer per issues_requiring_attention row -> case record with originRef committee_report; action on reviewed), effect committee.completeReportedTasks (optional, on approve), effect committee_report.setSubmittedAt (derived cache), source_binding tasks_in_context
- task [Task & Activity Management (§4) | seeded in P9 | navigation {group:'operations', order:20, icon:'check-square', visibleRoles:[department_head,deputy_head,instructor,committee_member,lab_staff,student_rep]} | scope {level:'department'} | record {numberPrefix:'T', backing:{kind:'task', taskKind: from preset}} | presets general, committee_task, department_task, instructor_task, student_activity, administrative, action_item, cqi_action, maintenance, lab_activity (each fixes fieldDefaults.kind = Task.kind; permissionPrefix committee.task for committee_task, lab.task for lab_activity, task otherwise; committee_task.parentSubjectType committee, action_item.parentSubjectType meeting, lab_activity.parentSubjectType lab_session, maintenance.parentSubjectType asset) | permissions.defaults {department_head:full, deputy_head:full, instructor:assigned, committee_member:assigned, committee_chair:manage, lab_staff:assigned, student_rep:limited}] parent={subjectType:'feature_record', relation:'context', required:false, allowedTypes:[committee, meeting, lab_session, resource, asset, feature_record], inheritPermissions:true, listUnderParent:true, createFromParent:true}
    steps: draft (form: title, description long_text, assignee person_picker|group_picker|audience_picker, startDate, dueAt datetime, priority single_choice, expectedDeliverables repeating_group{key,label,required}, recurrence; assignee creator; assign -> assigned; cancel -> cancelled) -> assigned (assignee record_field assignee; onEnter notify task_assignment ackRequired; deadline relative 0d from record_field dueAt; reminders default_7_3_1_0_overdue; start -> in_progress (also auto event notification.acknowledged); request_update -> $self (notify assignee); cancel -> cancelled) -> in_progress (submit -> submitted (guard task.requiredDeliverablesLinked; notify creator); request_update -> $self; cancel -> cancelled) -> submitted (review -> under_review) -> under_review (assignee creator|role department_head; approve -> completed; request_revision -> revision_required (requiredComment)) -> revision_required (assignee record_field assignee; resubmit -> submitted) | terminalStates: completed (success; effect task.setCompletedAt), cancelled (cancelled) | listViews: my_tasks (filter mine), all, overdue | counters: my_open_tasks, overdue_tasks (DH/DPT, tone danger), pending_review
    adapters: backing task.backing (WorkItem.createTask with audience snapshot -> adhoc Group; TaskAssignment sync; sets Task.featureRecordId), guard task.requiredDeliverablesLinked (DocumentLink deliverable slots), auto task.autoStartOnAck (subscriber notification.acknowledged -> start), effect task.setCompletedAt (derived cache), auto task.recurrenceSpawn (RecurrenceRule -> new record), effect task.completeStepTask (feature_step tasks of other features reuse this)
- case [Follow-up / Case Management (§12) | seeded in P9 (intake sources wired in P12/P16/P17) | navigation {group:'operations', order:30, icon:'life-buoy', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department'} | record {numberPrefix:'CS', backing:{kind:'task', taskKind:'case', extension:'case'}; fields requester person_picker, issue long_text, issueCategory single_choice, priority, requiredAction, dueAt datetime, responsible person_picker} | permissions.defaults {department_head:full, deputy_head:full, instructor:assigned, student_rep:limited}] parent={subjectType:'feature_record', relation:'origin', required:false, allowedTypes:[appointment, thread, meeting, committee_report, feature_record], inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: open (assignee role department_head|deputy_head; assign -> assigned (kind assign, reassignTo record_field responsible); cancel -> cancelled) -> assigned (assignee record_field responsible; onEnter notify case_assignment ackRequired; deadline relative 0d from record_field dueAt; reminders default_7_3_1_0_overdue; effect case.subscribeIntervalNudge; start -> in_progress) -> in_progress (wait -> waiting (requiredFields waitingOn); resolve -> resolved (requiredFields resolution; notify requester)) -> waiting (resume -> in_progress) -> resolved (close -> closed (actors role DH/DPT); auto close after_days settingKey case.autoCloseDays -> closed; reopen -> in_progress (actors relationship requester | role department_head,deputy_head)) | terminalStates: closed (success; effects case.cancelNudge), cancelled (cancelled) | listViews: open_cases (states open..resolved), mine, by_requester | counters: open_cases (DH/DPT), overdue_cases (danger)
    adapters: backing case.backing (Task kind=case + Case extension row, requesterPersonId, originRef), effect case.subscribeIntervalNudge / case.cancelNudge, auto case.autoClose (after_days from SystemSetting case.autoCloseDays), effect case.setResolvedAt (derived cache), projection case.openIssues (Dashboard openIssues)
- portfolio [Course Portfolio & Assessment (§5, §5.1) | seeded in P13 | navigation {group:'academic', order:10, icon:'book-open', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'PF', backing:{kind:'module', adapter:'portfolio.backing'}; fields courseOfferingId offering_picker (locked /record/fields/0), sectionOfferingIds section_picker[multi] (locked, from TeachingAssignment), termId term_picker (locked), studentCount computed portfolio.studentCount} | permissions.defaults {department_head:review, deputy_head:review, instructor:own}] parent={subjectType:'course_offering', relation:'parent', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:false} (owner = instructor via TeachingAssignment; records provisioned by portfolio.provision)
    steps: group prepare { course_info (form portfolio_course_info: objectives, outcomes, teaching_activities, assessment_methods, completion_status single_choice; continue -> $next) -> assessment (stepType adapter, surface 'assessment': per-section import grid via import_batch preset assessment; continue -> $next guard portfolio.allScopesCommitted) -> narrative (form portfolio_narrative: sessionsHeld, averageAttendancePercent, attendanceNotes, challenges, reflection, recommendations; continue -> $next) -> cqi (stepType wait, surface 'cqi_summary'; continue -> $next guard portfolio.cqiComplete (child cqi record terminal)) } -> ready (stepType review; assignee owner; submit -> submitted (guards portfolio.allScopesCommitted, portfolio.cqiComplete; effect portfolio.setSubmittedAt); deadline calendar portfolio_submission end (termFrom record_field termId); reminders portfolio_7_3_1_0_overdue) -> submitted (assignee role department_head; onEnter notify portfolio_submitted to role:department_head, role:deputy_head; mark_reviewed -> review) -> parallel review { static branches dh_review (step dh_review: assignee role department_head; approve -> $done; request_revision -> reject (requiredComment)), dpt_review (step dpt_review: assignee role deputy_head; approve -> $done; request_revision -> reject (requiredComment)); completion quorum 1; onComplete approved; onAnyReject revision_required } -> revision_required (assignee owner; onEnter notify portfolio_revision_requested to owner; resubmit -> submitted) | terminalStates: approved (success; effects portfolio.setApprovedAt, portfolio.lockScopes, portfolio.freezeSnapshots) | extra action on approved: reopen -> narrative (actors role admin|department_head) | permission keys portfolio.submit_own (submit/resubmit), portfolio.review (mark_reviewed, request_revision), portfolio.approve (approve; DPT excluded by SystemSetting default) | listViews: my_portfolios, by_term (columns number, title, parent, state, owner, deadline), not_started (state course_info and firstEditedAt NULL) | counters: portfolios_pending_review (DH), my_portfolio_due (instructor, overdue tone warning)
    adapters: backing portfolio.backing (Portfolio + PortfolioScope rows; featureRecordId), auto portfolio.provision (job at portfolio_submission period start: record per (instructor, offering) + child cqi record), compute portfolio.studentCount, guard portfolio.allScopesCommitted, guard portfolio.cqiComplete, effect portfolio.lockScopes (Academic.lockSectionAssessment per scope + recomputeSchemeStructureLock), effect portfolio.setSubmittedAt / portfolio.setApprovedAt, effect portfolio.freezeSnapshots, surface assessment (import_batch grid, scheme editor), cqi_summary, export portfolio.reportData (portfolio PDF + consolidated course-level report)
- cqi [Continuous Quality Improvement (§6) | seeded in P13 | navigation {group:'academic', order:11, icon:'trending-up', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'CQ', backing:{kind:'module', adapter:'cqi.backing'}} (CQIReport + CQIItem; created by portfolio.provision, recomputed on assessment.committed until frozen) | permissions.defaults {department_head:review, deputy_head:review, instructor:own}] parent={subjectType:'feature_record', featureKey:'portfolio', relation:'parent', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:false} (owner = portfolio owner)
    steps: comparison (stepType adapter; adapter.onEnter cqi.metrics + cqi.compare (previous_semester | previous_year | all with fallbacks and 'no data' rows); surface 'comparison'; continue -> $next; recompute auto event assessment.committed match {sectionOfferingId: 'record.sectionOfferingIds'} -> $self) -> prior_items (form cqi_prior_items: repeating_group bound prior_cqi_items {item readOnly, implementationStatus single_choice, note}; continue -> $next guard cqi.allPriorItemsAssessed) -> narrative (form cqi_narrative: problems repeating{category,text}, actions_taken repeating, recommendations repeating, planned_actions repeating{text, responsible person_picker, dueAt}; complete -> complete (effect cqi.itemsFromAnswers)) | terminalStates: complete (success; effects cqi.spawnActionTasks -> task preset cqi_action) | complete -recompute (auto event assessment.committed, guard feature.parentActive)-> comparison until parent approved; cqi.freeze effect runs when parent enters approved | listViews: by_term, mine
    adapters: backing cqi.backing, compute cqi.metrics (CourseMetricsSnapshot), compute cqi.compare (courseLineage, listOfferingsOfCourse), auto cqi.recomputeOnCommit (event assessment.committed), guard cqi.allPriorItemsAssessed, effect cqi.itemsFromAnswers (CQIItem rows with referencesItemId chain), effect cqi.spawnActionTasks, effect cqi.freeze (called by portfolio approved), source_binding prior_cqi_items, surface comparison, export cqi.reportData
- campaign [Form/Campaign engine (§7, §8, §9, §13, §31) | seeded in P14 | ONE feature with presets add_drop, elective, preference, evaluation, survey (each: fieldDefaults.kind, formKeys.setup -> kind form, adapters {closed.analyze.effect: <kind>.aggregate, analyzed.decide.effect: ...}, permissionPrefix = kind ('evaluation' makes evaluation.close/evaluation.analyze DH-only), navLabel 'Evaluations' | 'Add/Drop' | 'Electives' | 'Preferences' | 'Surveys') | navigation {group:'academic', order:20, icon:'megaphone', visibleRoles:[department_head,deputy_head]} | scope {level:'department'} | record {numberPrefix:'CP', backing:{kind:'module', adapter:'campaign.backing'}; fields kind (locked by preset), title, formKey form picker filtered by preset kind, windowAnchor {periodKind, edge, offsetDays} or opensAt/closesAt datetime, audienceSpec audience_picker, anonymityMode, submissionRule, subjectMode, minResponsesForReport} | permissions.defaults {department_head:full, deputy_head:manage, instructor:participate, student:submit, student_rep:submit}] parent={subjectType:'term', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true} (audiences chosen from program/section)
    steps: setup (form campaign_setup (per-preset override); assignee creator; publish -> published (guards campaign.formPublished, campaign.audienceNonEmpty, campaign.windowValid; effect campaign.publish); cancel -> cancelled) -> published (wait; open auto field_datetime opensAt -> in_progress (effect campaign.open); cancel -> cancelled) -> in_progress (wait; surface 'participation'; extend -> $self (effect campaign.reschedule); close -> closed (manual, or auto field_datetime closesAt; effect campaign.close)) -> closed (analyze -> analyzed (effect preset adapter: addDrop.aggregate | elective.borda | preference.rankMatrix | evaluation.analyze | survey.aggregate); reopen -> in_progress) -> analyzed (surface 'results'; decide -> $self (preset effects addDrop.offeringDecision | elective.capacityOffer); archive -> archived) | terminalStates: archived (success), cancelled (cancelled) | permissions '{preset}.{action}' with fallback campaign.manage | listViews: by_preset (filter preset), active (states published, in_progress), results | counters: campaigns_in_progress, evaluation_low_participation (warning)
    adapters: backing campaign.backing (Campaign, CampaignSubject, CampaignInvitation; featureRecordId), guards campaign.formPublished, campaign.audienceNonEmpty, campaign.windowValid, effects campaign.publish (invitations + hashed tokens, open/close ScheduledJobs, invitations.pending reminders), campaign.open, campaign.close, campaign.reschedule, effect addDrop.aggregate + action-effect addDrop.offeringDecision (ensureOffering, Enrollment decision), effect elective.borda + action-effect elective.capacityOffer, effect preference.rankMatrix + effect preference.seedReviewedPreferences (event to load_cycle), effects evaluation.deriveSubjects, evaluation.anonymousSubmit (structural anonymity path, locked), evaluation.normaliseScores, evaluation.kAnonymity, effect survey.aggregate, export campaign.export (ExportFormatSpec / csv / xlsx), surfaces participation, results, subjects, source_bindings courses_in_program, own_enrollments, electives_in_campaign, offerings_in_term
- appointment [DH/DPT Appointments (§11) | seeded in P17 | navigation {group:'people', order:20, icon:'calendar-clock', visibleRoles:[department_head,deputy_head,instructor,student_rep]} | scope {level:'department'} | record {numberPrefix:'AP', backing:{kind:'module', adapter:'appointment.backing'}; fields hostPersonId person_picker (staff_in_department, DH/DPT only), requesterPersonId person_picker (optional; external via token intake), confirmedStartAt datetime, durationMinutes number, proposedStartAt datetime, outcomeNote long_text} (request content = appointment_request Submission of the requested step) | permissions.defaults {department_head:full, deputy_head:full, instructor:own, student_rep:own}] parent={subjectType:'person', relation:'host', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true} (host from record field hostPersonId; requester may be external via /a/[hostSlug])
    steps: requested (form appointment_request: requester_name, requester_role, contact, reason long_text, preferred_times repeating{datetime}; slot documents; surface 'slot_picker' (freeSlots of host); assignee record_field hostPersonId; onEnter notify appointment_requested to assignee; confirm -> confirmed (requiredFields confirmedStartAt, durationMinutes; guard appointment.hostSlotFree); reject -> rejected (requiredComment); cancel -> cancelled (actors relationship requester | assignee)) -> confirmed (onEnter effects appointment.registerBlocks, notify requester appointment_confirmation; reminders appointment_-1d_-2h; complete -> completed (optional outcomeNote; optional effect appointment.escalateToCase); no_show -> no_show; reschedule -> rescheduled (requiredFields proposedStartAt; notify requester appointment_reschedule); cancel -> cancelled (effect appointment.removeBlocks)) -> rescheduled (assignee relationship requester; accept -> confirmed; decline -> cancelled) | terminalStates: completed (success), rejected (rejected), no_show (cancelled), cancelled (cancelled; effect appointment.removeBlocks) | listViews: host_agenda (filter person hostPersonId, sort confirmedStartAt), my_requests, pending (state requested) | counters: pending_requests (DH/DPT), today_appointments
    adapters: backing appointment.backing, guard appointment.hostSlotFree (AvailabilityBlock hard blocks of host), compute appointment.freeSlots (AvailabilityPolicy purpose=appointments), effect appointment.registerBlocks (host hard, requester soft) / appointment.removeBlocks, effect appointment.escalateToCase (action effect -> case record originRef appointment), backing appointment.publicIntake (/a/[hostSlug] route creates record without login), surface slot_picker, host_agenda
- meeting [Meetings & Minutes (§22) | seeded in P16 | navigation {group:'operations', order:40, icon:'presentation', visibleRoles:[department_head,deputy_head,instructor,committee_member]} | scope {level:'department'} | record {numberPrefix:'MT', backing:{kind:'module', adapter:'meeting.backing'}; fields title, startsAt datetime, endsAt datetime, room resource_picker (resources_of_kind meeting_room), participants audience_picker, agenda repeating{title, presenter person_picker, attachments file}, minutesTemplateKey} (Meeting, AgendaItem, Decision, MeetingAttendance, participant Group) | permissions.defaults {department_head:full, deputy_head:full, instructor:participate, committee_member:participate, student_rep:limited}] parent={subjectType:'committee', relation:'context', required:false, inheritPermissions:true, listUnderParent:true, createFromParent:true}
    steps: scheduled (assignee creator (organizer); create/save guard meeting.roomFree; onEnter effects meeting.registerBlocks, notify participants meeting_notification; reminders meeting_-1d_-1h; record_held -> held; cancel -> cancelled) -> held (surface 'attendance_and_minutes': attendance, discussion, decisions, action items with owner + deadline; generate_minutes -> minutes_draft (guards meeting.attendanceRecorded, meeting.actionItemsValid; effects meeting.renderMinutes v1, meeting.createActionItemTasks)) -> minutes_draft (circulate -> circulation; regenerate -> $self (new DocumentVersion)) -> parallel circulation { dynamic perPerson relationship participant; branch review: step participant_review (assignee = branch person; onEnter notify minutes_circulated; acknowledge -> $done; request_changes -> reject (requiredComment)); completion all; onComplete approval; onAnyReject changes_requested } -> changes_requested (assignee creator; regenerate -> minutes_draft (new DocumentVersion)) -> approval (assignee role department_head | relationship parent_chair; approve -> minutes_approved (effect meeting.lockVersion; approval recorded in transition payload); request_changes -> changes_requested (requiredComment)) | terminalStates: minutes_approved (success; notify participants minutes_approved), cancelled (cancelled; effect meeting.removeBlocks) | permission keys meeting.manage, minutes.approve | listViews: upcoming (sort startsAt asc), mine (participant), awaiting_minutes (states held, minutes_draft, circulation, changes_requested) | counters: meetings_awaiting_minutes (DH/DPT), minutes_to_review (participant, assignedToMe)
    adapters: backing meeting.backing (Meeting rows + participant Group), guard meeting.roomFree, effect meeting.registerBlocks (room hard, attendees soft) / meeting.removeBlocks, guard meeting.attendanceRecorded, guard meeting.actionItemsValid (owner + deadline), effect meeting.renderMinutes (ten-section minutes template -> Document version), effect meeting.createActionItemTasks (task preset action_item, parent meeting), effect meeting.lockVersion, source_binding participants_of_parent, surface attendance_and_minutes, previous_decisions, export meeting.minutesPdf
- annual_plan [Annual Activity Plan (§10) | seeded in the planning phase | navigation {group:'planning', order:10, icon:'calendar-range', visibleRoles:[department_head,deputy_head]} | scope {level:'department'} | record {numberPrefix:'AP', backing:{kind:'module', adapter:'annual_plan.backing'}; fields title, owner person_picker, objectives long_text} (AnnualPlan; activities are child planned_activity records; quarterly reports are child quarterly_report records) | permissions.defaults {department_head:full, deputy_head:manage, instructor:view}] parent={subjectType:'academic_year', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: draft (form annual_plan; assignee role deputy_head|department_head; submit -> submitted) -> submitted (assignee role department_head; approve -> approved (effect annual_plan.setApprovedAt); return -> draft (requiredComment)) -> approved (activate -> active (effect annual_plan.activateActivities: start every child planned_activity + reminders)) -> active (wait; surface 'plan_board'; close -> closed (guard annual_plan.allQuartersPublishedOrWaived)) | terminalStates: closed (success) | permission keys plan.manage (submit/activate), plan.approve (approve/return/close) | listViews: by_year | counters: plan_pending_approval (DH), delayed_activities (child planned_activity in delayed; danger)
    adapters: backing annual_plan.backing, effect annual_plan.setApprovedAt, effect annual_plan.activateActivities, guard annual_plan.allQuartersPublishedOrWaived, compute planning.quarterOf, auto planning.scheduleQuarterlyGeneration (report_generate at each quarter end -> quarterly_report record), surface plan_board, export annual_plan.reportData
- planned_activity [Annual plan activities (§10) | seeded in the planning phase | navigation {group:'planning', order:11, icon:'list-checks', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'PA', backing:{kind:'task', taskKind:'planned_activity', extension:'planned_activity'}; fields name, objective, responsible person_picker|group_picker, expectedOutput, plannedStart date, plannedEnd date, performanceIndicator, requiredResources, budgetAmount number, challengeNote long_text, correctiveActions long_text} (Delayed is the declared stored-state exception) | permissions.defaults {department_head:full, deputy_head:manage, instructor:assigned}] parent={subjectType:'feature_record', featureKey:'annual_plan', relation:'parent', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:true}
    steps: not_started (form activity; assignee record_field responsible; deadline relative 0d from record_field plannedEnd; reminders default_7_3_1_0_overdue; start -> in_progress (also auto event annual_plan.activated when plannedStart <= today); delay -> delayed (auto deadline, or manual requiredFields challengeNote); cancel -> cancelled) -> in_progress (complete -> completed (form activity_progress required); delay -> delayed (requiredFields challengeNote; also auto deadline); cancel -> cancelled) -> delayed (requiredFields challengeNote on entry; resume -> in_progress; complete -> completed (requiredFields correctiveActions)) | terminalStates: completed (success; effect task.setCompletedAt), cancelled (cancelled; actors role department_head|deputy_head) | listViews: by_plan, mine, by_quarter (computed activity.quarterClassification) | counters: my_activities_due, delayed_activities
    adapters: backing planned_activity.backing (Task kind=planned_activity + PlannedActivity extension), auto activity.autoDelay (scheduleAutoTransition at plannedEnd), compute activity.quarterClassification (from state + dates), auto activity.startOnPlanActivate (event annual_plan.activated), effect task.setCompletedAt
- quarterly_report [Quarterly Department Activity Report (§10) | seeded in the planning phase | navigation {group:'planning', order:12, icon:'file-bar-chart', visibleRoles:[department_head,deputy_head]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'QR', backing:{kind:'module', adapter:'quarterly_report.backing'}; field quarter number 1-4 (locked, unique per plan)} (QuarterlyReport: computedSnapshotJson, narrativeSubmissionId, documentId) | permissions.defaults {department_head:full, deputy_head:manage, instructor:view}] parent={subjectType:'feature_record', featureKey:'annual_plan', relation:'parent', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:true}
    steps: generated (stepType adapter; adapter.onEnter quarterly.generateSnapshot + quarterly.renderDocument v1; form quarterly_narrative: achievements, challenges, corrective_actions; assignee role deputy_head|department_head; review -> under_review; regenerate -> $self (new snapshot, narrative kept via quarterly.mergeNarrative, new DocumentVersion); waive -> waived) -> under_review (assignee role department_head; approve -> approved (effects quarterly.renderFinal, quarterly.lockVersion); regenerate -> generated; waive -> waived) -> approved (publish -> published (effect quarterly.notifyAudience + GeneratedReport)) | terminalStates: published (success), waived (cancelled) | permission keys plan.manage (generate/regenerate/review), plan.approve (approve/publish/waive) | listViews: by_plan
    adapters: backing quarterly_report.backing, auto quarterly.generateSnapshot (queue report.generate; classifies child activities planned/completed/in_progress/delayed/not_started), effect quarterly.renderDocument / quarterly.renderFinal (worker PDF), effect quarterly.mergeNarrative, effect quarterly.lockVersion, effect quarterly.notifyAudience, export quarterly_report.pdf
- exam_schedule [Invigilation Assignment (§15) | seeded in the invigilation phase | navigation {group:'academic', order:30, icon:'clipboard-list', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'ES', backing:{kind:'module', adapter:'exam_schedule.backing'}; fields examType single_choice, calendarPeriodId (examination period)} (ExamSchedule, ExamSession, DutyAssignment) | permissions.defaults {department_head:full, deputy_head:manage, instructor:assigned}] parent={subjectType:'term', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: draft (surface 'board': sessions editor, exam_timetable import (import_batch preset exam_timetable), assignment board with conflict badges + suggestAssignees; assignee role deputy_head|department_head; publish -> published (guard schedule.noHardConflicts; effects schedule.setPublishedAt, schedule.registerBlocks, schedule.notifyDuties (ack-required, declinable invigilation_notification); reminders duty_-1d)) -> published (wait; amend -> amended; supersede -> superseded) -> amended (surface 'board'; publish -> published (effect schedule.notifyDeltaDuties: only changed persons, ack reset, re-register changed blocks)) | terminalStates: superseded (cancelled) | permission invigilation.manage | listViews: by_term, my_duties (surface my_duties) | counters: duties_unacknowledged (DH/DPT, warning), my_upcoming_duties (instructor)
    adapters: backing exam_schedule.backing, guard schedule.noHardConflicts (Availability.checkConflicts hard), effect schedule.registerBlocks / schedule.setPublishedAt, effect schedule.notifyDuties / schedule.notifyDeltaDuties, auto schedule.dutyDeclineSubscriber (event notification.declined -> DutyAssignment.endedAt, notify invigilation.manage), compute availability.suggestAssignees (fairness, workload, policy purpose=invigilation), validate import.validate.exam_timetable, surface board, my_duties, export invigilation.schedule (xlsx per-instructor sheets + pdf with ack status)
- lab_schedule [Laboratory Schedule Management (§19) | seeded in the lab phase | navigation {group:'resources', order:10, icon:'flask-conical', visibleRoles:[department_head,deputy_head,instructor,lab_staff]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'LS', backing:{kind:'module', adapter:'lab_schedule.backing'}} (LabSchedule, LabSession, DutyAssignment roles lab_instructor|ra|responsible) | permissions.defaults {department_head:full, deputy_head:manage, lab_staff:assigned, instructor:view}] parent={subjectType:'term', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: draft (surface 'board': lab_schedule import (import_batch preset lab_schedule) + manual sessions + duty assignment with conflict badges; assignee role deputy_head|department_head; publish -> published (guard schedule.noHardConflicts; effects schedule.setPublishedAt, schedule.registerBlocks, schedule.notifyDuties, lab.syncDerivedGrants)) -> published (wait; amend -> amended; supersede -> superseded) -> amended (publish -> published (effect schedule.notifyDeltaDuties)) | terminalStates: superseded (cancelled) | permission lab.manage | listViews: by_term, my_lab (surface my_lab) | counters: lab_duties_unacknowledged (DH/DPT), my_lab_sessions_this_week (lab_staff)
    adapters: backing lab_schedule.backing, validate import.validate.lab_schedule (context provider resolving labs -> Resource, courses/sections -> SectionOffering, overlap check) + effect import.commit.lab_schedule, guard schedule.noHardConflicts, effect schedule.registerBlocks / schedule.notifyDuties / schedule.notifyDeltaDuties / schedule.setPublishedAt, effect lab.syncDerivedGrants (LAB_STAFF@lab_schedule), auto schedule.dutyDeclineSubscriber, surface board, my_lab, export lab.schedule (xlsx/pdf per lab and per person)
- load_cycle [Load Assignment Integration (§14) | seeded in the load-bridge phase | navigation {group:'academic', order:40, icon:'arrow-left-right', visibleRoles:[department_head,deputy_head]} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'LC', backing:{kind:'module', adapter:'load_cycle.backing'}; field preferenceCampaignId record_picker{featureKey:'campaign', presetKey:'preference'}} (LoadCycle, ReviewedPreference, LoadExport) | permissions.defaults {department_head:full, deputy_head:manage}] parent={subjectType:'term', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: preferences_open (wait; close_preferences auto event campaign.closed match {campaignId: 'record.preferenceCampaignId'} -> under_review (effect load.seedReviewedPreferences)) -> under_review (surface 'review_grid': accept/adjust/reject/add rows with comments; assignee role deputy_head|department_head; export -> exported (guard load.allDecided; effect load.exportTabular via active ExportFormatSpec + golden validation -> LoadExport + Document)) -> exported (await -> awaiting_result; re_export -> $self) -> awaiting_result (import_result -> result_imported (guard load.resultBatchCommitted: import_batch preset load_result; surface 'diff' vs existing TeachingAssignments)) -> result_imported (apply -> applied (effect load.applyTeachingAssignments source=load_import, notify instructors); reject_result -> awaiting_result (requiredComment)) | terminalStates: applied (success) | permission load.manage | listViews: by_term | counters: load_cycles_under_review
    adapters: backing load_cycle.backing, effect load.seedReviewedPreferences (from preference AggregationResult/Answers), guard load.allDecided, effect load.exportTabular (ExportFormatSpec renderer, golden-sample validation, LoadExport), guard load.resultBatchCommitted, compute load.resultDiff, effect load.applyTeachingAssignments, surface review_grid, diff
- import_batch [Tabular Import (§5.1, §14, §15, §19, §20) | seeded in P13 (assessment/attendance/roster presets), extended by later phases | navigation {group:'admin', order:50, icon:'upload', visibleRoles:[department_head,deputy_head,instructor,lab_staff], showInDashboard:false} | scope {level:'department', scopeFrom:'parent'} | record {numberPrefix:'IB', backing:{kind:'module', adapter:'import_batch.backing'}; fields kind (locked by preset), sourceFile file, mappingProfileId} (ImportBatch, ImportRow, ColumnMappingProfile) | presets assessment, attendance, roster, students, staff, lab_schedule, class_timetable, exam_timetable, load_result, assets (each fixes fieldDefaults.kind, adapters {parsed.validate.effect: import.validate.<kind>, validated.commit.effect: import.commit.<kind>, validated.commit.guard}, parentSubjectType and the template export) | permissions.defaults {department_head:full, deputy_head:manage, instructor:own, lab_staff:own}] parent={subjectType:'section_offering', relation:'context', required:true, inheritPermissions:true, listUnderParent:true, createFromParent:true, allowedTypes:[section_offering, term, feature_record, resource]} (per preset: section_offering for assessment/attendance/roster; term for class_timetable/exam_timetable/students/load_result; feature_record:lab_schedule; resource for assets)
    steps: uploaded (form: source file slot or manual grid (surface 'grid'), mappingProfile picker; assignee creator; parse auto event document.linked match {subjectId: 'record.id', slotKey: 'source'} -> parsed (effect import.parse)) -> parsed (surface 'mapping'; validate -> validated (effect import.applyMapping + preset validator; on errors the validator returns a guard failure that routes to rejected via action validate_failed auto event import.validation_failed)) -> rejected (surface 'preview' with row fixes; revalidate -> parsed; discard -> discarded) -> validated (surface 'preview'; commit -> committed (guards import.sectionNotLocked (assessment/attendance), import.actorMayCommit (TeachingAssignment or academic.manage); effects preset committer in one tx, import.setCommittedAt, prior batch marked replaced, event import.committed); discard -> discarded) | terminalStates: committed (success), discarded (cancelled) | listViews: by_context, mine
    adapters: backing import_batch.backing, effect import.parse (exceljs-hardened / papaparse), effect import.applyMapping (ColumnMappingProfile header aliases), validate import.validate.<kind> (assessment: roster/scheme/marks/duplicates; attendance; roster; students; staff; lab_schedule; class_timetable; exam_timetable; load_result; assets), effect import.commit.<kind> (AssessmentRecord replace + snapshot_compute; StudentAttendanceSummary; Enrollment; ClassTimetableSlot; LabSession; ExamSession; TeachingAssignment diff; Asset), guard import.sectionNotLocked, guard import.actorMayCommit, export import.template.<kind> (roster-prefilled download), surface grid, mapping, preview
- student_issue [Student Communication (§21) — section issue intake | seeded in P24 | navigation {group:'communication', order:20, icon:'message-square-warning', visibleRoles:[department_head,deputy_head,student_rep]} | scope {level:'section', scopeFrom:'parent'} | record {numberPrefix:'SI', backing:{kind:'task', taskKind:'student_issue', extension:'case'}; fields category single_choice, description long_text, affected_students number, responsible person_picker, waitingOn, resolution} (reps have 'limited' access via requester/section_rep relationships) | permissions.defaults {department_head:full, deputy_head:full, instructor:assigned, student_rep:limited}] parent={subjectType:'section', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true} (rep assignee derived from STUDENT_REP@section)
    steps: intake (form section_issue: category, description, affected_students; slot documents; assignee relationship section_rep; submit -> open (effect issue.notifyDh)) -> open (assignee role department_head|deputy_head; assign -> assigned (kind assign, reassignTo record_field responsible)) -> assigned (assignee record_field responsible; onEnter notify ackRequired; effect case.subscribeIntervalNudge; start -> in_progress) -> in_progress (wait -> waiting (requiredFields waitingOn); resolve -> resolved (requiredFields resolution; notify requester rep)) -> waiting (resume -> in_progress) -> resolved (close -> closed; auto close after_days settingKey case.autoCloseDays; reopen -> in_progress (actors relationship requester | role department_head,deputy_head)) | terminalStates: closed (success; effect case.cancelNudge), cancelled (cancelled) | listViews: by_section, unresolved (states intake..resolved), mine | counters: unresolved_issues (DH/DPT, warning), my_section_open_issues (student_rep)
    adapters: backing case.backing (kind student_issue, sectionId, originRef thread|manual), effect case.subscribeIntervalNudge / case.cancelNudge, auto case.autoClose, effect case.setResolvedAt, projection case.openIssues (by section and responsible; unresolved issues report), relationship issue.repLimitedAccess (limited level for the section's reps), effect issue.notifyDh
- announcement [Student Communication / Notification fan-out (§21, §27) | seeded in P24 | navigation {group:'communication', order:10, icon:'bell', visibleRoles:[department_head,deputy_head,instructor,student_rep]} | scope {level:'department', scopeFrom:'record_field', fieldKey:'audienceSpec'} | record {numberPrefix:'AN', backing:{kind:'module', adapter:'announcement.backing'}; fields title, body long_text, audienceSpec audience_picker, ackRequired boolean, expiresAt datetime, templateKey template picker (kind message)} (Announcement; publishedAt is a derived cache) | permissions.defaults {department_head:full, deputy_head:full, instructor:view, student_rep:view, student:view}] parent=none
    steps: draft (form announcement; slot attachments; assignee creator; publish -> published (guard campaign.audienceNonEmpty; effect announcement.fanout); discard -> discarded) -> published (wait; surface 'ack_status' (Scheduler.ackStatus); expire auto field_datetime expiresAt -> expired; withdraw -> withdrawn) | terminalStates: expired (success), withdrawn (cancelled), discarded (cancelled) | listViews: published (state published, sort createdAt desc), drafts | counters: announcements_unacknowledged (DH/DPT)
    adapters: backing announcement.backing, effect announcement.fanout (Notification.notify with dedupeKey per recipient, email delivery for persons without a User; setPublishedAt), guard campaign.audienceNonEmpty (shared), auto announcement.autoExpire, surface ack_status
- course_offering [Academic Registry — offering lifecycle (blueprint workflow course_offering) | seeded in P14 (offering decisions from campaigns) | navigation {group:'academic', order:5, icon:'graduation-cap', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department'} | record {numberPrefix:'CO', backing:{kind:'module', adapter:'course_offering.backing'}; fields termId term_picker (locked), coordinatorPersonId person_picker, decisionNote} (CourseOffering) | permissions.defaults {department_head:full, deputy_head:manage, instructor:view}] parent={subjectType:'course', relation:'parent', required:true, inheritPermissions:false, listUnderParent:true, createFromParent:true}
    steps: planned (assignee role deputy_head|department_head; confirm -> confirmed (also via campaign decision effects); cancel -> cancelled (effect offering.notifyCancelled)) -> confirmed (wait; start auto calendar teaching start -> running; cancel -> cancelled) -> running (wait; complete auto calendar teaching end -> completed (effects offering.freezeSnapshots, offering.setSchemeStructureLock)) | terminalStates: completed (success), cancelled (cancelled) | permission academic.manage | listViews: by_term, planned (state planned)
    adapters: backing course_offering.backing (ensureOffering), auto offering.autoStart / offering.autoComplete (calendar-anchored ScheduledJobs), effect offering.freezeSnapshots, effect offering.setSchemeStructureLock, effect offering.notifyCancelled, effect offering.decisionFromCampaign (called by addDrop.offeringDecision / elective.capacityOffer)
- generic_request [Platform sample (non-system; seeded in P9; used by tests, e2e and as the wizard's default clone source) | navigation {group:'operations', order:90, icon:'inbox', visibleRoles:[department_head,deputy_head,instructor]} | scope {level:'department'} | record {numberPrefix:'GR', backing:{kind:'feature_record'}; fields subject, details long_text, urgency single_choice} | permissions.defaults {department_head:full, deputy_head:review, instructor:own}] parent=none
    steps: request (form: subject, details, urgency; slot supporting_documents; assignee creator; submit -> review) -> parallel review { static branches reviewer_a (step review_a: assignee role deputy_head; approve -> $done; reject -> reject (requiredComment)), reviewer_b (step review_b: assignee role department_head; approve -> $done; reject -> reject (requiredComment)); completion quorum 1; onComplete approval; onAnyReject rejected } -> approval (assignee role department_head; approve -> approved; request_revision -> request (requiredComment)) | terminalStates: approved (success), rejected (rejected), cancelled (cancelled; action cancel from request by owner) | listViews: all, mine | counters: requests_pending_review (DH/DPT)
    adapters: 
