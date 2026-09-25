import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";
import { contextOf } from "../subject-registry";

// Who may see a row, written as tokens on the row itself, and who a person is, written as the
// same tokens. A search is then an array overlap — which PostgreSQL does with a GIN index —
// rather than a permission check per hit. The tokens are deliberately coarse: they narrow the
// result set, and `can()` still has the last word on everything that comes back.

export type AclToken = string;

export function departmentToken(departmentId: string): AclToken {
  return `dept:${departmentId}`;
}

export function roleToken(roleKey: string, departmentId: string): AclToken {
  return `role:${roleKey}@dept:${departmentId}`;
}

export function personToken(personId: string): AclToken {
  return `person:${personId}`;
}

export function groupToken(groupId: string): AclToken {
  return `group:${groupId}`;
}

/** The tokens a subject's row carries: its department, its owner, and the group it belongs to. */
export async function tokensForSubject(
  db: Db,
  subject: { subjectType: string; subjectId: string },
  departmentId: string,
): Promise<AclToken[]> {
  const tokens = new Set<AclToken>([departmentToken(departmentId)]);
  const context = await contextOf(db, subject).catch(() => null);
  if (context?.ownerPersonId) tokens.add(personToken(context.ownerPersonId));
  if (context?.groupId) tokens.add(groupToken(context.groupId));
  return Array.from(tokens);
}

/** The tokens a person carries: their department, their roles, themselves, their groups. */
export async function tokensForActor(db: Db, actor: Actor): Promise<AclToken[]> {
  const tokens = new Set<AclToken>([departmentToken(actor.departmentId)]);
  if (actor.personId) tokens.add(personToken(actor.personId));

  const grants = await db.roleGrant.findMany({
    where: {
      userId: actor.userId,
      departmentId: actor.departmentId,
      validFrom: { lte: new Date() },
      OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
    },
    select: { role: { select: { key: true } } },
  });
  for (const grant of grants) tokens.add(roleToken(grant.role.key, actor.departmentId));

  if (actor.personId) {
    const memberships = await db.groupMembership.findMany({
      where: { personId: actor.personId, validTo: null },
      select: { groupId: true },
    });
    for (const membership of memberships) tokens.add(groupToken(membership.groupId));
  }
  return Array.from(tokens);
}
