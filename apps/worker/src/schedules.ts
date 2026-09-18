import type { PgBoss } from "pg-boss";
import { QUEUES } from "@/platform/scheduler/queues";

/** Upserts every cron from the queue catalogue and removes schedules that are no longer listed. */
export async function registerSchedules(
  boss: PgBoss,
  tz: string = process.env.APP_TIMEZONE ?? "UTC",
): Promise<void> {
  const wanted = new Map(QUEUES.filter((q) => q.cron).map((q) => [q.name, q.cron!]));
  for (const [name, cron] of wanted) {
    await boss.schedule(name, cron, undefined, { tz });
  }
  const existing = await boss.getSchedules();
  for (const s of existing) {
    if (!wanted.has(s.name)) await boss.unschedule(s.name);
  }
}
