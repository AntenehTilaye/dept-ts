import type { PersonType } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";

// Person (GLOBAL) plus its tenant link DepartmentPerson. Every department-facing query joins
// through DepartmentPerson so a person shared by two departments is visible in both while their
// StaffProfile/Student rows stay department-private (RLS).

export interface CreatePersonInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  type: PersonType;
  organizationName?: string | null;
  roleLabel?: string | null;
  userId?: string | null;
}

export async function getPerson(db: Db, personId: string) {
  return db.person.findUnique({ where: { id: personId } });
}

export async function findPersonByEmail(db: Db, email: string) {
  return db.person.findFirst({ where: { email: email.trim().toLowerCase() } });
}

export async function createPerson(db: Db, input: CreatePersonInput) {
  return db.person.create({
    data: {
      fullName: input.fullName.trim(),
      email: input.email ? input.email.trim().toLowerCase() : null,
      phone: input.phone ?? null,
      type: input.type,
      organizationName: input.organizationName ?? null,
      roleLabel: input.roleLabel ?? null,
      userId: input.userId ?? null,
    },
  });
}

/** Creates the person when no one with that email exists yet (email is the natural key). */
export async function ensurePerson(db: Db, input: CreatePersonInput) {
  if (input.email) {
    const existing = await findPersonByEmail(db, input.email);
    if (existing) return existing;
  }
  return createPerson(db, input);
}

export async function updatePerson(
  db: Db,
  personId: string,
  patch: Partial<Omit<CreatePersonInput, "type">> & {
    type?: PersonType;
    status?: "active" | "inactive";
  },
  expectedVersion?: number,
) {
  const person = await db.person.findUniqueOrThrow({ where: { id: personId } });
  if (expectedVersion !== undefined && person.rowVersion !== expectedVersion) {
    throw new Error("The person was changed by someone else; reload and try again");
  }
  return db.person.update({
    where: { id: personId },
    data: {
      ...(patch.fullName !== undefined ? { fullName: patch.fullName.trim() } : {}),
      ...(patch.email !== undefined
        ? { email: patch.email ? patch.email.trim().toLowerCase() : null }
        : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.organizationName !== undefined ? { organizationName: patch.organizationName } : {}),
      ...(patch.roleLabel !== undefined ? { roleLabel: patch.roleLabel } : {}),
      ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      rowVersion: { increment: 1 },
    },
  });
}

/** Links a person to a department (idempotent; reopens a closed link). */
export async function attachToDepartment(db: Db, departmentId: string, personId: string) {
  return db.departmentPerson.upsert({
    where: { departmentId_personId: { departmentId, personId } },
    update: { leftAt: null },
    create: { departmentId, personId },
  });
}

export async function detachFromDepartment(
  db: Db,
  departmentId: string,
  personId: string,
  at = new Date(),
) {
  return db.departmentPerson.updateMany({
    where: { departmentId, personId, leftAt: null },
    data: { leftAt: at },
  });
}

export interface PersonSearch {
  q?: string;
  type?: PersonType;
  includeLeft?: boolean;
  limit?: number;
}

/** Department directory: persons linked to the department, optionally filtered by a trigram-backed name search. */
export async function searchPersons(db: Db, departmentId: string, search: PersonSearch = {}) {
  const q = search.q?.trim();
  const limit = Math.min(search.limit ?? 50, 200);
  if (q) {
    // pg_trgm similarity + substring match; RLS on department_person restricts the join.
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
        FROM person p
        JOIN department_person dp ON dp.person_id = p.id AND dp.department_id = ${departmentId}
       WHERE (${search.includeLeft ?? false} OR dp.left_at IS NULL)
         AND (p.full_name ILIKE '%' || ${q} || '%' OR p.email ILIKE '%' || ${q} || '%' OR similarity(p.full_name, ${q}) > 0.3)
         AND (${search.type ?? null}::text IS NULL OR p.type::text = ${search.type ?? null})
       ORDER BY similarity(p.full_name, ${q}) DESC, p.full_name ASC
       LIMIT ${limit}`;
    const ids = rows.map((r) => r.id);
    const persons = await db.person.findMany({ where: { id: { in: ids } } });
    const byId = new Map(persons.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }
  const links = await db.departmentPerson.findMany({
    where: {
      departmentId,
      ...(search.includeLeft ? {} : { leftAt: null }),
      ...(search.type ? { person: { type: search.type } } : {}),
    },
    include: { person: true },
    orderBy: { person: { fullName: "asc" } },
    take: limit,
  });
  return links.map((l) => l.person);
}

/**
 * Merges `duplicateId` into `keepId`: re-points memberships, teaching, resources, offerings,
 * department links and department-private rows, then deactivates the duplicate.
 */
export async function mergePersons(db: Db, keepId: string, duplicateId: string) {
  if (keepId === duplicateId) throw new Error("Cannot merge a person into itself");
  const [keep, dup] = await Promise.all([
    db.person.findUniqueOrThrow({ where: { id: keepId } }),
    db.person.findUniqueOrThrow({ where: { id: duplicateId } }),
  ]);
  const dupLinks = await db.departmentPerson.findMany({ where: { personId: duplicateId } });
  for (const link of dupLinks) {
    await db.departmentPerson.upsert({
      where: { departmentId_personId: { departmentId: link.departmentId, personId: keepId } },
      update: {},
      create: { departmentId: link.departmentId, personId: keepId, joinedAt: link.joinedAt },
    });
  }
  await db.departmentPerson.deleteMany({ where: { personId: duplicateId } });
  await db.groupMembership.updateMany({
    where: { personId: duplicateId },
    data: { personId: keepId },
  });
  await db.teachingAssignment.updateMany({
    where: { personId: duplicateId },
    data: { personId: keepId },
  });
  await db.profileItem.updateMany({ where: { personId: duplicateId }, data: { personId: keepId } });
  await db.courseOffering.updateMany({
    where: { coordinatorPersonId: duplicateId },
    data: { coordinatorPersonId: keepId },
  });
  await db.resource.updateMany({
    where: { responsiblePersonId: duplicateId },
    data: { responsiblePersonId: keepId },
  });
  if (!keep.userId && dup.userId) {
    await db.person.update({ where: { id: duplicateId }, data: { userId: null } });
    await db.person.update({ where: { id: keepId }, data: { userId: dup.userId } });
  }
  return db.person.update({
    where: { id: duplicateId },
    data: { status: "inactive", email: null, roleLabel: `merged into ${keepId}` },
  });
}
