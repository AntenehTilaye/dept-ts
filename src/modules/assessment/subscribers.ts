import { globalSingleton } from "@/lib/singleton";
import { subscribe } from "@/platform/audit/outbox";
import { enqueue } from "@/platform/scheduler/enqueue";

// Marks are committed inside a transaction; the figures that follow are computed outside it, by the
// worker. The outbox is what joins the two: the commit publishes, the dispatcher enqueues in the
// same transaction it marks the event received, so a replay enqueues the same idempotent job rather
// than a second one.

const state = globalSingleton("module-assessment-subscribers", () => ({ installed: false }));

export function installAssessmentSubscribers(): void {
  if (state.installed) return;
  state.installed = true;

  for (const name of ["assessment.committed", "attendance.committed"]) {
    subscribe(name, `snapshot.compute.${name}`, async (event, tx) => {
      if (!event.departmentId) return;
      const payload = (event.payloadJson ?? {}) as { importBatchId?: string };
      await enqueue(
        tx,
        "snapshot.compute",
        { departmentId: event.departmentId, sectionOfferingId: event.aggregateId },
        {
          kind: "snapshot_compute",
          departmentId: event.departmentId,
          subjectType: "section_offering",
          subjectId: event.aggregateId,
          singletonKey: event.aggregateId,
          idempotencyKey: `snapshot:${event.aggregateId}:${payload.importBatchId ?? event.id}`,
        },
      );
    });
  }

  // a change to the scheme changes every result computed against it
  subscribe("assessment.scheme.changed", "snapshot.compute.scheme", async (event, tx) => {
    if (!event.departmentId) return;
    await enqueue(
      tx,
      "snapshot.compute",
      { departmentId: event.departmentId, courseOfferingId: event.aggregateId },
      {
        kind: "snapshot_compute",
        departmentId: event.departmentId,
        subjectType: "course_offering",
        subjectId: event.aggregateId,
        singletonKey: event.aggregateId,
        idempotencyKey: `snapshot:scheme:${event.id}`,
      },
    );
  });
}
