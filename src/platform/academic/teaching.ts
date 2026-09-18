import type { AssignmentSource, TeachingRole } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { syncTeachingGrants } from "../identity/derive";

export interface AssignTeachingInput {
  sectionOfferingId: string;
  personId: string;
  role: TeachingRole;
  loadHours?: number | null;
  sharePercent?: number | null;
  source?: AssignmentSource;
  importBatchId?: string | null;
  from?: Date;
}

/** Opens a teaching assignment (idempotent for an open one with the same role) and derives instructor@section_offering. */
export async function assignTeaching(db: Db, departmentId: string, input: AssignTeachingInput) {
  const from = input.from ?? new Date();
  const open = await db.teachingAssignment.findFirst({
    where: {
      sectionOfferingId: input.sectionOfferingId,
      personId: input.personId,
      role: input.role,
      validTo: null,
    },
  });
  if (open) return open;
  const ta = await db.teachingAssignment.create({
    data: {
      departmentId,
      sectionOfferingId: input.sectionOfferingId,
      personId: input.personId,
      role: input.role,
      loadHours: input.loadHours ?? null,
      sharePercent: input.sharePercent ?? null,
      source: input.source ?? "manual",
      importBatchId: input.importBatchId ?? null,
      validFrom: from,
    },
  });
  await syncTeachingGrants(db, departmentId, ta.id, from);
  return ta;
}

export async function endTeaching(
  db: Db,
  departmentId: string,
  teachingAssignmentId: string,
  at = new Date(),
) {
  const ta = await db.teachingAssignment.update({
    where: { id: teachingAssignmentId },
    data: { validTo: at },
  });
  await syncTeachingGrants(db, departmentId, teachingAssignmentId, at);
  return ta;
}

/** A person's open teaching assignments (optionally limited to one term). */
export async function teachingOf(db: Db, personId: string, termId?: string, asOf = new Date()) {
  return db.teachingAssignment.findMany({
    where: {
      personId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
      ...(termId ? { sectionOffering: { courseOffering: { termId } } } : {}),
    },
    include: {
      sectionOffering: {
        include: { section: true, courseOffering: { include: { course: true, term: true } } },
      },
    },
    orderBy: { validFrom: "desc" },
  });
}

/** Open teachers of a section offering. */
export async function teachersOfSection(db: Db, sectionOfferingId: string, asOf = new Date()) {
  return db.teachingAssignment.findMany({
    where: {
      sectionOfferingId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    include: { person: true },
    orderBy: { role: "asc" },
  });
}
