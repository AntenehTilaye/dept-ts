import type { Db } from "../../lib/db/types";

// CourseOffering / SectionOffering: idempotent ensure operations and the assessment locks.

/**
 * The offering of a course in a term, created if it is not there yet.
 *
 * Every offering is a `course_offering` record, so bringing one into being needs the record it is
 * the life of: the feature's backing adapter passes `featureRecordId`, and nothing else creates an
 * offering row. Callers that want a new offering ask the runtime for a record instead
 * (`provisionOffering` in the assessment module), which comes back here through the adapter.
 */
export async function ensureOffering(
  db: Db,
  departmentId: string,
  input: {
    courseId: string;
    termId: string;
    coordinatorPersonId?: string | null;
    featureRecordId?: string;
  },
) {
  const existing = await db.courseOffering.findUnique({
    where: { courseId_termId: { courseId: input.courseId, termId: input.termId } },
  });
  if (existing) {
    const data: { coordinatorPersonId?: string | null; featureRecordId?: string } = {};
    if (
      input.coordinatorPersonId !== undefined &&
      input.coordinatorPersonId !== existing.coordinatorPersonId
    )
      data.coordinatorPersonId = input.coordinatorPersonId;
    if (input.featureRecordId && input.featureRecordId !== existing.featureRecordId)
      data.featureRecordId = input.featureRecordId;
    if (!Object.keys(data).length) return existing;
    return db.courseOffering.update({ where: { id: existing.id }, data });
  }
  if (!input.featureRecordId)
    throw new Error(
      "An offering is a course_offering record: create the record, which creates the offering",
    );
  return db.courseOffering.create({
    data: {
      departmentId,
      courseId: input.courseId,
      termId: input.termId,
      coordinatorPersonId: input.coordinatorPersonId ?? null,
      featureRecordId: input.featureRecordId,
    },
  });
}

export async function ensureSectionOffering(
  db: Db,
  departmentId: string,
  input: { courseOfferingId: string; sectionId: string },
) {
  const existing = await db.sectionOffering.findUnique({
    where: {
      courseOfferingId_sectionId: {
        courseOfferingId: input.courseOfferingId,
        sectionId: input.sectionId,
      },
    },
  });
  if (existing) return existing;
  const section = await db.section.findUniqueOrThrow({ where: { id: input.sectionId } });
  return db.sectionOffering.create({
    data: {
      departmentId,
      courseOfferingId: input.courseOfferingId,
      sectionId: input.sectionId,
      sectionCode: section.code,
    },
  });
}

export async function getOffering(db: Db, offeringId: string) {
  return db.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      course: true,
      term: { include: { academicYear: true } },
      coordinator: true,
      sectionOfferings: {
        include: {
          section: { include: { program: { select: { code: true } } } },
          teachingAssignments: {
            where: { validTo: null },
            include: { person: true },
            orderBy: { role: "asc" },
          },
          _count: { select: { enrollments: true } },
        },
        orderBy: { sectionCode: "asc" },
      },
    },
  });
}

export async function listOfferings(db: Db, departmentId: string, termId?: string) {
  return db.courseOffering.findMany({
    where: { departmentId, ...(termId ? { termId } : {}) },
    include: {
      course: { select: { code: true, title: true } },
      term: { select: { name: true, status: true, academicYear: { select: { code: true } } } },
      coordinator: { select: { fullName: true } },
      _count: { select: { sectionOfferings: true } },
    },
    orderBy: [{ term: { startDate: "desc" } }, { course: { code: "asc" } }],
  });
}

/** Locks a section's assessment (portfolio submitted); idempotent. */
export async function lockSectionAssessment(
  db: Db,
  sectionOfferingId: string,
  portfolioId: string,
  at = new Date(),
) {
  const so = await db.sectionOffering.findUniqueOrThrow({ where: { id: sectionOfferingId } });
  if (so.assessmentLockedAt) return so;
  return db.sectionOffering.update({
    where: { id: sectionOfferingId },
    data: { assessmentLockedAt: at, assessmentLockedByPortfolioId: portfolioId },
  });
}

export async function unlockSectionAssessment(db: Db, sectionOfferingId: string) {
  return db.sectionOffering.update({
    where: { id: sectionOfferingId },
    data: { assessmentLockedAt: null, assessmentLockedByPortfolioId: null },
  });
}

export async function isSectionLocked(db: Db, sectionOfferingId: string): Promise<boolean> {
  const so = await db.sectionOffering.findUnique({
    where: { id: sectionOfferingId },
    select: { assessmentLockedAt: true },
  });
  return !!so?.assessmentLockedAt;
}

/** The scheme structure lock is a cache: set when any section of the offering is locked. */
export async function recomputeSchemeStructureLock(db: Db, courseOfferingId: string) {
  const locked = await db.sectionOffering.findFirst({
    where: { courseOfferingId, assessmentLockedAt: { not: null } },
    orderBy: { assessmentLockedAt: "asc" },
  });
  return db.courseOffering.update({
    where: { id: courseOfferingId },
    data: { schemeStructureLockedAt: locked?.assessmentLockedAt ?? null },
  });
}
