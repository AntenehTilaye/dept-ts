import { toJson } from "../../lib/db/json";
import { globalSingleton } from "../../lib/singleton";
import { withTenantBypass } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";
import { currentAudit } from "./context";

// Transactional outbox. `publish` writes the event on the caller's transaction; `dispatchPending`
// (worker `outbox.dispatch`, or tests directly) drains it: every subscriber of an event runs at
// most once (an EventHandlerReceipt is inserted first, inside a savepoint that a throwing
// handler rolls back), attempts/lastError track failures, deadAt lands after MAX_ATTEMPTS.

export interface DomainEventRow {
  id: string;
  departmentId: string | null;
  name: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: unknown;
  occurredAt: Date;
  correlationId: string | null;
  attempts: number;
}

export type EventHandler = (event: DomainEventRow, tx: Db) => Promise<void>;

interface Subscriber {
  eventName: string;
  handlerKey: string;
  handler: EventHandler;
}

const subscribers = globalSingleton("outbox-subscribers", () => [] as Subscriber[]);
export const MAX_ATTEMPTS = 10;

export function subscribe(eventName: string, handlerKey: string, handler: EventHandler): void {
  if (subscribers.some((s) => s.eventName === eventName && s.handlerKey === handlerKey))
    throw new Error(`Subscriber "${handlerKey}" for "${eventName}" is already registered`);
  subscribers.push({ eventName, handlerKey, handler });
}

/** Test helper. */
export function unsubscribe(eventName: string, handlerKey?: string): void {
  for (let i = subscribers.length - 1; i >= 0; i--) {
    const s = subscribers[i]!;
    if (s.eventName === eventName && (!handlerKey || s.handlerKey === handlerKey))
      subscribers.splice(i, 1);
  }
}

export function subscribersOf(eventName: string): Subscriber[] {
  return subscribers.filter((s) => s.eventName === eventName || s.eventName === "*");
}

export interface PublishOptions {
  departmentId?: string | null;
  correlationId?: string | null;
}

export async function publish(
  db: Db,
  name: string,
  aggregate: { subjectType: string; subjectId: string },
  payload: unknown = {},
  opts: PublishOptions = {},
) {
  const ctx = currentAudit();
  return db.domainEvent.create({
    data: {
      departmentId:
        opts.departmentId === undefined ? (ctx?.departmentId ?? null) : opts.departmentId,
      name,
      aggregateType: aggregate.subjectType as never,
      aggregateId: aggregate.subjectId,
      payloadJson: toJson(payload),
      correlationId:
        opts.correlationId === undefined ? (ctx?.correlationId ?? null) : opts.correlationId,
    },
  });
}

export interface DispatchSummary {
  picked: number;
  published: number;
  failed: number;
  dead: number;
}

/** Drains up to `limit` unpublished events (FOR UPDATE SKIP LOCKED) under tenant bypass. */
export async function dispatchPending(
  limit = 50,
  jobName = "outbox.dispatch",
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { picked: 0, published: 0, failed: 0, dead: 0 };
  const ids = await withTenantBypass(
    { worker: true, jobName },
    "outbox: pick pending events",
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM domain_event
       WHERE published_at IS NULL AND dead_at IS NULL
       ORDER BY occurred_at, id
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED`;
      return rows.map((r) => r.id);
    },
  );
  summary.picked = ids.length;
  for (const id of ids) {
    const outcome = await dispatchOne(id, jobName);
    summary[outcome]++;
  }
  return summary;
}

async function dispatchOne(id: string, jobName: string): Promise<"published" | "failed" | "dead"> {
  return withTenantBypass({ worker: true, jobName }, `outbox: dispatch ${id}`, async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM domain_event WHERE id = ${id} AND published_at IS NULL FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return "published";
    const event = await tx.domainEvent.findUniqueOrThrow({
      where: { id },
      include: { receipts: true },
    });
    const done = new Set(event.receipts.map((r) => r.handlerKey));
    let firstError: string | null = null;
    let index = 0;
    for (const s of subscribersOf(event.name)) {
      if (done.has(s.handlerKey)) continue;
      const sp = `sp_${index++}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
      try {
        await tx.eventHandlerReceipt.create({
          data: { eventId: event.id, handlerKey: s.handlerKey },
        });
        await s.handler(event, tx);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    }
    if (!firstError) {
      await tx.domainEvent.update({ where: { id }, data: { publishedAt: new Date() } });
      return "published";
    }
    const attempts = event.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await tx.domainEvent.update({
      where: { id },
      data: {
        attempts,
        lastError: firstError.slice(0, 2000),
        ...(dead ? { deadAt: new Date() } : {}),
      },
    });
    return dead ? "dead" : "failed";
  });
}

/** Unpublished, undead events (monitoring). */
export async function pendingCount(): Promise<number> {
  return withTenantBypass(
    { worker: true, jobName: "outbox.count" },
    "outbox: pending count",
    (tx) => tx.domainEvent.count({ where: { publishedAt: null, deadAt: null } }),
  );
}
