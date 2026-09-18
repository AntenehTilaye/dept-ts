import { withTenantTx } from "@/lib/db/tenant";
import { queueEmail } from "@/platform/scheduler/channels/email";
import type { WorkerHandler } from "./types";

/** Turns a pending email delivery into an `email.send` job with the rendered message. */
const handler: WorkerHandler<{ deliveryId: string; departmentId: string }> = {
  queue: "notification.deliver",
  batchSize: 20,
  pollingIntervalSeconds: 1,
  async handle(jobs) {
    for (const job of jobs) {
      await withTenantTx(job.data.departmentId, async (tx) => {
        const d = await tx.notificationDelivery.findUnique({ where: { id: job.data.deliveryId } });
        if (!d || d.status !== "pending") return;
        await queueEmail(tx, d.id);
      });
    }
  },
};

export default handler;
