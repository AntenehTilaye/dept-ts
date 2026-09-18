import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { overdueProviders } from "@/platform/scheduler/providers";
import type { WorkerHandler } from "./types";

/** Hourly: every registered overdue provider runs per department. */
const handler: WorkerHandler = {
  queue: "overdue.sweep",
  async handle() {
    const now = new Date();
    const departments = await prismaRoot.department.findMany({ select: { id: true } });
    for (const d of departments) {
      for (const [key, fn] of overdueProviders()) {
        const n = await withTenantTx(d.id, (tx) => fn({ tx, departmentId: d.id, now })).catch(
          (error) => {
            console.error(`[overdue] ${key} failed for ${d.id}`, error);
            return 0;
          },
        );
        if (n) console.log(`[overdue] ${key}: ${n} in ${d.id}`);
      }
    }
  },
};

export default handler;
