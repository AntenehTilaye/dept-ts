import type { ProfileItemKind } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { attachToDepartment } from "./persons";

export interface StaffProfileInput {
  staffId: string;
  academicRank?: string | null;
  employmentType?: string | null;
  specialization?: string | null;
  academicInterests?: string[];
  officeLocation?: string | null;
  officeHoursText?: string | null;
  joinedAt?: Date | null;
}

/** Creates or updates the department's staff profile of a person (and links the person). */
export async function upsertStaffProfile(
  db: Db,
  departmentId: string,
  personId: string,
  input: StaffProfileInput,
) {
  await attachToDepartment(db, departmentId, personId);
  const data = {
    staffId: input.staffId.trim(),
    academicRank: input.academicRank ?? null,
    employmentType: input.employmentType ?? null,
    specialization: input.specialization ?? null,
    academicInterests: input.academicInterests ?? [],
    officeLocation: input.officeLocation ?? null,
    officeHoursText: input.officeHoursText ?? null,
    joinedAt: input.joinedAt ?? null,
  };
  return db.staffProfile.upsert({
    where: { personId },
    update: { ...data, rowVersion: { increment: 1 } },
    create: { personId, departmentId, ...data },
  });
}

export async function getStaffProfile(db: Db, personId: string) {
  return db.staffProfile.findUnique({ where: { personId }, include: { person: true } });
}

export async function listStaff(db: Db, departmentId: string) {
  return db.staffProfile.findMany({
    where: { departmentId },
    include: { person: true },
    orderBy: { person: { fullName: "asc" } },
  });
}

export interface ProfileItemInput {
  id?: string;
  kind: ProfileItemKind;
  title: string;
  institutionOrVenue?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  details?: Record<string, unknown>;
}

export async function upsertProfileItem(
  db: Db,
  departmentId: string,
  personId: string,
  input: ProfileItemInput,
) {
  const data = {
    kind: input.kind,
    title: input.title.trim(),
    institutionOrVenue: input.institutionOrVenue ?? null,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
    detailsJson: toJson(input.details ?? {}),
  };
  if (input.id) {
    return db.profileItem.update({ where: { id: input.id }, data });
  }
  return db.profileItem.create({ data: { departmentId, personId, ...data } });
}

export async function deleteProfileItem(db: Db, id: string) {
  await db.profileItem.delete({ where: { id } });
}

export async function profileItemsOf(db: Db, personId: string) {
  return db.profileItem.findMany({
    where: { personId },
    orderBy: [{ kind: "asc" }, { dateFrom: "desc" }],
  });
}
