import type { GroupKind, GroupRole, SubjectType } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { syncGroupGrants, syncGroupMembershipGrants } from "../identity/derive";

// Group: the reusable membership container (committees, sections, meeting participants, panels,
// lab teams, ad-hoc audience snapshots). Committee groups drive derived grants.

export interface CreateGroupInput {
  kind: GroupKind;
  name: string;
  context?: { subjectType: SubjectType; subjectId: string } | null;
}

export async function createGroup(db: Db, departmentId: string, input: CreateGroupInput) {
  return db.group.create({
    data: {
      departmentId,
      kind: input.kind,
      name: input.name.trim(),
      contextType: input.context?.subjectType ?? null,
      contextId: input.context?.subjectId ?? null,
    },
  });
}

export async function getGroup(db: Db, groupId: string) {
  return db.group.findUnique({ where: { id: groupId } });
}

export async function setGroupStatus(
  db: Db,
  departmentId: string,
  groupId: string,
  status: "active" | "inactive",
  at = new Date(),
) {
  const group = await db.group.update({
    where: { id: groupId },
    data: { status, deactivatedAt: status === "inactive" ? at : null },
  });
  await syncGroupGrants(db, departmentId, groupId, at);
  return group;
}

export interface AddMemberInput {
  personId: string;
  roleInGroup?: GroupRole;
  responsibilities?: string | null;
  validFrom?: Date;
}

/** Adds (or re-roles) a person; an open membership with the same role is returned unchanged. */
export async function addMember(
  db: Db,
  departmentId: string,
  groupId: string,
  input: AddMemberInput,
) {
  const from = input.validFrom ?? new Date();
  const role = input.roleInGroup ?? "member";
  const open = await db.groupMembership.findFirst({
    where: { groupId, personId: input.personId, validTo: null },
  });
  if (open && open.roleInGroup === role) return open;
  if (open) {
    await db.groupMembership.update({ where: { id: open.id }, data: { validTo: from } });
    await syncGroupMembershipGrants(db, departmentId, open.id, from);
  }
  const membership = await db.groupMembership.create({
    data: {
      departmentId,
      groupId,
      personId: input.personId,
      roleInGroup: role,
      responsibilities: input.responsibilities ?? null,
      validFrom: from,
    },
  });
  await syncGroupMembershipGrants(db, departmentId, membership.id, from);
  return membership;
}

/** Ends the open membership of a person (grants expire with it). */
export async function removeMember(
  db: Db,
  departmentId: string,
  groupId: string,
  personId: string,
  at = new Date(),
) {
  const open = await db.groupMembership.findMany({ where: { groupId, personId, validTo: null } });
  for (const m of open) {
    await db.groupMembership.update({ where: { id: m.id }, data: { validTo: at } });
    await syncGroupMembershipGrants(db, departmentId, m.id, at);
  }
  return open.length;
}

/** Open memberships of a group as of a date, with persons. */
export async function membersOf(db: Db, groupId: string, asOf = new Date()) {
  return db.groupMembership.findMany({
    where: {
      groupId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { person: true },
    orderBy: [{ roleInGroup: "asc" }, { person: { fullName: "asc" } }],
  });
}

/** Groups a person currently belongs to (optionally of one kind). */
export async function groupsOf(db: Db, personId: string, kind?: GroupKind, asOf = new Date()) {
  return db.groupMembership.findMany({
    where: {
      personId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      ...(kind ? { group: { kind } } : {}),
    },
    include: { group: true },
    orderBy: { group: { name: "asc" } },
  });
}

export function isChair(role: GroupRole): boolean {
  return role === "chair" || role === "lead";
}
