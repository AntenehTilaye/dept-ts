import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { enqueue } from "@/platform/scheduler/enqueue";
import { runMigrationBatch } from "@/platform/feature/migrate";
import type { WorkerHandler } from "./types";

interface Data {
  migrationId: string;
  departmentId: string;
  batchSize?: number;
}

/**
 * Moves one batch of records onto a new feature version and re-queues itself while there is
 * more to do. Each batch re-selects records that still point at the old version, so a crash in
 * the middle costs at most the current batch and a re-run neither skips nor repeats a record.
 */
const handler: WorkerHandler<Data> = {
  queue: "feature.migrate",
  async handle(jobs: Job<Data>[], { boss }) {
    for (const job of jobs) {
      const { migrationId, departmentId, batchSize } = job.data;
      const result = await runWithAudit(
        { departmentId, actorUserId: null, correlationId: `feature-migrate:${migrationId}` },
        () => withTenantTx(departmentId, (tx) => runMigrationBatch(tx, migrationId, batchSize ?? 200)),
      );
      console.log(
        `[feature.migrate] ${migrationId}: ${result.migrated} migrated, ${result.blocked} blocked, ${result.remaining} left`,
      );

      if (result.done) continue;
      await withTenantTx(departmentId, (tx) =>
        enqueue(
          tx,
          "feature.migrate",
          { migrationId, departmentId, batchSize },
          {
            kind: "feature_migrate",
            singletonKey: `feature-migrate:${migrationId}`,
            departmentId,
          },
        ),
      );
      void boss;
    }
  },
};

export default handler;
