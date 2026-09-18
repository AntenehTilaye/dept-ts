import type { EnrollmentSource, EnrollmentStatus } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";

export async function roster(db: Db, sectionOfferingId: string) {
  return db.enrollment.findMany({
    where: { sectionOfferingId },
    include: { student: { include: { person: true } } },
    orderBy: { student: { person: { fullName: "asc" } } },
  });
}

export interface EnrollmentDecision {
  sectionOfferingId: string;
  studentId: string;
  status: EnrollmentStatus;
  source: EnrollmentSource;
  decidedInCampaignId?: string | null;
}

/** Upserts one enrollment row (unique per section offering + student) and refreshes the count cache. */
export async function applyEnrollmentDecision(db: Db, departmentId: string, d: EnrollmentDecision) {
  const row = await db.enrollment.upsert({
    where: {
      sectionOfferingId_studentId: {
        sectionOfferingId: d.sectionOfferingId,
        studentId: d.studentId,
      },
    },
    update: {
      status: d.status,
      source: d.source,
      decidedInCampaignId: d.decidedInCampaignId ?? null,
    },
    create: {
      departmentId,
      sectionOfferingId: d.sectionOfferingId,
      studentId: d.studentId,
      status: d.status,
      source: d.source,
      decidedInCampaignId: d.decidedInCampaignId ?? null,
    },
  });
  await refreshEnrolledCount(db, d.sectionOfferingId);
  return row;
}

export async function refreshEnrolledCount(db: Db, sectionOfferingId: string) {
  const enrolledCount = await db.enrollment.count({
    where: { sectionOfferingId, status: { in: ["enrolled", "added"] } },
  });
  await db.sectionOffering.update({ where: { id: sectionOfferingId }, data: { enrolledCount } });
  return enrolledCount;
}

/** Enrolls every current member of the section into the section offering (roster bootstrap). */
export async function enrollSectionMembers(
  db: Db,
  departmentId: string,
  sectionOfferingId: string,
  asOf = new Date(),
) {
  const so = await db.sectionOffering.findUniqueOrThrow({ where: { id: sectionOfferingId } });
  const members = await db.studentSectionMembership.findMany({
    where: {
      sectionId: so.sectionId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    select: { studentId: true },
  });
  let n = 0;
  for (const m of members) {
    const existing = await db.enrollment.findUnique({
      where: { sectionOfferingId_studentId: { sectionOfferingId, studentId: m.studentId } },
    });
    if (existing) continue;
    await db.enrollment.create({
      data: {
        departmentId,
        sectionOfferingId,
        studentId: m.studentId,
        status: "enrolled",
        source: "manual",
      },
    });
    n++;
  }
  await refreshEnrolledCount(db, sectionOfferingId);
  return n;
}
