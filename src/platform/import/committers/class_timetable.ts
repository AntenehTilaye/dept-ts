import { assignTeaching } from "../../academic/teaching";
import { upsertTimetableSlots, type TimetableSlotInput } from "../../academic/timetable";
import type { CommitContext, CommitSummary } from "./registry";

// Committing a timetable replaces the slots of every section offering the file mentions, and
// nothing else: a file that covers three sections does not wipe the fourth. `upsertTimetableSlots`
// announces the change, so the availability ledger writes the teaching blocks by itself.

export async function commitClassTimetable(
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const byTerm = new Map<string, TimetableSlotInput[]>();
  let assignments = 0;

  for (const row of rows) {
    const termId = String(row.term_id ?? "");
    const sectionOfferingId = String(row.section_offering_id ?? "");
    if (!termId || !sectionOfferingId) continue;

    // an instructor named in the file is the person teaching that section offering
    let teachingAssignmentId: string | null = null;
    const personId = (row.person_id as string | null) ?? null;
    if (personId) {
      const existing = await ctx.tx.teachingAssignment.findFirst({
        where: { sectionOfferingId, personId, validTo: null },
        select: { id: true },
      });
      if (existing) teachingAssignmentId = existing.id;
      else {
        const created = await assignTeaching(ctx.tx, ctx.departmentId, {
          sectionOfferingId,
          personId,
          role: "lecture",
          // AssignmentSource has no `import`: a timetable import is the load import of its term
          source: "load_import",
        });
        teachingAssignmentId = created.id;
        assignments += 1;
      }
    }

    const slots = byTerm.get(termId) ?? [];
    slots.push({
      sectionOfferingId,
      teachingAssignmentId,
      resourceId: (row.resource_id as string | null) ?? null,
      weekday: Number(row.weekday),
      startTime: String(row.start_time),
      endTime: String(row.end_time),
      weekPattern: (row.week_pattern as "all" | "odd" | "even") ?? "all",
    });
    byTerm.set(termId, slots);
  }

  let slotCount = 0;
  for (const [termId, slots] of byTerm) {
    slotCount += await upsertTimetableSlots(ctx.tx, ctx.departmentId, termId, slots, {
      source: "import",
      importBatchId: ctx.batchId,
    });
  }

  return {
    counts: { slots: slotCount, assignments },
    message: `${slotCount} timetable slot(s), ${assignments} new teaching assignment(s)`,
  };
}
