import { beforeAll, describe, expect, it, vi } from "vitest";
import linear from "../../fixtures/workflows/linear.json";
import compound from "../../fixtures/workflows/compound_review.json";
import { bootstrap } from "@/lib/bootstrap";
import type { Actor } from "@/platform/identity/can";
import {
  apply,
  availableActions,
  listInstances,
  migrateInstance,
  start,
} from "@/platform/workflow/engine";
import {
  ForbiddenTransitionError,
  GuardFailedError,
  WorkflowError,
} from "@/platform/workflow/errors";
import { runEffects, type EffectContext } from "@/platform/workflow/effects";
import { registerGuard } from "@/platform/workflow/guards";
import { upsertDefinition } from "@/platform/workflow/registry";
import { isRegistered, replace } from "@/platform/subject-registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();
if (!isRegistered("task")) {
  replace("task", {
    label: async (_db, id) => `task ${id}`,
    snapshot: async (_db, id) => ({ label: `task ${id}` }),
    contextOf: async () => ({ departmentId: DEPT_CS }),
    relationships: async () => [],
  });
}

const EXPIRE = {
  key: "review.expire",
  from: "review",
  to: "cancelled",
  action: "expire",
  system: true,
  effects: [
    { kind: "setField", args: { subjectType: "workflow_instance", field: "dueAt", value: "$now" } },
  ],
};

describe("engine edge cases", () => {
  let head: Actor;
  let key: string;

  beforeAll(async () => {
    const u = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
    head = { userId: u.id, personId: null, departmentId: DEPT_CS, isAdmin: false };
    key = `test.more.${uniqueSuffix()}`;
    registerGuard("test.silent", () => ({ ok: false }));
    const transitions = [
      ...linear.transitions.map((t) =>
        t.key === "in_progress.cancel" ? { ...t, guards: ["test.silent"] } : t,
      ),
      EXPIRE,
    ];
    await upsertDefinition({ ...linear, key, departmentId: DEPT_CS, transitions });
  });

  it("system transitions run for automation only, guards without reasons still block, explicit dueAt and filters work", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const due = new Date("2027-01-01T00:00:00Z");
    const inst = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: "task", subjectId },
        departmentId: DEPT_CS,
        actor: head,
        dueAt: due,
      }),
    );
    expect(inst.dueAt).toEqual(due);
    await apply(DEPT_CS, inst.id, "draft.start", head);
    const actions = await withDept(DEPT_CS, (tx) => availableActions(tx, inst.id, head));
    expect(actions.find((a) => a.transitionKey === "in_progress.cancel")).toMatchObject({
      enabled: false,
      disabledReason: "blocked by test.silent",
    });
    await expect(apply(DEPT_CS, inst.id, "in_progress.cancel", head)).rejects.toThrow(
      GuardFailedError,
    );
    await apply(DEPT_CS, inst.id, "in_progress.submit", head, { fields: { summary: "s" } });
    await expect(apply(DEPT_CS, inst.id, "review.expire", head)).rejects.toThrow(
      ForbiddenTransitionError,
    );
    await expect(apply(DEPT_CS, inst.id, "review.approve", null, { comment: "c" })).rejects.toThrow(
      /actor is required/,
    );
    const expired = await apply(DEPT_CS, inst.id, "review.expire", null, { system: true });
    expect(expired).toMatchObject({ terminal: true, terminalCategory: "cancelled" });
    const log = await withDept(DEPT_CS, (tx) =>
      tx.workflowTransitionLog.findFirst({
        where: { instanceId: inst.id, transitionKey: "review.expire" },
      }),
    );
    expect(log?.actorUserId).toBeNull();
    const list = await withDept(DEPT_CS, (tx) =>
      listInstances(tx, DEPT_CS, {
        subjectType: "task",
        states: ["cancelled"],
        overdueBefore: new Date("2030-01-01T00:00:00Z"),
      }),
    );
    expect(list.map((i) => i.id)).toContain(inst.id);
  });

  it("dynamic compound states start with the given person ids and migration validates key and state", async () => {
    const dynKey = `test.dyn.${uniqueSuffix()}`;
    const dyn = structuredClone(compound) as typeof compound;
    const c = dyn.states[1]!.compound!;
    (c as { dynamic?: boolean }).dynamic = true;
    c.completion = { rule: "all" } as never;
    c.branches = [
      {
        key: "$person",
        label: "Reviewer",
        initialState: "review.p.pending",
        states: ["review.p.pending", "review.p.done", "review.p.rejected"],
        doneState: "review.p.done",
        rejectedState: "review.p.rejected",
      },
    ];
    const transitions = [
      {
        ...dyn.transitions[1]!,
        key: "review.p.pending.approve",
        from: "review.p.pending",
        to: "review.p.done",
        branch: "$person",
      },
      dyn.transitions[6]!,
    ];
    await upsertDefinition({
      ...dyn,
      key: dynKey,
      initialState: "review",
      departmentId: DEPT_CS,
      transitions,
    });
    const subjectId = `t-${uniqueSuffix()}`;
    const inst = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: dynKey,
        subject: { subjectType: "task", subjectId },
        departmentId: DEPT_CS,
        actor: head,
        personIds: ["p1", "p2"],
      }),
    );
    expect(Object.keys(inst.branchStates as object)).toEqual(["p1", "p2"]);
    const acts = await withDept(DEPT_CS, (tx) => availableActions(tx, inst.id, head));
    expect(acts.map((a) => a.branchKey)).toEqual(["p1", "p2"]);
    await apply(DEPT_CS, inst.id, "review.p.pending.approve", head, { branchKey: "p1" });
    const other = await upsertDefinition({
      ...linear,
      key: `${dynKey}.other`,
      departmentId: DEPT_CS,
    });
    await expect(withDept(DEPT_CS, (tx) => migrateInstance(tx, inst.id, other.id))).rejects.toThrow(
      WorkflowError,
    );
    const v2 = await upsertDefinition({
      ...dyn,
      key: dynKey,
      initialState: "review",
      departmentId: DEPT_CS,
      transitions,
    });
    await expect(
      withDept(DEPT_CS, (tx) => migrateInstance(tx, inst.id, v2.id, { review: "ghost" })),
    ).rejects.toThrow(/does not exist/);
    const migrated = await withDept(DEPT_CS, (tx) => migrateInstance(tx, inst.id, v2.id));
    expect(migrated.definitionVersion).toBe(2);
    expect((migrated.branchStates as Record<string, { status: string }>).p1!.status).toBe("done");
  });

  it("effect placeholders resolve now, comment, toState and literal values", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const subjectId = `t-${uniqueSuffix()}`;
      const inst = await start(tx, {
        definitionKey: key,
        subject: { subjectType: "task", subjectId },
        departmentId: DEPT_CS,
        actor: head,
      });
      const ctx: EffectContext = {
        tx,
        definition: {} as never,
        instance: {
          id: inst.id,
          subjectType: "task",
          subjectId,
          departmentId: DEPT_CS,
          currentState: "draft",
        },
        step: { transitionKey: "x", fromState: "a", toState: "b", system: false, effects: [] },
        actor: head,
        input: { comment: "note", fields: {} },
      };
      await runEffects(
        [
          {
            kind: "setField",
            args: {
              subjectType: "workflow_instance",
              subjectId: inst.id,
              field: "dueAt",
              value: "$now",
            },
          },
        ],
        ctx,
      );
      expect(
        (await tx.workflowInstance.findUniqueOrThrow({ where: { id: inst.id } })).dueAt,
      ).toBeInstanceOf(Date);
      await runEffects([{ kind: "emit", args: { name: "x.y", payload: { n: 3 } } }], ctx);
      const ev = await tx.domainEvent.findFirst({ where: { name: "x.y", aggregateId: subjectId } });
      expect(ev?.payloadJson).toMatchObject({ n: 3, toState: "b", transition: "x" });
    });
  });
});
