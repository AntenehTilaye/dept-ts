import type { Job } from "pg-boss";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { rebuild } from "@/platform/search";
import type { WorkerHandler } from "./types";

interface Data {
  /** One department, or every department when it is left out. */
  departmentId?: string;
  types?: string[];
}

/** Rebuilds the search index. Slow and rare: after a deployment, or after a restore. */
const handler: WorkerHandler<Data> = {
  queue: "search.reindex",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const departments = job.data.departmentId
        ? [{ id: job.data.departmentId }]
        : await prismaRoot.department.findMany({ select: { id: true } });
      for (const department of departments) {
        const result = await runWithAudit(
          { departmentId: department.id, actorUserId: null, correlationId: "search-reindex" },
          () => withTenantTx(department.id, (tx) => rebuild(tx, department.id, job.data.types)),
        );
        console.log(
          `[search.reindex] ${department.id}: ${result.indexed} indexed, ${result.skipped} skipped`,
        );
      }
    }
  },
};

export default handler;
