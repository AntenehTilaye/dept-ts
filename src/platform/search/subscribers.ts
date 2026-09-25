import { globalSingleton } from "../../lib/singleton";
import { subscribe } from "../audit/outbox";
import { index, isIndexed, remove } from "./indexer";

// Keeping the index current. Everything that changes publishes to the outbox already, so the
// index is one subscriber rather than a hook in every service — and because the dispatcher runs
// it in the receipt transaction, an event that is replayed writes the same row again.

const state = globalSingleton("search-subscribers", () => ({ installed: false }));

/** Events after which a subject should be read again, and what they are about. */
const REINDEX_EVENTS = [
  "person.updated",
  "task.created",
  "task.deadline_changed",
  "document.uploaded",
  "document.version_added",
  "feature.record.created",
  "workflow.transitioned",
  "campaign.opened",
  "campaign.closed",
] as const;

export function installSearchSubscribers(): void {
  if (state.installed) return;
  state.installed = true;

  for (const name of REINDEX_EVENTS) {
    subscribe(name, `search.index.${name}`, async (event, tx) => {
      if (!event.departmentId || !isIndexed(event.aggregateType)) return;
      await index(
        tx,
        { subjectType: event.aggregateType, subjectId: event.aggregateId },
        event.departmentId,
      );
    });
  }

  subscribe("document.deleted", "search.remove.document", async (event, tx) => {
    await remove(tx, { subjectType: event.aggregateType, subjectId: event.aggregateId });
  });
}
