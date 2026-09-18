import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { catchUpProviders } from "@/platform/scheduler/providers";
import type { WorkerHandler } from "./types";

/** Every 15 minutes: calendar-driven catch-ups (campaign windows, offerings, portfolios) per department. */
const handler: WorkerHandler = {
  queue: "calendar.autotransition",
  async handle() {
    const now = new Date();
    const departments = await prismaRoot.department.findMany({ select: { id: true } });
    for (const d of departments) {
      for (const [key, fn] of catchUpProviders()) {
        await withTenantTx(d.id, (tx) => fn({ tx, departmentId: d.id, now })).catch((error) =>
          console.error(`[catch-up] ${key} failed for ${d.id}`, error),
        );
      }
    }
  },
};

export default handler;
