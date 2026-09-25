import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { validateBatch } from "@/platform/import";
import type { WorkerHandler } from "./types";

interface Data {
  batchId: string;
  departmentId: string;
}

/** Checks a batch whose file was large enough that the checking is worth doing off-request. */
const handler: WorkerHandler<Data> = {
  queue: "import.validate",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { batchId, departmentId } = job.data;
      const summary = await runWithAudit(
        { departmentId, actorUserId: null, correlationId: `import-validate:${batchId}` },
        () => withTenantTx(departmentId, (tx) => validateBatch(tx, batchId)),
      );
      console.log(
        `[import.validate] ${batchId}: ${summary.errors} row(s) with errors, ${summary.warnings} with warnings`,
      );
    }
  },
};

export default handler;
