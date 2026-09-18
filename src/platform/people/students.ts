import type { RowSource, StudentStatus } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { attachToDepartment } from "./persons";

export interface StudentInput {
  studentNumber: string;
  programId: string;
  admissionYear: number;
  status?: StudentStatus;
}

export async function upsertStudent(
  db: Db,
  departmentId: string,
  personId: string,
  input: StudentInput,
) {
  await attachToDepartment(db, departmentId, personId);
  const data = {
    studentNumber: input.studentNumber.trim(),
    programId: input.programId,
    admissionYear: input.admissionYear,
    ...(input.status ? { status: input.status } : {}),
  };
  return db.student.upsert({
    where: { personId },
    update: data,
    create: { personId, departmentId, ...data },
  });
}

export async function getStudent(db: Db, personId: string) {
  return db.student.findUnique({ where: { personId }, include: { person: true, program: true } });
}

/** The student's section for an academic year as of a date (memberships are time-varying). */
export async function currentSectionMembership(
  db: Db,
  studentId: string,
  academicYearId: string,
  asOf = new Date(),
) {
  return db.studentSectionMembership.findFirst({
    where: {
      studentId,
      academicYearId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { section: true },
    orderBy: { validFrom: "desc" },
  });
}

/**
 * Moves a student into a section for the year: closes the open membership (if any) and opens
 * a new one from `from`. Returns the new membership. Idempotent when already in that section.
 */
export async function setSectionMembership(
  db: Db,
  departmentId: string,
  input: {
    studentId: string;
    sectionId: string;
    academicYearId: string;
    from?: Date;
    source?: RowSource;
  },
) {
  const from = input.from ?? new Date();
  const open = await currentSectionMembership(db, input.studentId, input.academicYearId, from);
  if (open && open.sectionId === input.sectionId) return open;
  if (open) {
    await db.studentSectionMembership.update({ where: { id: open.id }, data: { validTo: from } });
  }
  const created = await db.studentSectionMembership.create({
    data: {
      departmentId,
      studentId: input.studentId,
      sectionId: input.sectionId,
      academicYearId: input.academicYearId,
      validFrom: from,
      source: input.source ?? "manual",
    },
    include: { section: true },
  });
  const { syncStudentSectionGrants } = await import("../identity/derive");
  await syncStudentSectionGrants(db, departmentId, input.studentId);
  return created;
}

/** Students currently in a section (as of a date). */
export async function studentsInSection(db: Db, sectionId: string, asOf = new Date()) {
  const rows = await db.studentSectionMembership.findMany({
    where: {
      sectionId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { student: { include: { person: true } } },
    orderBy: { student: { person: { fullName: "asc" } } },
  });
  return rows.map((r) => r.student);
}
