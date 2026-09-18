import { withTenantBypass } from "@/lib/db/tenant";
import { retentionProviders } from "@/platform/scheduler/providers";
import type { WorkerHandler } from "./types";

/** Weekly: registered retention providers under tenant bypass (audited). */
const handler: WorkerHandler = {
  queue: "retention.run",
  async handle() {
    const now = new Date();
    for (const [key, fn] of retentionProviders()) {
      const n = await withTenantBypass(
        { worker: true, jobName: "retention.run" },
        `retention ${key}`,
        (tx) => fn(tx, now),
      ).catch((error) => {
        console.error(`[retention] ${key} failed`, error);
        return 0;
      });
      console.log(`[retention] ${key}: ${n}`);
    }
  },
};

export default handler;
