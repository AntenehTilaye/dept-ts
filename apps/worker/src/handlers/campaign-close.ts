import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { markDone, markFailed, markRunning } from "@/platform/scheduler/ledger";
import { closeCampaign } from "@/platform/campaign";
import type { WorkerHandler } from "./types";

interface Data {
  campaignId: string;
  departmentId: string;
}

/** Window end: expires the open tokens, cancels the reminders and queues the aggregation. */
const handler: WorkerHandler<Data> = {
  queue: "campaign.close",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { campaignId, departmentId } = job.data;
      const key = `campaign:${campaignId}:close`;
      await withTenantTx(departmentId, (tx) => markRunning(tx, key));
      try {
        const { expired } = await runWithAudit(
          { departmentId, actorUserId: null, correlationId: key },
          () => withTenantTx(departmentId, (tx) => closeCampaign(tx, campaignId)),
        );
        await withTenantTx(departmentId, (tx) => markDone(tx, key));
        console.log(`[campaign.close] ${campaignId}: ${expired} tokens expired`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await withTenantTx(departmentId, (tx) => markFailed(tx, key, message));
        throw error;
      }
    }
  },
};

export default handler;
