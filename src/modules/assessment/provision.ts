import type { Db } from "@/lib/db/types";
import type { Actor } from "@/platform/identity/can";
import { act, createRecord } from "@/platform/feature";

// Bringing an offering into being. An offering is a `course_offering` record, so this is the record
// being created — the backing adapter is what writes the CourseOffering row — and everything that
// used to create an offering directly comes through here instead. Asking twice for the same course
// and term gives the offering that already exists rather than a second one.

export interface ProvisionInput {
  courseId: string;
  termId: string;
  coordinatorPersonId?: string | null;
  /** Take it straight to `confirmed`/`running` — what a backfill and a demo seed want. */
  advanceTo?: "planned" | "confirmed" | "running";
  note?: string;
}

export async function provisionOffering(
  tx: Db,
  departmentId: string,
  actor: Actor,
  input: ProvisionInput,
): Promise<{ id: string; featureRecordId: string; created: boolean }> {
  const existing = await tx.courseOffering.findUnique({
    where: { courseId_termId: { courseId: input.courseId, termId: input.termId } },
  });
  if (existing) {
    if (
      input.coordinatorPersonId !== undefined &&
      input.coordinatorPersonId !== existing.coordinatorPersonId
    )
      await tx.courseOffering.update({
        where: { id: existing.id },
        data: { coordinatorPersonId: input.coordinatorPersonId },
      });
    return { id: existing.id, featureRecordId: existing.featureRecordId, created: false };
  }

  const record = await createRecord(tx, departmentId, actor, "course_offering", {
    parentRef: { subjectType: "course", subjectId: input.courseId },
    data: {
      term: input.termId,
      ...(input.coordinatorPersonId ? { coordinator: input.coordinatorPersonId } : {}),
      ...(input.note ? { decision_note: input.note } : {}),
    },
  });

  const target = input.advanceTo ?? "planned";
  if (target === "confirmed" || target === "running")
    await act(tx, record.id, "planned", "confirm", actor);
  if (target === "running") await act(tx, record.id, "confirmed", "start", actor);

  const offering = await tx.courseOffering.findFirstOrThrow({
    where: { featureRecordId: record.id },
    select: { id: true },
  });
  return { id: offering.id, featureRecordId: record.id, created: true };
}
