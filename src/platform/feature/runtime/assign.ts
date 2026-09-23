import type { Db } from "../../../lib/db/types";
import { dbAudienceLoader, resolveAudienceIds } from "../../people/audience";
import { contextOf, isRegistered, relationships } from "../../subject-registry";
import type { AssigneeRuleType as AssigneeRule } from "../schema";

// Who a step belongs to. An assignee rule is resolved once, when the step is entered, and the
// result is stored on the step instance: a later change of roles or members must not silently
// move work someone has already started.

export interface Assignee {
  type: "person" | "group";
  id: string;
}

export interface AssignContext {
  tx: Db;
  departmentId: string;
  record: {
    id: string;
    ownerPersonId: string;
    createdByPersonId: string;
    data: Record<string, unknown>;
    parentSubjectType?: string | null;
    parentSubjectId?: string | null;
  };
  /** For a dynamic parallel group: the person this branch belongs to. */
  branchPersonId?: string | null;
}

export class AssigneeUnresolvedError extends Error {
  constructor(rule: AssigneeRule, reason: string) {
    super(`The assignee rule "${rule.type}" could not be resolved: ${reason}`);
    this.name = "AssigneeUnresolvedError";
  }
}

export async function resolveAssignee(
  rule: AssigneeRule,
  ctx: AssignContext,
): Promise<Assignee | null> {
  if (ctx.branchPersonId) return { type: "person", id: ctx.branchPersonId };

  switch (rule.type) {
    case "owner":
      return { type: "person", id: ctx.record.ownerPersonId };
    case "creator":
      return { type: "person", id: ctx.record.createdByPersonId };
    case "person":
      return { type: "person", id: rule.personId };
    case "group":
      return { type: "group", id: rule.groupId };
    case "record_field": {
      const value = ctx.record.data[rule.fieldKey];
      if (typeof value !== "string" || !value) return null;
      // a group picker writes a group id; a person picker a person id
      const group = await ctx.tx.group.findUnique({ where: { id: value } });
      return group ? { type: "group", id: value } : { type: "person", id: value };
    }
    case "role": {
      const persons = await resolveAudienceIds(
        { roles: rule.roles },
        dbAudienceLoader(ctx.tx, ctx.departmentId),
      );
      const first = persons[0];
      return first ? { type: "person", id: first } : null;
    }
    case "relationship":
      return resolveRelationship(rule.rel, ctx);
  }
}

/** Relationship rules read the parent through the SubjectRegistry, never through a join here. */
async function resolveRelationship(rel: string, ctx: AssignContext): Promise<Assignee | null> {
  const parent =
    ctx.record.parentSubjectType && ctx.record.parentSubjectId
      ? { subjectType: ctx.record.parentSubjectType, subjectId: ctx.record.parentSubjectId }
      : null;

  if (rel === "requester") return { type: "person", id: ctx.record.createdByPersonId };
  if (rel === "reviewer" || rel === "participant") return null;
  if (!parent || !isRegistered(parent.subjectType)) return null;

  const context = await contextOf(ctx.tx, parent);
  if (rel === "parent_owner")
    return context?.ownerPersonId ? { type: "person", id: context.ownerPersonId } : null;
  if (rel === "parent_member" || rel === "parent_chair")
    return context?.groupId ? { type: "group", id: context.groupId } : null;
  return null;
}

/** Whether a person satisfies a relationship to the record's parent (used by the actor guard). */
export async function hasRelationship(
  tx: Db,
  subject: { subjectType: string; subjectId: string },
  personId: string | null,
  rel: string,
): Promise<boolean> {
  if (!personId || !isRegistered(subject.subjectType)) return false;
  const rels = await relationships(tx, subject, personId);
  return rels.includes(rel as never);
}

/** Re-points an active step at someone else; the caller has already checked the permission. */
export async function reassign(
  tx: Db,
  stepInstanceId: string,
  assignee: Assignee,
): Promise<void> {
  await tx.featureStepInstance.update({
    where: { id: stepInstanceId },
    data: { assigneeType: assignee.type, assigneeId: assignee.id },
  });
}
