import type { PrismaClient } from "../../../src/generated/prisma/client";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { runWithAudit } from "../../../src/platform/audit/context";
import { act, createRecord } from "../../../src/platform/feature";

// Offerings existed before they were a process. Making them one means every offering already in the
// database needs the record it should have had, in the state it should be in — planned if its term
// has not started, running if it is under way, and nothing at all if it already has a record.
// Running this twice does nothing the second time, which is what lets it live in the seed.

export interface BackfillResult {
  created: number;
  advanced: number;
  skipped: number;
}

export async function backfillOfferingRecords(db: PrismaClient): Promise<BackfillResult> {
  const out: BackfillResult = { created: 0, advanced: 0, skipped: 0 };
  const departments = await db.department.findMany({ select: { id: true, headPersonId: true } });

  for (const department of departments) {
    // `featureRecordId` is NOT NULL from this phase on, so the rows to backfill are the ones
    // whose record does not exist — which is what this raw query finds without the column being
    // nullable in the client's eyes
    const orphaned = await db.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM course_offering o
      LEFT JOIN feature_record f ON f.id = o.feature_record_id
      WHERE o.department_id = ${department.id} AND f.id IS NULL
    `;
    const offerings = await db.courseOffering.findMany({
      where: { id: { in: orphaned.map((row) => row.id) } },
      select: { id: true, courseId: true, termId: true, coordinatorPersonId: true },
    });
    if (!offerings.length) continue;

    // whoever the backfill acts as has to be somebody: the head of the department, or anybody who
    // can stand for it, because a record always records who created it
    const actorPerson =
      (department.headPersonId
        ? await db.person.findFirst({ where: { id: department.headPersonId } })
        : null) ??
      (await db.person.findFirst({
        where: { departments: { some: { departmentId: department.id, leftAt: null } }, userId: { not: null } },
        orderBy: { createdAt: "asc" },
      }));
    if (!actorPerson?.userId) {
      out.skipped += offerings.length;
      continue;
    }
    const actor = {
      userId: actorPerson.userId,
      personId: actorPerson.id,
      departmentId: department.id,
      isAdmin: false,
    };

    for (const offering of offerings) {
      const term = await db.term.findUnique({ where: { id: offering.termId } });
      if (!term) {
        out.skipped += 1;
        continue;
      }
      const now = new Date();
      const started = term.startDate <= now;
      const ended = term.endDate < now;

      await runWithAudit(
        {
          departmentId: department.id,
          actorUserId: actorPerson.userId,
          correlationId: `backfill-offering:${offering.id}`,
        },
        async () => {
          await withTenantTx(department.id, async (tx) => {
            // the offering row is already there, so this attaches a record to it and catches the
            // record up with where the term actually is
            const record = await createRecord(tx, department.id, actor, "course_offering", {
              parentRef: { subjectType: "course", subjectId: offering.courseId },
              data: {
                term: offering.termId,
                ...(offering.coordinatorPersonId ? { coordinator: offering.coordinatorPersonId } : {}),
                decision_note: "Recorded from the offering that already existed.",
              },
            });
            out.created += 1;
            if (started) {
              await act(tx, record.id, "planned", "confirm", actor);
              await act(tx, record.id, "confirmed", "start", actor);
              out.advanced += 1;
              if (ended) await act(tx, record.id, "running", "complete", actor);
            }
          });
        },
      );
    }
  }

  return out;
}
