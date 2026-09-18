import { z } from "zod";
import type { Db } from "../../lib/db/types";
import { createGroup } from "./groups";

// Audience resolution: the AudienceSpec of the feature builder (design part 03 §1) resolved to
// persons. Set algebra is pure (`combineAudience`) over id sets supplied by an AudienceLoader,
// so unit tests run on an in-memory loader and the database loader stays thin. Every result is
// intersected with the department's open DepartmentPerson links.

export const AudienceSpecSchema = z.object({
  roles: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  programs: z.array(z.string()).optional(),
  yearLevels: z.array(z.number().int()).optional(),
  sections: z.array(z.string()).optional(),
  sectionOfferings: z.array(z.string()).optional(),
  /** Persons teaching in a section offering (id) or in every section offering of a course offering. */
  teachingIn: z.string().optional(),
  persons: z.array(z.string()).optional(),
  excludePersons: z.array(z.string()).optional(),
});
export type AudienceSpec = z.infer<typeof AudienceSpecSchema>;

export interface AudienceLoader {
  personsWithRoles(roleKeys: string[]): Promise<Set<string>>;
  membersOfGroups(groupIds: string[]): Promise<Set<string>>;
  studentsOfPrograms(programIds: string[]): Promise<Set<string>>;
  studentsOfYearLevels(yearLevels: number[]): Promise<Set<string>>;
  studentsOfSections(sectionIds: string[]): Promise<Set<string>>;
  studentsOfSectionOfferings(sectionOfferingIds: string[]): Promise<Set<string>>;
  teachersOf(offeringOrSectionOfferingId: string): Promise<Set<string>>;
  departmentPersons(): Promise<Set<string>>;
}

export function isEmptySpec(spec: AudienceSpec): boolean {
  return !(
    spec.roles?.length ||
    spec.groups?.length ||
    spec.programs?.length ||
    spec.yearLevels?.length ||
    spec.sections?.length ||
    spec.sectionOfferings?.length ||
    spec.teachingIn ||
    spec.persons?.length
  );
}

/** Pure set algebra: (∪ criteria) \ excludePersons ∩ departmentPersons. */
export function combineAudience(
  parts: Iterable<Set<string>>,
  excludePersons: Iterable<string>,
  departmentPersons: Set<string>,
): string[] {
  const union = new Set<string>();
  for (const part of parts) for (const id of part) union.add(id);
  for (const id of excludePersons) union.delete(id);
  return Array.from(union)
    .filter((id) => departmentPersons.has(id))
    .sort();
}

export async function resolveAudienceIds(
  spec: AudienceSpec,
  loader: AudienceLoader,
): Promise<string[]> {
  if (isEmptySpec(spec)) return [];
  const parts: Set<string>[] = [];
  if (spec.roles?.length) parts.push(await loader.personsWithRoles(spec.roles));
  if (spec.groups?.length) parts.push(await loader.membersOfGroups(spec.groups));
  if (spec.programs?.length) parts.push(await loader.studentsOfPrograms(spec.programs));
  if (spec.yearLevels?.length) parts.push(await loader.studentsOfYearLevels(spec.yearLevels));
  if (spec.sections?.length) parts.push(await loader.studentsOfSections(spec.sections));
  if (spec.sectionOfferings?.length)
    parts.push(await loader.studentsOfSectionOfferings(spec.sectionOfferings));
  if (spec.teachingIn) parts.push(await loader.teachersOf(spec.teachingIn));
  if (spec.persons?.length) parts.push(new Set(spec.persons));
  return combineAudience(parts, spec.excludePersons ?? [], await loader.departmentPersons());
}

const openAt = (asOf: Date) => ({
  validFrom: { lte: asOf },
  OR: [{ validTo: null }, { validTo: { gt: asOf } }],
});

/** The database loader over a department transaction (RLS already restricts rows). */
export function dbAudienceLoader(db: Db, departmentId: string, asOf = new Date()): AudienceLoader {
  return {
    async personsWithRoles(roleKeys) {
      const grants = await db.roleGrant.findMany({
        where: { departmentId, role: { key: { in: roleKeys } }, ...openAt(asOf) },
        select: { user: { select: { person: { select: { id: true } } } } },
      });
      return new Set(grants.map((g) => g.user.person?.id).filter((id): id is string => !!id));
    },
    async membersOfGroups(groupIds) {
      const rows = await db.groupMembership.findMany({
        where: { groupId: { in: groupIds }, ...openAt(asOf) },
        select: { personId: true },
      });
      return new Set(rows.map((r) => r.personId));
    },
    async studentsOfPrograms(programIds) {
      const rows = await db.student.findMany({
        where: { programId: { in: programIds }, status: "active" },
        select: { personId: true },
      });
      return new Set(rows.map((r) => r.personId));
    },
    async studentsOfYearLevels(yearLevels) {
      const rows = await db.studentSectionMembership.findMany({
        where: {
          section: { yearLevel: { in: yearLevels }, academicYear: { status: "active" } },
          ...openAt(asOf),
        },
        select: { studentId: true },
      });
      return new Set(rows.map((r) => r.studentId));
    },
    async studentsOfSections(sectionIds) {
      const rows = await db.studentSectionMembership.findMany({
        where: { sectionId: { in: sectionIds }, ...openAt(asOf) },
        select: { studentId: true },
      });
      return new Set(rows.map((r) => r.studentId));
    },
    async studentsOfSectionOfferings(ids) {
      const rows = await db.enrollment.findMany({
        where: { sectionOfferingId: { in: ids }, status: { in: ["enrolled", "added"] } },
        select: { studentId: true },
      });
      return new Set(rows.map((r) => r.studentId));
    },
    async teachersOf(id) {
      const rows = await db.teachingAssignment.findMany({
        where: {
          AND: [
            { OR: [{ sectionOfferingId: id }, { sectionOffering: { courseOfferingId: id } }] },
            openAt(asOf),
          ],
        },
        select: { personId: true },
      });
      return new Set(rows.map((r) => r.personId));
    },
    async departmentPersons() {
      const rows = await db.departmentPerson.findMany({
        where: { departmentId, leftAt: null },
        select: { personId: true },
      });
      return new Set(rows.map((r) => r.personId));
    },
  };
}

/** Resolves a spec to Person rows in the department. */
export async function resolveAudience(
  db: Db,
  departmentId: string,
  spec: AudienceSpec,
  asOf = new Date(),
) {
  const ids = await resolveAudienceIds(spec, dbAudienceLoader(db, departmentId, asOf));
  if (ids.length === 0) return [];
  return db.person.findMany({ where: { id: { in: ids } }, orderBy: { fullName: "asc" } });
}

/** Freezes the current audience as an ad-hoc group (campaign invitations, meeting participants). */
export async function snapshotAudienceAsGroup(
  db: Db,
  departmentId: string,
  spec: AudienceSpec,
  context: {
    subjectType: "campaign" | "meeting" | "announcement" | "feature_record";
    subjectId: string;
    name?: string;
  },
  asOf = new Date(),
) {
  const ids = await resolveAudienceIds(spec, dbAudienceLoader(db, departmentId, asOf));
  const group = await createGroup(db, departmentId, {
    kind: "adhoc",
    name: context.name ?? `${context.subjectType} ${context.subjectId} audience`,
    context: { subjectType: context.subjectType, subjectId: context.subjectId },
  });
  if (ids.length) {
    await db.groupMembership.createMany({
      data: ids.map((personId) => ({
        departmentId,
        groupId: group.id,
        personId,
        roleInGroup: "member" as const,
        validFrom: asOf,
      })),
    });
  }
  return { group, personIds: ids };
}
