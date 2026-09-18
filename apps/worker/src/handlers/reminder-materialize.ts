import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { materializeSubscription } from "@/platform/scheduler/reminders";
import type { WorkerHandler } from "./types";

/** Hourly: materialises the offsets that entered the 48 h horizon since the last run. */
const handler: WorkerHandler = {
  queue: "reminder.materialize",
  async handle() {
    const departments = await prismaRoot.department.findMany({ select: { id: true } });
    let created = 0;
    for (const d of departments) {
      created += await withTenantTx(d.id, async (tx) => {
        const subs = await tx.reminderSubscription.findMany({
          where: { departmentId: d.id, active: true },
          select: { id: true },
        });
        let n = 0;
        for (const s of subs) n += (await materializeSubscription(tx, s.id)).length;
        return n;
      });
    }
    if (created) console.log(`[reminders] materialised ${created}`);
  },
};

export default handler;
