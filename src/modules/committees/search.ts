import { globalSingleton } from "@/lib/singleton";
import { subscribe } from "@/platform/audit/outbox";
import { index, registerSearchSource } from "@/platform/search";

// Making committees findable. The index knows nothing about committees — it reads what a subject
// says about itself through `indexDoc` — so a module makes its type searchable by saying where
// its rows are and when they have changed. Both are registrations; neither is a new index.

const state = globalSingleton("module-committee-search", () => ({ installed: false }));

export function registerCommitteeSearch(): void {
  if (state.installed) return;
  state.installed = true;

  registerSearchSource("committee", async (db) =>
    (await db.committee.findMany({ select: { id: true } })).map((row) => row.id),
  );

  subscribe("committee.changed", "search.index.committee", async (event, tx) => {
    if (!event.departmentId) return;
    await index(
      tx,
      { subjectType: "committee", subjectId: event.aggregateId },
      event.departmentId,
    );
  });
}
