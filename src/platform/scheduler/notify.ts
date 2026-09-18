import type { Channel, NotificationCategory } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { resolveAudienceIds, dbAudienceLoader, type AudienceSpec } from "../people/audience";
import { renderVariants, resolveTemplate } from "../template/service";
import { variablesFor } from "../template/variables";
import { isRegistered, label } from "../subject-registry";
import { enqueue } from "./enqueue";

// notify(): the single entry point for user-facing messages. One Notification per recipient
// (idempotent on dedupeKey), one delivery per enabled channel (in_app only for persons with a
// login, email only for persons with an address and no opt-out), delivery jobs enqueued on the
// caller's transaction. A mass send above the threshold needs explicit confirmation.

export interface NotifyInput {
  recipients?: string[];
  audienceSpec?: AudienceSpec;
  templateKey?: string;
  /** Used when no template (or as fallback). */
  title?: string;
  body?: string;
  variables?: Record<string, unknown>;
  category: NotificationCategory;
  subject?: { subjectType: string; subjectId: string } | null;
  actionUrl?: string | null;
  ackRequired?: boolean;
  declinable?: boolean;
  /** Recipient-independent key; the person id is appended per recipient. */
  dedupeKey: string;
  channels?: Channel[];
  confirmMassSend?: boolean;
}

export interface NotifyResult {
  created: string[];
  existing: string[];
  recipients: number;
}

export class MassSendError extends Error {
  constructor(
    public readonly recipients: number,
    public readonly threshold: number,
  ) {
    super(
      `Sending to ${recipients} recipients exceeds the mass-send threshold of ${threshold}; confirm explicitly`,
    );
    this.name = "MassSendError";
  }
}

export async function massSendThreshold(db: Db): Promise<number> {
  const row = await db.systemSetting.findFirst({
    where: { key: "notify.massSendThreshold", scope: "global" },
  });
  return typeof row?.valueJson === "number" ? row.valueJson : 200;
}

/** Channels enabled for a user and category (in_app + email unless a preference disables one). */
export async function enabledChannels(
  db: Db,
  userId: string | null,
  category: NotificationCategory,
  requested: Channel[],
): Promise<Channel[]> {
  if (!userId) return requested.filter((c) => c === "email");
  const prefs = await db.channelPreference.findMany({
    where: { userId, OR: [{ category }, { category: null }] },
  });
  return requested.filter((c) => {
    const specific = prefs.find((p) => p.channel === c && p.category === category);
    const general = prefs.find((p) => p.channel === c && p.category === null);
    return (specific ?? general)?.enabled ?? true;
  });
}

export async function notify(
  tx: Db,
  departmentId: string,
  input: NotifyInput,
): Promise<NotifyResult> {
  const ids = new Set<string>(input.recipients ?? []);
  if (input.audienceSpec)
    for (const id of await resolveAudienceIds(
      input.audienceSpec,
      dbAudienceLoader(tx, departmentId),
    ))
      ids.add(id);
  const recipients = Array.from(ids);
  const threshold = await massSendThreshold(tx);
  if (recipients.length > threshold && !input.confirmMassSend)
    throw new MassSendError(recipients.length, threshold);

  const template = input.templateKey
    ? await resolveTemplate(tx, input.templateKey, departmentId)
    : null;
  // every template may use {{subject_label}} (registry label of the subject) and {{action_url}}
  const subjectLabel =
    input.subject && isRegistered(input.subject.subjectType)
      ? await label(tx, input.subject).catch(() => input.subject!.subjectId)
      : (input.subject?.subjectId ?? "");
  const baseVariables = {
    subject_label: subjectLabel,
    action_url: input.actionUrl ?? "",
    ...(input.variables ?? {}),
  };
  const persons = await tx.person.findMany({
    where: { id: { in: recipients } },
    select: { id: true, fullName: true, email: true, userId: true },
  });
  const result: NotifyResult = { created: [], existing: [], recipients: persons.length };

  for (const p of persons) {
    const dedupeKey = `${input.dedupeKey}:${p.id}`;
    const existing = await tx.notification.findUnique({ where: { dedupeKey } });
    if (existing) {
      result.existing.push(existing.id);
      continue;
    }
    const vars = await variablesFor(tx, {
      subject: input.subject,
      personId: p.id,
      departmentId,
      extra: baseVariables,
    });
    const rendered = template
      ? renderVariants(template, vars, ["inApp", "emailSubject", "emailBody", "sms"])
      : {};
    const title = rendered.emailSubject ?? input.title ?? input.templateKey ?? "Notification";
    const body = rendered.inApp ?? input.body ?? rendered.emailBody ?? "";
    const n = await tx.notification.create({
      data: {
        departmentId,
        recipientPersonId: p.id,
        category: input.category,
        title,
        body,
        actionUrl: input.actionUrl ?? null,
        subjectType: (input.subject?.subjectType ?? null) as never,
        subjectId: input.subject?.subjectId ?? null,
        templateKey: input.templateKey ?? null,
        ackRequired: input.ackRequired ?? false,
        declinable: input.declinable ?? false,
        dedupeKey,
        renderedJson: template
          ? toJson({
              emailSubject: rendered.emailSubject,
              emailBody: rendered.emailBody,
              sms: rendered.sms,
            })
          : undefined,
      },
    });
    result.created.push(n.id);
    const requested = input.channels ?? ["in_app", "email"];
    const channels = await enabledChannels(tx, p.userId, input.category, requested);
    for (const channel of channels) {
      if (channel === "email" && !p.email) continue;
      if (channel === "sms") continue; // no SMS provider in milestone 1
      const delivery = await tx.notificationDelivery.create({
        data: {
          departmentId,
          notificationId: n.id,
          channel,
          status: channel === "in_app" ? "sent" : "pending",
          sentAt: channel === "in_app" ? new Date() : null,
        },
      });
      if (channel === "email") {
        await enqueue(
          tx,
          "notification.deliver",
          { deliveryId: delivery.id, departmentId },
          {
            kind: "reminder",
            singletonKey: delivery.id,
            departmentId,
            subjectType: "notification",
            subjectId: n.id,
          },
        );
      }
    }
  }
  return result;
}

/** Convenience for callers outside a transaction. */
export async function notifyNow(departmentId: string, input: NotifyInput): Promise<NotifyResult> {
  const { withTenantTx } = await import("../../lib/db/tenant");
  return withTenantTx(departmentId, (tx) => notify(tx, departmentId, input));
}
