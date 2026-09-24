import { globalSingleton } from "../../lib/singleton";
import { atLocalTime } from "../../lib/time";
import type { Db } from "../../lib/db/types";
import { subscribe } from "../audit/outbox";
import { registerAdapter } from "../feature/adapters/registry";
import { registerEffect } from "../workflow/effects";
import { registerBlocks, removeBySource, type SourceRef } from "./blocks";
import { checkConflicts } from "./conflicts";
import { suggestAssignees } from "./suggest";
import type { BlockInput } from "./schema";

// What fills the ledger. A module never writes blocks by hand: it publishes what it changed and
// the feed turns that into busy time. The class timetable is the first one — a class makes both
// the instructor and the room busy, every week of the term — and the workflow effects
// `registerBlocks` / `removeBlocks` are the generic door for everything a definition schedules.

const state = globalSingleton("availability-feeds", () => ({ installed: false }));

export function installAvailabilityFeeds(): void {
  if (state.installed) return;
  state.installed = true;

  // the timetable of a section offering is what makes its instructor and its room busy
  subscribe("timetable.changed", "availability.timetable", async (event, tx) => {
    if (!event.departmentId) return;
    const payload = (event.payloadJson ?? {}) as { termId?: string; sectionOfferingIds?: string[] };
    if (!payload.termId) return;
    for (const sectionOfferingId of payload.sectionOfferingIds ?? []) {
      await syncTimetableBlocks(tx, event.departmentId, payload.termId, sectionOfferingId);
    }
  });

  // a policy's days away are written by definePolicy itself; this keeps a policy that is
  // deleted from leaving its blackouts behind
  subscribe("availability.policy.deleted", "availability.policy", async (event, tx) => {
    await removeBySource(tx, {
      subjectType: "availability_policy",
      subjectId: event.aggregateId,
    });
  });

  registerEffect("registerBlocks", async (args, ctx) => {
    const blocks = Array.isArray(args.blocks) ? args.blocks : [];
    if (!blocks.length) return;
    await registerBlocks(
      ctx.tx,
      ctx.instance.departmentId,
      sourceOf(ctx.instance),
      blocks as BlockInput[],
    );
  });

  registerEffect("removeBlocks", async (_args, ctx) => {
    await removeBySource(ctx.tx, sourceOf(ctx.instance));
  });

  // what a schedule feature asks before it writes; locked in any definition that names them
  registerAdapter({
    key: "availability.checkConflicts",
    module: "availability",
    hook: "compute",
    description: "Lists the conflicts a candidate interval has for the given people or rooms.",
    simulable: false,
    run: async (ctx, input) => {
      const { owners, from, to, purpose } = input as {
        owners: { ownerType: "person" | "resource"; ownerId: string }[];
        from: string;
        to: string;
        purpose?: "appointments" | "invigilation" | "leave";
      };
      return checkConflicts(
        ctx.tx,
        ctx.departmentId,
        owners ?? [],
        { from: new Date(from), to: new Date(to) },
        purpose ? { purpose } : {},
      );
    },
  });

  registerAdapter({
    key: "availability.suggestAssignees",
    module: "availability",
    hook: "compute",
    description: "Ranks a pool of people for an interval: free first, then least loaded.",
    simulable: false,
    run: async (ctx, input) => {
      const { pool, from, to, exclude, limit, purpose } = input as {
        pool: string[];
        from: string;
        to: string;
        exclude?: string[];
        limit?: number;
        purpose?: "appointments" | "invigilation" | "leave";
      };
      return suggestAssignees(
        ctx.tx,
        ctx.departmentId,
        { from: new Date(from), to: new Date(to) },
        pool ?? [],
        { ...(exclude ? { exclude } : {}), ...(limit ? { limit } : {}), ...(purpose ? { purpose } : {}) },
      );
    },
  });
}

/** The blocks a section offering's timetable stands for, written under the offering's name. */
export async function syncTimetableBlocks(
  tx: Db,
  departmentId: string,
  termId: string,
  sectionOfferingId: string,
): Promise<number> {
  const term = await tx.term.findUnique({ where: { id: termId } });
  if (!term) return 0;
  const slots = await tx.classTimetableSlot.findMany({
    where: { termId, sectionOfferingId },
    include: { teachingAssignment: { select: { personId: true } } },
  });

  // a timetable is written in the department's own clock, so "08:00" on the term's first day is
  // the instant its people would call eight in the morning
  const department = await tx.department.findUnique({
    where: { id: departmentId },
    select: { timezone: true },
  });
  const timezone = department?.timezone ?? "Africa/Addis_Ababa";

  const blocks: BlockInput[] = [];
  for (const slot of slots) {
    const startAt = atLocalTime(term.startDate, slot.startTime, timezone);
    const endAt = atLocalTime(term.startDate, slot.endTime, timezone);
    const common = {
      startAt,
      endAt,
      weekday: slot.weekday,
      weekPattern: slot.weekPattern,
      recurringFrom: term.startDate,
      recurringUntil: term.endDate,
      kind: "teaching" as const,
      severity: "hard" as const,
      termId,
    };
    if (slot.teachingAssignment?.personId)
      blocks.push({ ...common, ownerType: "person", ownerId: slot.teachingAssignment.personId });
    if (slot.resourceId) blocks.push({ ...common, ownerType: "resource", ownerId: slot.resourceId });
  }

  const written = await registerBlocks(
    tx,
    departmentId,
    { subjectType: "section_offering", subjectId: sectionOfferingId },
    blocks,
  );
  return written.length;
}

function sourceOf(instance: { subjectType: string; subjectId: string }): SourceRef {
  return { subjectType: instance.subjectType, subjectId: instance.subjectId };
}
