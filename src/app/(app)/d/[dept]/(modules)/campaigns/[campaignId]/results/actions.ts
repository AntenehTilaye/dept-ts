"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { aggregateCampaign, exportResults } from "@/platform/campaign";

// Recomputing and exporting are the only writes on the results page; the campaign lifecycle
// itself belongs to the generic feature runtime.

export const recomputeResultsAction = safeAction(
  z.object({ campaignId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    const cells = await aggregateCampaign(db, input.campaignId);
    revalidatePath(`/d/${ctx.deptSlug}/campaigns/${input.campaignId}/results`);
    return { cells: cells.length };
  },
  { permission: "campaign.manage" },
);

export const exportResultsAction = safeAction(
  z.object({ campaignId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await aggregateCampaign(db, input.campaignId);
    const { document } = await exportResults(db, ctx.departmentId, input.campaignId, ctx.user.id);
    revalidatePath(`/d/${ctx.deptSlug}/campaigns/${input.campaignId}/results`);
    return { documentId: document.id, title: document.title };
  },
  { permission: "campaign.manage" },
);
