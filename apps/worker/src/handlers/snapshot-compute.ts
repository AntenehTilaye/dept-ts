import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { recomputeOffering, recomputeSection } from "@/modules/assessment/snapshots";
import type { WorkerHandler } from "./types";

interface Data {
  departmentId: string;
  /** The section whose marks changed; the offering it belongs to is recomputed after it. */
  sectionOfferingId?: string;
  /** Or the whole offering, section by section — what closing a term asks for. */
  courseOfferingId?: string;
}

/**
 * Recomputing what follows from committed marks: every student's result, the section's figures and
 * then the offering's. All of it is derived, so running it again on the same marks writes the same
 * rows — which is what makes a retry, a replay and a manual rebuild the same operation.
 */
const handler: WorkerHandler<Data> = {
  queue: "snapshot.compute",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { departmentId, sectionOfferingId, courseOfferingId } = job.data;
      if (!departmentId) continue;

      await runWithAudit(
        { departmentId, actorUserId: null, correlationId: "snapshot-compute" },
        async () => {
          await withTenantTx(departmentId, async (tx) => {
            const sections = sectionOfferingId
              ? [sectionOfferingId]
              : courseOfferingId
                ? (
                    await tx.sectionOffering.findMany({
                      where: { courseOfferingId },
                      select: { id: true },
                    })
                  ).map((row) => row.id)
                : [];

            let offeringId = courseOfferingId ?? null;
            for (const id of sections) {
              const result = await recomputeSection(tx, departmentId, id);
              if (!offeringId) {
                const section = await tx.sectionOffering.findUnique({
                  where: { id },
                  select: { courseOfferingId: true },
                });
                offeringId = section?.courseOfferingId ?? null;
              }
              console.log(
                `[snapshot.compute] ${id}: ${result.students} result(s)${
                  result.snapshotWritten ? "" : " (snapshot frozen, left as it was)"
                }`,
              );
            }

            if (offeringId) {
              const consolidated = await recomputeOffering(tx, departmentId, offeringId);
              console.log(
                `[snapshot.compute] ${offeringId}: consolidated ${consolidated.sections} section(s)`,
              );
            }
          });
        },
      );
    }
  },
};

export default handler;
