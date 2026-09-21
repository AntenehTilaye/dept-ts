import type { Db } from "../../lib/db/types";
import { can, type Actor } from "../identity/can";
import { dbPolicyStore } from "../identity/policy-store";
import { groupsOf } from "../people/groups";
import { relationships } from "../subject-registry";
import type { SubjectRef } from "../subject-registry/types";
import type { AccessGate } from "./access";

/** The access gate of an actor, reading through the caller's (department) client. */
export function gateFor(db: Db, actor: Actor): AccessGate {
  return {
    isAdmin: actor.isAdmin,
    userId: actor.userId,
    personId: actor.personId,
    can: async (key, ref, verb) =>
      (await can(dbPolicyStore, actor, key, ref, verb ? { verb } : {})).allowed,
    relationships: (ref: SubjectRef) => relationships(db, ref, actor.personId),
    roleKeys: async () =>
      (await dbPolicyStore.activeGrants(actor.userId, actor.departmentId, new Date())).map(
        (g) => g.roleKey,
      ),
    groupIds: async () =>
      actor.personId ? (await groupsOf(db, actor.personId)).map((m) => m.groupId) : [],
  };
}
