import { z } from "zod";

// Who may act / who is assigned (design part 03 §1). Shared by the workflow contract and the
// feature builder; the feature phase re-exports it.

// The membership roles plus the RoleGrant-only `committee_chair` and the global `admin`
// (part 03 §1: RoleKey = NavRoleKey ∪ {committee_chair}); `src/lib/auth/access.ts` owns the list.
export const RoleKeySchema = z.enum([
  "department_head",
  "deputy_head",
  "instructor",
  "committee_member",
  "committee_chair",
  "student_rep",
  "student",
  "lab_staff",
  "admin",
]);

export const RelationshipRule = z.enum([
  "parent_owner",
  "parent_chair",
  "parent_member",
  "requester",
  "reviewer",
  "participant",
  "section_rep",
  "teaching_staff_of_parent",
]);

export const actorVariants = {
  owner: z.object({ type: z.literal("owner") }),
  creator: z.object({ type: z.literal("creator") }),
  /** Assignee of the current step (a person, or a member of the assigned group). */
  assignee: z.object({ type: z.literal("assignee") }),
  role: z.object({
    type: z.literal("role"),
    roles: z.array(RoleKeySchema).min(1),
    scope: z.enum(["department", "parent"]).default("department"),
  }),
  relationship: z.object({ type: z.literal("relationship"), rel: RelationshipRule }),
  /** Explicit permission key, e.g. portfolio.review. */
  permission: z.object({ type: z.literal("permission"), key: z.string().min(1) }),
  person: z.object({ type: z.literal("person"), personId: z.string().min(1) }),
  group: z.object({ type: z.literal("group"), groupId: z.string().min(1) }),
  /** A person_picker/group_picker header field of the record. */
  record_field: z.object({ type: z.literal("record_field"), fieldKey: z.string().min(1) }),
  /** Automatic actions only. */
  system: z.object({ type: z.literal("system") }),
};

export const ActorRule = z.discriminatedUnion("type", [
  actorVariants.owner,
  actorVariants.creator,
  actorVariants.assignee,
  actorVariants.role,
  actorVariants.relationship,
  actorVariants.permission,
  actorVariants.person,
  actorVariants.group,
  actorVariants.record_field,
  actorVariants.system,
]);
export type ActorRule = z.infer<typeof ActorRule>;

export const AssigneeRule = z.discriminatedUnion("type", [
  actorVariants.owner,
  actorVariants.creator,
  actorVariants.role,
  actorVariants.relationship,
  actorVariants.person,
  actorVariants.group,
  actorVariants.record_field,
]);
export type AssigneeRule = z.infer<typeof AssigneeRule>;
