import type { Job } from "pg-boss";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { rebuildProjections } from "@/platform/dashboard";
import type { WorkerHandler } from "./types";

interface Data {
  /** One department, or every department when it is left out. */
  departmentId?: string;
  keys?: string[];
}

/** Rebuilds the dashboard projections from the tables they summarise. */
const handler: WorkerHandler<Data> = {
  queue: "projection.rebuild",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const departments = job.data.departmentId
        ? [{ id: job.data.departmentId }]
        : await prismaRoot.department.findMany({ select: { id: true } });
      for (const department of departments) {
        const summaries = await runWithAudit(
          { departmentId: department.id, actorUserId: null, correlationId: "projection-rebuild" },
          () =>
            withTenantTx(department.id, (tx) =>
              rebuildProjections(tx, department.id, job.data.keys),
            ),
        );
        console.log(
          `[projection.rebuild] ${department.id}: ${summaries
            .map((s) => `${s.projectionKey}=${s.rows}`)
            .join(", ")}`,
        );
      }
    }
  },
};

export default handler;
