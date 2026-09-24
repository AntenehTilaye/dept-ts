import type { RowSource, WeekPattern } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";

export interface TimetableSlotInput {
  sectionOfferingId: string;
  teachingAssignmentId?: string | null;
  resourceId?: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  weekPattern?: WeekPattern;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSlot(slot: TimetableSlotInput): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7)
    problems.push("weekday must be 1 (Monday) to 7 (Sunday)");
  if (!TIME.test(slot.startTime)) problems.push(`start time ${slot.startTime} is not HH:MM`);
  if (!TIME.test(slot.endTime)) problems.push(`end time ${slot.endTime} is not HH:MM`);
  if (TIME.test(slot.startTime) && TIME.test(slot.endTime) && slot.startTime >= slot.endTime)
    problems.push("the slot must end after it starts");
  return problems;
}

/** Replaces the slots of a term for the given section offerings (import batch or manual edit). */
export async function upsertTimetableSlots(
  db: Db,
  departmentId: string,
  termId: string,
  slots: TimetableSlotInput[],
  opts: { source?: RowSource; importBatchId?: string | null; replace?: boolean } = {},
) {
  const problems = slots.flatMap((s, i) => validateSlot(s).map((p) => `slot ${i + 1}: ${p}`));
  if (problems.length) throw new Error(problems.join("; "));
  const sectionOfferingIds = Array.from(new Set(slots.map((s) => s.sectionOfferingId)));
  if (opts.replace ?? true) {
    await db.classTimetableSlot.deleteMany({
      where: { termId, sectionOfferingId: { in: sectionOfferingIds } },
    });
  }
  if (slots.length === 0) {
    await announce(db, departmentId, termId, sectionOfferingIds);
    return 0;
  }
  const created = await db.classTimetableSlot.createMany({
    data: slots.map((s) => ({
      departmentId,
      termId,
      sectionOfferingId: s.sectionOfferingId,
      teachingAssignmentId: s.teachingAssignmentId ?? null,
      resourceId: s.resourceId ?? null,
      weekday: s.weekday,
      startTime: s.startTime,
      endTime: s.endTime,
      weekPattern: s.weekPattern ?? "all",
      source: opts.source ?? "manual",
      importBatchId: opts.importBatchId ?? null,
    })),
  });
  await announce(db, departmentId, termId, sectionOfferingIds);
  return created.count;
}

/**
 * A timetable is busy time for whoever teaches it and for the room it is in, so every change
 * says so and the availability feed writes the blocks. Nothing here knows about the ledger.
 */
async function announce(
  db: Db,
  departmentId: string,
  termId: string,
  sectionOfferingIds: string[],
): Promise<void> {
  if (!sectionOfferingIds.length) return;
  await publish(
    db,
    "timetable.changed",
    { subjectType: "term", subjectId: termId },
    { termId, sectionOfferingIds },
    { departmentId },
  );
}

export async function slotsOfTerm(
  db: Db,
  termId: string,
  filter: { sectionOfferingId?: string; resourceId?: string; personId?: string } = {},
) {
  return db.classTimetableSlot.findMany({
    where: {
      termId,
      ...(filter.sectionOfferingId ? { sectionOfferingId: filter.sectionOfferingId } : {}),
      ...(filter.resourceId ? { resourceId: filter.resourceId } : {}),
      ...(filter.personId ? { teachingAssignment: { personId: filter.personId } } : {}),
    },
    include: {
      sectionOffering: {
        include: { courseOffering: { include: { course: { select: { code: true } } } } },
      },
      resource: { select: { code: true, name: true } },
      teachingAssignment: { include: { person: { select: { fullName: true } } } },
    },
    orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
  });
}
