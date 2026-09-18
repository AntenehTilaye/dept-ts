import { dispatchPending } from "@/platform/audit/outbox";
import type { WorkerHandler } from "./types";

// Drains the outbox. Policy `short` keeps one queued job; the handler re-sends itself after
// 5 s (self-chaining) and the minute cron re-seeds the chain after a restart.
const handler: WorkerHandler = {
  queue: "outbox.dispatch",
  pollingIntervalSeconds: 1,
  async handle(_jobs, { boss }) {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const s = await dispatchPending(200);
      total += s.picked;
      if (s.picked < 200) break;
    }
    if (total) console.log(`[outbox] dispatched ${total}`);
    await boss.send("outbox.dispatch", {}, { startAfter: 5 }).catch(() => undefined);
  },
};

export default handler;
