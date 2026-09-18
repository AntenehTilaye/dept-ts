import type { Db } from "../../lib/db/types";
import { syncPersonGrants, syncRepresentativeGrants } from "../identity/derive";

// Section representatives (section 25): assignment closes the previous primary, derives the
// student_rep@section grant and provisions a login (set-password mail) when the student has
// none. `section_rep_primary` (partial unique index) rejects a second open primary.

export interface AssignRepresentativeInput {
  sectionId: string;
  studentId: string;
  academicYearId: string;
  isPrimary?: boolean;
  from?: Date;
  /** Hook so the provisioning step can be replaced in tests. */
  provision?: (person: { id: string; fullName: string; email: string }) => Promise<string>;
}

export async function assignRepresentative(
  db: Db,
  departmentId: string,
  input: AssignRepresentativeInput,
) {
  const from = input.from ?? new Date();
  const isPrimary = input.isPrimary ?? true;
  const student = await db.student.findUniqueOrThrow({
    where: { personId: input.studentId },
    include: { person: true },
  });

  const existing = await db.sectionRepresentative.findFirst({
    where: {
      sectionId: input.sectionId,
      studentId: input.studentId,
      academicYearId: input.academicYearId,
      validTo: null,
    },
  });
  if (existing && existing.isPrimary === isPrimary)
    return { representative: existing, invited: false };

  if (isPrimary) {
    const primaries = await db.sectionRepresentative.findMany({
      where: {
        sectionId: input.sectionId,
        academicYearId: input.academicYearId,
        isPrimary: true,
        validTo: null,
      },
    });
    for (const p of primaries) {
      await db.sectionRepresentative.update({ where: { id: p.id }, data: { validTo: from } });
      await syncRepresentativeGrants(db, departmentId, p.id, from);
    }
  }

  let invited = false;
  if (!student.person.userId && student.person.email && input.provision) {
    const userId = await input.provision({
      id: student.personId,
      fullName: student.person.fullName,
      email: student.person.email,
    });
    await db.person.update({ where: { id: student.personId }, data: { userId } });
    await syncPersonGrants(db, departmentId, student.personId, from);
    invited = true;
  }

  const representative = await db.sectionRepresentative.create({
    data: {
      departmentId,
      sectionId: input.sectionId,
      studentId: input.studentId,
      academicYearId: input.academicYearId,
      validFrom: from,
      isPrimary,
    },
  });
  await syncRepresentativeGrants(db, departmentId, representative.id, from);
  return { representative, invited };
}

export async function endRepresentative(
  db: Db,
  departmentId: string,
  representativeId: string,
  at = new Date(),
) {
  const rep = await db.sectionRepresentative.update({
    where: { id: representativeId },
    data: { validTo: at },
  });
  await syncRepresentativeGrants(db, departmentId, representativeId, at);
  return rep;
}

/** Open representatives of a section in a year. */
export async function representativesOf(
  db: Db,
  sectionId: string,
  academicYearId: string,
  asOf = new Date(),
) {
  return db.sectionRepresentative.findMany({
    where: {
      sectionId,
      academicYearId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { student: { include: { person: true } } },
    orderBy: [{ isPrimary: "desc" }, { validFrom: "asc" }],
  });
}
