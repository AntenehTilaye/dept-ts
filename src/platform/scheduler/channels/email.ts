import type { Db } from "../../../lib/db/types";
import { renderVariants, resolveTemplate } from "../../template/service";
import { variablesFor } from "../../template/variables";
import { enqueue } from "../enqueue";
import { wrapHtml } from "./html";

// Email channel: renders the notification's template (or its stored title/body) into a message
// and hands it to `email.send`. Called by the notification.deliver worker handler.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function buildEmail(
  db: Db,
  deliveryId: string,
): Promise<{ message: EmailMessage; notificationId: string; departmentId: string } | null> {
  const d = await db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { include: { recipient: true } } },
  });
  if (!d || d.channel !== "email" || !d.notification.recipient.email) return null;
  const n = d.notification;
  const to = n.recipient.email!;
  // prefer the variants rendered at notify() time (they saw the full variable set)
  const rendered = (n.renderedJson ?? null) as { emailSubject?: string; emailBody?: string } | null;
  let subject = rendered?.emailSubject ?? n.title;
  let text = rendered?.emailBody ?? n.body;
  if (!rendered && n.templateKey) {
    const t = await resolveTemplate(db, n.templateKey, n.departmentId);
    if (t?.variants.emailBody) {
      const subjectRef =
        n.subjectType && n.subjectId
          ? { subjectType: n.subjectType, subjectId: n.subjectId }
          : null;
      const vars = await variablesFor(db, {
        subject: subjectRef,
        personId: n.recipientPersonId,
        departmentId: n.departmentId,
        extra: { title: n.title, body: n.body, action_url: n.actionUrl ?? "" },
      });
      const r = renderVariants(t, vars, ["emailSubject", "emailBody"]);
      subject = r.emailSubject ?? subject;
      text = r.emailBody ?? text;
    }
  }
  return {
    message: { to, subject, text, html: wrapHtml(subject, text, n.actionUrl) },
    notificationId: n.id,
    departmentId: n.departmentId,
  };
}

/** Queues the rendered message on `email.send` and marks the delivery queued. */
export async function queueEmail(tx: Db, deliveryId: string): Promise<boolean> {
  const built = await buildEmail(tx, deliveryId);
  if (!built) {
    await tx.notificationDelivery.updateMany({
      where: { id: deliveryId },
      data: { status: "failed", lastError: "no address or not an email delivery" },
    });
    return false;
  }
  await enqueue(
    tx,
    "email.send",
    { deliveryId, departmentId: built.departmentId, message: built.message },
    {
      kind: "reminder",
      singletonKey: `email:${deliveryId}`,
      departmentId: built.departmentId,
    },
  );
  await tx.notificationDelivery.update({
    where: { id: deliveryId },
    data: { status: "queued", attempts: { increment: 1 } },
  });
  return true;
}
