import { globalSingleton } from "../../lib/singleton";
import { subscribe } from "../audit/outbox";
import { applyEvent, listProjections } from "./projections/registry";

// Keeping the projections current. Every projection declares the events it cares about, and
// this subscribes to the union of them once — inside the dispatcher's receipt transaction, so a
// replayed event writes the same row rather than double-counting.

const state = globalSingleton("dashboard-subscribers", () => ({ installed: false }));

export function installDashboardSubscribers(): void {
  if (state.installed) return;
  state.installed = true;

  const events = new Set(listProjections().flatMap((p) => p.events));
  for (const name of events) {
    subscribe(name, `dashboard.${name}`, async (event, tx) => {
      if (!event.departmentId) return;
      await applyEvent(tx, {
        name,
        departmentId: event.departmentId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: (event.payloadJson ?? {}) as Record<string, unknown>,
      });
    });
  }
}
