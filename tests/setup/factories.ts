import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db/types";
import { createGroup, addMember } from "@/platform/people/groups";
import { ensurePerson, attachToDepartment } from "@/platform/people/persons";
import { upsertStaffProfile } from "@/platform/people/staff";
import { upsertStudent, setSectionMembership } from "@/platform/people/students";
import { upsertProgram, upsertCourse } from "@/platform/academic/courses";
import { ensureOffering, ensureSectionOffering } from "@/platform/academic/offerings";
import { SEED_YEARS } from "../../prisma/seed/calendar";

// Factories write through the real service API (never raw inserts) except where a test
// needs a corrupt state. Every factory takes the department transaction and id first.

export function uniqueSuffix(): string {
  return randomBytes(3).toString("hex");
}

export async function person(
  db: Db,
  departmentId: string,
  over: {
    fullName?: string;
    email?: string | null;
    type?: "staff" | "student" | "external";
    userId?: string | null;
  } = {},
) {
  const s = uniqueSuffix();
  const p = await ensurePerson(db, {
    fullName: over.fullName ?? `Person ${s}`,
    email: over.email === undefined ? `person.${s}@deptts.local` : over.email,
    type: over.type ?? "staff",
    userId: over.userId ?? null,
  });
  await attachToDepartment(db, departmentId, p.id);
  return p;
}

export async function staff(db: Db, departmentId: string, over: Parameters<typeof person>[2] = {}) {
  const p = await person(db, departmentId, { ...over, type: "staff" });
  await upsertStaffProfile(db, departmentId, p.id, {
    staffId: `S-${uniqueSuffix()}`,
    academicRank: "Lecturer",
  });
  return p;
}

export async function program(db: Db, departmentId: string) {
  return upsertProgram(db, departmentId, {
    code: `P${uniqueSuffix().toUpperCase()}`,
    name: "Test Program",
    degreeLevel: "BSc",
    durationYears: 4,
  });
}

export async function currentYear(db: Db, departmentId: string) {
  return db.academicYear.findUniqueOrThrow({
    where: { departmentId_code: { departmentId, code: SEED_YEARS.current.code } },
  });
}

export async function currentTermOf(db: Db, departmentId: string) {
  const year = await currentYear(db, departmentId);
  return db.term.findUniqueOrThrow({
    where: { academicYearId_ordinal: { academicYearId: year.id, ordinal: "first" } },
  });
}

export async function section(
  db: Db,
  departmentId: string,
  over: { programId?: string; academicYearId?: string; code?: string; yearLevel?: number } = {},
) {
  const programId = over.programId ?? (await program(db, departmentId)).id;
  const academicYearId = over.academicYearId ?? (await currentYear(db, departmentId)).id;
  const code = over.code ?? `SEC-${uniqueSuffix()}`;
  const group = await createGroup(db, departmentId, { kind: "section", name: code });
  const s = await db.section.create({
    data: {
      departmentId,
      programId,
      academicYearId,
      yearLevel: over.yearLevel ?? 1,
      code,
      groupId: group.id,
    },
  });
  await db.group.update({
    where: { id: group.id },
    data: { contextType: "section", contextId: s.id },
  });
  return s;
}

export async function student(
  db: Db,
  departmentId: string,
  over: {
    sectionId?: string;
    programId?: string;
    email?: string | null;
    userId?: string | null;
    fullName?: string;
  } = {},
) {
  const sec = over.sectionId
    ? await db.section.findUniqueOrThrow({ where: { id: over.sectionId } })
    : null;
  const programId = over.programId ?? sec?.programId ?? (await program(db, departmentId)).id;
  const p = await person(db, departmentId, {
    type: "student",
    email: over.email,
    userId: over.userId,
    fullName: over.fullName,
  });
  await upsertStudent(db, departmentId, p.id, {
    studentNumber: `ST/${uniqueSuffix()}`,
    programId,
    admissionYear: 2024,
  });
  if (sec)
    await setSectionMembership(db, departmentId, {
      studentId: p.id,
      sectionId: sec.id,
      academicYearId: sec.academicYearId,
      from: new Date("2026-09-01T00:00:00Z"),
    });
  return p;
}

export async function committee(
  db: Db,
  departmentId: string,
  members: Array<{ personId: string; role?: "chair" | "member" | "secretary" }> = [],
) {
  const g = await createGroup(db, departmentId, {
    kind: "committee",
    name: `Committee ${uniqueSuffix()}`,
  });
  const memberships = [];
  for (const m of members)
    memberships.push(
      await addMember(db, departmentId, g.id, {
        personId: m.personId,
        roleInGroup: m.role ?? "member",
      }),
    );
  return { group: g, memberships };
}

export async function course(
  db: Db,
  departmentId: string,
  over: { code?: string; predecessorCourseId?: string | null } = {},
) {
  return upsertCourse(db, departmentId, {
    code: over.code ?? `C${uniqueSuffix().toUpperCase()}`,
    title: "Test Course",
    creditHours: 3,
    courseType: "core",
    predecessorCourseId: over.predecessorCourseId ?? null,
  });
}

export async function offering(
  db: Db,
  departmentId: string,
  over: { courseId?: string; termId?: string; sectionIds?: string[] } = {},
) {
  const courseId = over.courseId ?? (await course(db, departmentId)).id;
  const termId = over.termId ?? (await currentTermOf(db, departmentId)).id;
  const o = await ensureOffering(db, departmentId, { courseId, termId });
  const sectionOfferings = [];
  for (const sectionId of over.sectionIds ?? [])
    sectionOfferings.push(
      await ensureSectionOffering(db, departmentId, { courseOfferingId: o.id, sectionId }),
    );
  return { offering: o, sectionOfferings };
}
