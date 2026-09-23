import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { aggregateCampaign } from "@/platform/campaign";
import type { WorkerHandler } from "./types";

interface Data {
  campaignId: string;
  departmentId: string;
}

/** Recomputes the aggregated results (idempotent: the cells are replaced wholesale). */
const handler: WorkerHandler<Data> = {
  queue: "campaign.aggregate",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { campaignId, departmentId } = job.data;
      const cells = await runWithAudit(
        { departmentId, actorUserId: null, correlationId: `campaign:${campaignId}:aggregate` },
        () => withTenantTx(departmentId, (tx) => aggregateCampaign(tx, campaignId)),
      );
      console.log(`[campaign.aggregate] ${campaignId}: ${cells.length} cells`);
    }
  },
};

export default handler;
