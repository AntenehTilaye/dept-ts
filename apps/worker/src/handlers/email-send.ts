import { sendMail } from "@/lib/mail/transport";
import { withTenantTx } from "@/lib/db/tenant";
import type { EmailMessage } from "@/platform/scheduler/channels/email";
import { wrapHtml } from "@/platform/scheduler/channels/html";
import type { WorkerHandler } from "./types";

export interface EmailSendData {
  deliveryId?: string;
  departmentId?: string;
  message: EmailMessage;
}

/** Sends one message over SMTP; failures throw so pg-boss retries with backoff, then dead-letters. */
const handler: WorkerHandler<EmailSendData> = {
  queue: "email.send",
  batchSize: 5,
  pollingIntervalSeconds: 1,
  async handle(jobs) {
    for (const job of jobs) {
      const { message, deliveryId, departmentId } = job.data;
      try {
        const html = message.html ?? wrapHtml(message.subject, message.text);
        const { messageId } = await sendMail({
          to: message.to,
          subject: message.subject,
          text: message.text,
          html,
        });
        if (deliveryId && departmentId) {
          await withTenantTx(departmentId, (tx) =>
            tx.notificationDelivery.updateMany({
              where: { id: deliveryId },
              data: { status: "sent", sentAt: new Date(), providerRef: messageId, lastError: null },
            }),
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (deliveryId && departmentId) {
          await withTenantTx(departmentId, (tx) =>
            tx.notificationDelivery.updateMany({
              where: { id: deliveryId },
              data: { attempts: { increment: 1 }, lastError: msg.slice(0, 500) },
            }),
          ).catch(() => undefined);
        }
        throw error;
      }
    }
  },
};

export default handler;
