import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { markDone, markFailed, markRunning } from "@/platform/scheduler/ledger";
import { openCampaign } from "@/platform/campaign";
import type { WorkerHandler } from "./types";

interface Data {
  campaignId: string;
  departmentId: string;
}

/** Window start: mints one token per pending invitation and mails the link. */
const handler: WorkerHandler<Data> = {
  queue: "campaign.open",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { campaignId, departmentId } = job.data;
      const key = `campaign:${campaignId}:open`;
      await withTenantTx(departmentId, (tx) => markRunning(tx, key));
      try {
        const sent = await runWithAudit(
          { departmentId, actorUserId: null, correlationId: key },
          () => withTenantTx(departmentId, (tx) => openCampaign(tx, campaignId)),
        );
        await withTenantTx(departmentId, (tx) => markDone(tx, key));
        console.log(`[campaign.open] ${campaignId}: ${sent} invitations sent`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await withTenantTx(departmentId, (tx) => markFailed(tx, key, message));
        throw error;
      }
    }
  },
};

export default handler;
