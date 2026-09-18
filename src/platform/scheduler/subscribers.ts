import { globalSingleton } from "../../lib/singleton";
import { subscribe } from "../audit/outbox";
import { rescheduleAnchored } from "./reminders";

// Scheduler subscribers: a moved calendar period re-anchors every subscription that points at it.
const state = globalSingleton("scheduler-subscribers", () => ({ installed: false }));

export function installSchedulerSubscribers(): void {
  if (state.installed) return;
  state.installed = true;
  subscribe("calendar.period.changed", "reminders.reanchor", async (e, tx) => {
    const p = e.payloadJson as { termId?: string; kind?: string } | null;
    if (e.departmentId && p?.termId && p?.kind)
      await rescheduleAnchored(tx, e.departmentId, p.termId, p.kind);
  });
}
