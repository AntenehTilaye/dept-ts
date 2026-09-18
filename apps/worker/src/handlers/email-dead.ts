import { withTenantTx } from "@/lib/db/tenant";
import { notify } from "@/platform/scheduler/notify";
import type { EmailSendData } from "./email-send";
import type { WorkerHandler } from "./types";

/** Dead-lettered mails: mark the delivery failed and alert the department head(s) in-app. */
const handler: WorkerHandler<EmailSendData> = {
  queue: "email.dead",
  async handle(jobs) {
    for (const job of jobs) {
      const { deliveryId, departmentId, message } = job.data;
      if (!departmentId) continue;
      await withTenantTx(departmentId, async (tx) => {
        if (deliveryId)
          await tx.notificationDelivery.updateMany({
            where: { id: deliveryId },
            data: { status: "failed" },
          });
        const heads = await tx.roleGrant.findMany({
          where: { departmentId, role: { key: "department_head" }, validTo: null },
          include: { user: { include: { person: { select: { id: true } } } } },
        });
        const recipients = heads.map((h) => h.user.person?.id).filter((id): id is string => !!id);
        if (!recipients.length) return;
        await notify(tx, departmentId, {
          recipients,
          category: "system_alert",
          title: "Email delivery failed",
          body: `The message "${message.subject}" to ${message.to} could not be delivered after several attempts.`,
          dedupeKey: `email.dead:${deliveryId ?? job.id}`,
          channels: ["in_app"],
        });
      });
    }
  },
};

export default handler;
