import { describe, expect, it, vi } from "vitest";

// The deliverable guard reads document.slotStatus; stub the module so the guard is tested on
// its own (the wiring is covered by tests/integration/workitem/task-lifecycle.test.ts).
const slotStatus = vi.hoisted(() => vi.fn());
vi.mock("@/platform/document/links", () => ({ slotStatus }));

const { installWorkItemHooks } = await import("@/platform/workitem/workflow-hooks");
const { evaluateGuard, hasGuard } = await import("@/platform/workflow/guards");

installWorkItemHooks();

function ctx(taskId: string) {
  return {
    tx: {
      task: {
        findUniqueOrThrow: async () => ({
          id: taskId,
          expectedDeliverablesJson: [
            { key: "report", label: "Final report", required: true },
            { key: "annex", label: "Annex", required: false },
          ],
        }),
      },
    },
    instance: {
      id: "wf1",
      subjectType: "task",
      subjectId: taskId,
      departmentId: "dep_cs",
      currentState: "in_progress",
    },
    actor: null,
    input: {},
  } as never;
}

describe("task.requiredDeliverablesLinked", () => {
  it("is registered by the work item hooks", () => {
    expect(hasGuard("task.requiredDeliverablesLinked")).toBe(true);
  });

  it("passes only when every required slot is satisfied, ignoring optional ones", async () => {
    slotStatus.mockResolvedValueOnce([
      { slotKey: "report", satisfied: false },
      { slotKey: "annex", satisfied: false },
    ]);
    expect(await evaluateGuard("task.requiredDeliverablesLinked", ctx("t1"))).toEqual({
      ok: false,
      reason: "Missing required deliverable(s): Final report",
    });

    slotStatus.mockResolvedValueOnce([
      { slotKey: "report", satisfied: true, documentId: "d1", versionNo: 1 },
      { slotKey: "annex", satisfied: false },
    ]);
    expect(await evaluateGuard("task.requiredDeliverablesLinked", ctx("t1"))).toBe(true);
  });
});
