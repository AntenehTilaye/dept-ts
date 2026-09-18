import type { Db } from "../../lib/db/types";
import { can, type Actor, type PolicyStore } from "../identity/can";
import type { Relationship } from "../identity/levels";
import { relationships as subjectRelationships } from "../subject-registry";
import type { ActorRule } from "./actor-rules";

// Evaluates transition actorRules for an actor. Registry relationships answer owner/creator/
// assignee/relationship rules; roles come from the actor's grants; permission rules go through
// can(). record_field rules are resolved by the feature runtime (registered here later).

export interface ActorRuleContext {
  tx: Db;
  actor: Actor;
  subject: { subjectType: string; subjectId: string };
  store: PolicyStore;
  /** Feature runtime hook for record_field rules. */
  recordField?: (fieldKey: string) => Promise<string[]>;
}

const REL_MAP: Record<string, Relationship> = {
  parent_owner: "owner",
  parent_chair: "chair",
  parent_member: "member",
  requester: "requester",
  reviewer: "reviewer",
  participant: "participant",
  section_rep: "section_rep",
  teaching_staff_of_parent: "assignee",
};

export async function actorRoleKeys(tx: Db, actor: Actor, now = new Date()): Promise<Set<string>> {
  const rows = await tx.roleGrant.findMany({
    where: {
      userId: actor.userId,
      departmentId: actor.departmentId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    include: { role: { select: { key: true } } },
  });
  return new Set(rows.map((r) => r.role.key));
}

export async function matchesActorRule(rule: ActorRule, ctx: ActorRuleContext): Promise<boolean> {
  const { actor } = ctx;
  switch (rule.type) {
    case "system":
      return false;
    case "person":
      return actor.personId === rule.personId;
    case "permission":
      return (await can(ctx.store, actor, rule.key, ctx.subject)).allowed;
    case "role": {
      if (actor.isAdmin) return true;
      const keys = await actorRoleKeys(ctx.tx, actor);
      return rule.roles.some((r) => keys.has(r));
    }
    case "group": {
      if (!actor.personId) return false;
      const now = new Date();
      const m = await ctx.tx.groupMembership.findFirst({
        where: {
          groupId: rule.groupId,
          personId: actor.personId,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
      });
      return !!m;
    }
    case "record_field": {
      if (!actor.personId || !ctx.recordField) return false;
      return (await ctx.recordField(rule.fieldKey)).includes(actor.personId);
    }
    case "owner":
    case "creator":
    case "assignee": {
      const rels = await subjectRelationships(ctx.tx, ctx.subject, actor.personId);
      return rels.includes(rule.type);
    }
    case "relationship": {
      const rels = await subjectRelationships(ctx.tx, ctx.subject, actor.personId);
      return rels.includes(REL_MAP[rule.rel]!);
    }
  }
}

/** Empty rule lists impose nothing; otherwise any matching rule allows. */
export async function matchesAnyActorRule(
  rules: ActorRule[],
  ctx: ActorRuleContext,
): Promise<boolean> {
  if (rules.length === 0) return true;
  for (const r of rules) if (await matchesActorRule(r, ctx)) return true;
  return false;
}
