import { globalSingleton } from "../../lib/singleton";
import { subscribe } from "../audit/outbox";
import { rescheduleCampaign } from "./service";

// A moved calendar period re-resolves every campaign window anchored to it (the same event the
// reminder subscriptions listen to).

const state = globalSingleton("campaign-subscribers", () => ({ installed: false }));

export function installCampaignSubscribers(): void {
  if (state.installed) return;
  state.installed = true;
  subscribe("calendar.period.changed", "campaign.reschedule", async (e, tx) => {
    const p = e.payloadJson as { termId?: string; kind?: string } | null;
    if (!e.departmentId || !p?.termId || !p.kind) return;
    const campaigns = await tx.campaign.findMany({
      where: { departmentId: e.departmentId, termId: p.termId, closedAt: null },
      select: { id: true, windowAnchorJson: true },
    });
    for (const c of campaigns) {
      const anchor = JSON.stringify(c.windowAnchorJson ?? {});
      if (!anchor.includes(`"${p.kind}"`)) continue;
      await rescheduleCampaign(tx, c.id);
    }
  });
}
