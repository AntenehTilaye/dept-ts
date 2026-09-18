import { withTenantTx } from "@/lib/db/tenant";
import { applyIn } from "@/platform/workflow/engine";
import { ConflictError } from "@/platform/workflow/errors";
import { markDone, markFailed, markRunning } from "@/platform/scheduler/ledger";
import type { WorkerHandler } from "./types";

export interface AutoTransitionData {
  instanceId: string;
  transitionKey: string;
  expectedState: string;
  departmentId: string;
  idempotencyKey?: string;
}

/** Applies a scheduled system transition; a moved instance (expectedState mismatch) is a no-op. */
const handler: WorkerHandler<AutoTransitionData> = {
  queue: "workflow.auto_transition",
  batchSize: 5,
  pollingIntervalSeconds: 1,
  async handle(jobs) {
    for (const job of jobs) {
      const d = job.data;
      await withTenantTx(d.departmentId, async (tx) => {
        if (d.idempotencyKey) {
          const row = await tx.scheduledJob.findUnique({
            where: { idempotencyKey: d.idempotencyKey },
          });
          if (!row || row.status === "cancelled" || row.status === "done") return;
          await markRunning(tx, d.idempotencyKey);
        }
        try {
          await applyIn(tx, d.instanceId, d.transitionKey, null, {
            system: true,
            expectedState: d.expectedState,
          });
          if (d.idempotencyKey) await markDone(tx, d.idempotencyKey);
        } catch (error) {
          if (error instanceof ConflictError) {
            if (d.idempotencyKey)
              await tx.scheduledJob.updateMany({
                where: { idempotencyKey: d.idempotencyKey },
                data: { status: "cancelled", lastError: "state moved" },
              });
            return;
          }
          if (d.idempotencyKey)
            await markFailed(
              tx,
              d.idempotencyKey,
              error instanceof Error ? error.message : String(error),
            );
          throw error;
        }
      });
    }
  },
};

export default handler;
