import { beforeAll, describe, expect, it, vi } from "vitest";
import linear from "../../fixtures/workflows/linear.json";
import compound from "../../fixtures/workflows/compound_review.json";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import {
  apply,
  applyIn,
  availableActions,
  instanceOf,
  listInstances,
  migrateInstance,
  start,
} from "@/platform/workflow/engine";
import {
  ConflictError,
  ForbiddenTransitionError,
  GuardFailedError,
  RequiredInputError,
} from "@/platform/workflow/errors";
import { recorded } from "@/platform/workflow/effects";
import { registerGuard } from "@/platform/workflow/guards";
import { clearDefinitionCache, upsertDefinition, versionsOf } from "@/platform/workflow/registry";
import { isRegistered, replace } from "@/platform/subject-registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();
// the task subject arrives with the work-item phase; the engine only needs its context here
if (!isRegistered("task")) {
  replace("task", {
    label: async (_db, id) => `task ${id}`,
    snapshot: async (_db, id) => ({ label: `task ${id}` }),
    contextOf: async () => ({ departmentId: DEPT_CS }),
    relationships: async () => [],
  });
}

const SUBJECT = "task";

async function actorFor(email: string): Promise<Actor> {
  const u = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: u.id, personId: null, departmentId: DEPT_CS, isAdmin: u.role === "admin" };
}

describe("workflow engine", () => {
  let head: Actor;
  let instructor: Actor;
  let linearKey: string;
  let compoundKey: string;

  beforeAll(async () => {
    [head, instructor] = await Promise.all([
      actorFor("dh.cs@deptts.local"),
      actorFor("instructor1.cs@deptts.local"),
    ]);
    clearDefinitionCache();
    linearKey = `${linear.key}.${uniqueSuffix()}`;
    compoundKey = `${compound.key}.${uniqueSuffix()}`;
    await upsertDefinition({ ...linear, key: linearKey, departmentId: DEPT_CS });
    await upsertDefinition({ ...compound, key: compoundKey, departmentId: DEPT_CS });
    registerGuard("test.blocked", () => ({ ok: false, reason: "blocked by test" }));
  });

  it("start + apply write the instance, the log, the audit row and the outbox event together", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: linearKey,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    expect(instance.currentState).toBe("draft");
    const result = await apply(DEPT_CS, instance.id, "draft.start", head);
    expect(result.instance).toMatchObject({ currentState: "in_progress", rowVersion: 2 });
    expect(result.instance.dueAt).toBeInstanceOf(Date);
    const logs = await withDept(DEPT_CS, (tx) =>
      tx.workflowTransitionLog.findMany({ where: { instanceId: instance.id } }),
    );
    expect(logs.map((l) => [l.transitionKey, l.fromState, l.toState, l.actorUserId])).toEqual([
      ["draft.start", "draft", "in_progress", head.userId],
    ]);
    const audits = await withDept(DEPT_CS, (tx) =>
      tx.auditEvent.findMany({ where: { subjectType: "task", subjectId, action: "transition" } }),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.fieldChangesJson).toEqual({
      currentState: { before: "draft", after: "in_progress" },
    });
    const events = await withDept(DEPT_CS, (tx) =>
      tx.domainEvent.findMany({
        where: { aggregateId: subjectId },
        orderBy: { occurredAt: "asc" },
      }),
    );
    expect(events.map((e) => e.name)).toEqual([
      "workflow.started",
      "task.started",
      "workflow.transitioned",
    ]);
    expect(
      (
        await withDept(DEPT_CS, (tx) =>
          instanceOf(tx, { subjectType: SUBJECT, subjectId }, linearKey),
        )
      )?.id,
    ).toBe(instance.id);
    expect(
      (
        await withDept(DEPT_CS, (tx) =>
          listInstances(tx, DEPT_CS, { definitionKey: linearKey, states: ["in_progress"] }),
        )
      ).map((i) => i.id),
    ).toContain(instance.id);
  });

  it("a failing guard, a failing effect or missing input leaves zero rows", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: linearKey,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    const before = await migratorDb.workflowTransitionLog.count();
    await apply(DEPT_CS, instance.id, "draft.start", head);
    await expect(apply(DEPT_CS, instance.id, "in_progress.cancel", head)).rejects.toThrow(
      GuardFailedError,
    );
    await expect(apply(DEPT_CS, instance.id, "in_progress.submit", head)).rejects.toThrow(
      RequiredInputError,
    );
    // an effect that throws (setField on a non-allow-listed field) rolls the transition back
    const broken = await upsertDefinition({
      ...linear,
      key: `${linearKey}.broken`,
      departmentId: DEPT_CS,
      transitions: linear.transitions.map((t) =>
        t.key === "draft.start"
          ? { ...t, effects: [{ kind: "setField", args: { field: "nope", value: 1 } }] }
          : t,
      ),
    });
    const i2 = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: broken.key,
        subject: { subjectType: SUBJECT, subjectId: `${subjectId}-b` },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await expect(apply(DEPT_CS, i2.id, "draft.start", head)).rejects.toThrow(/allow-listed/);
    const after = await migratorDb.workflowInstance.findUniqueOrThrow({ where: { id: i2.id } });
    expect(after).toMatchObject({ currentState: "draft", rowVersion: 1 });
    expect(await migratorDb.workflowTransitionLog.count()).toBe(before + 1);
    expect(await migratorDb.workflowTransitionLog.count({ where: { instanceId: i2.id } })).toBe(0);
  });

  it("enforces permissions, stale versions and expected states", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: linearKey,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await expect(apply(DEPT_CS, instance.id, "draft.cancel", instructor)).rejects.toThrow(
      ForbiddenTransitionError,
    );
    const actions = await withDept(DEPT_CS, (tx) => availableActions(tx, instance.id, instructor));
    expect(actions.find((a) => a.transitionKey === "draft.cancel")).toMatchObject({
      enabled: false,
    });
    expect(actions.find((a) => a.transitionKey === "draft.start")).toMatchObject({
      enabled: false,
    });
    const headActions = await withDept(DEPT_CS, (tx) => availableActions(tx, instance.id, head));
    expect(headActions.map((a) => [a.transitionKey, a.enabled])).toEqual([
      ["draft.start", true],
      ["draft.cancel", true],
    ]);
    await expect(
      apply(DEPT_CS, instance.id, "draft.start", head, { expectedRowVersion: 99 }),
    ).rejects.toThrow(ConflictError);
    await expect(
      apply(DEPT_CS, instance.id, "draft.start", head, { expectedState: "review" }),
    ).rejects.toThrow(ConflictError);
    await apply(DEPT_CS, instance.id, "draft.start", head, {
      expectedRowVersion: 1,
      expectedState: "draft",
    });
    const inProgress = await withDept(DEPT_CS, (tx) => availableActions(tx, instance.id, head));
    expect(inProgress.find((a) => a.transitionKey === "in_progress.cancel")).toMatchObject({
      enabled: false,
      disabledReason: "blocked by definition",
    });
    expect(inProgress.find((a) => a.transitionKey === "in_progress.submit")).toMatchObject({
      enabled: true,
      requiredFields: ["summary"],
    });
    await apply(DEPT_CS, instance.id, "in_progress.submit", head, { fields: { summary: "x" } });
    recorded.length = 0;
    const done = await apply(DEPT_CS, instance.id, "review.approve", head, { comment: "fine" });
    expect(done).toMatchObject({ terminal: true, terminalCategory: "success" });
    // notify became a real effect in the scheduler phase (no recipients here: the head has no person)
    expect(recorded.map((r) => r.kind)).not.toContain("notify");
  });

  it("two concurrent branch completions serialise on the row lock and produce exactly one $join", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: compoundKey,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await apply(DEPT_CS, instance.id, "request.submit", head);
    const results = await Promise.allSettled([
      apply(DEPT_CS, instance.id, "review.chair.pending.approve", head, { branchKey: "chair" }),
      apply(DEPT_CS, instance.id, "review.head.pending.approve", head, { branchKey: "head" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /skipped|not available|not in a compound/,
    );
    const logs = await withDept(DEPT_CS, (tx) =>
      tx.workflowTransitionLog.findMany({
        where: { instanceId: instance.id, transitionKey: "review.$join" },
      }),
    );
    expect(logs).toHaveLength(1);
    const final = await migratorDb.workflowInstance.findUniqueOrThrow({
      where: { id: instance.id },
    });
    expect(final.currentState).toBe("approved");
    const events = await withDept(DEPT_CS, (tx) =>
      tx.domainEvent.findMany({ where: { aggregateId: subjectId, name: "review.completed" } }),
    );
    expect(events).toHaveLength(1);
  });

  it("an instance started on v1 stays on v1 after v2 is published, and can be migrated explicitly", async () => {
    const key = `${linearKey}.pin`;
    const v1 = await upsertDefinition({ ...linear, key, departmentId: DEPT_CS });
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    const v2 = await upsertDefinition({
      ...linear,
      key,
      departmentId: DEPT_CS,
      states: linear.states.map((s) =>
        s.key === "in_progress" ? { ...s, key: "working", label: "Working" } : s,
      ),
      transitions: linear.transitions.map((t) => ({
        ...t,
        from: t.from === "in_progress" ? "working" : t.from,
        to: t.to === "in_progress" ? "working" : t.to,
        key: t.key.replace("in_progress", "working"),
      })),
    });
    expect(v2.version).toBe(2);
    expect(
      (await migratorDb.workflowDefinition.findUniqueOrThrow({ where: { id: v1.id } })).status,
    ).toBe("retired");
    const moved = await apply(DEPT_CS, instance.id, "draft.start", head);
    expect(moved.instance).toMatchObject({ definitionVersion: 1, currentState: "in_progress" });
    const migrated = await withDept(DEPT_CS, (tx) =>
      migrateInstance(tx, instance.id, v2.id, { in_progress: "working" }, head),
    );
    expect(migrated).toMatchObject({ definitionVersion: 2, currentState: "working" });
    expect(
      (await withDept(DEPT_CS, (tx) => availableActions(tx, instance.id, head))).map(
        (a) => a.transitionKey,
      ),
    ).toEqual(["working.submit", "working.cancel"]);
    expect((await withDept(DEPT_CS, (tx) => versionsOf(tx, key))).map((v) => v.version)).toEqual([
      2, 1,
    ]);
  });

  it("setField writes only allow-listed derived caches", async () => {
    const key = `${linearKey}.setfield`;
    await upsertDefinition({
      ...linear,
      key,
      subjectType: "course_offering",
      departmentId: DEPT_CS,
      transitions: linear.transitions.map((t) =>
        t.key === "draft.start"
          ? {
              ...t,
              effects: [{ kind: "setField", args: { field: "decisionNote", value: "$comment" } }],
            }
          : t,
      ),
    });
    const { offering } = await withDept(DEPT_CS, async (tx) => {
      const f = await import("../../setup/factories");
      return f.offering(tx, DEPT_CS);
    });
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: "course_offering", subjectId: offering.id },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await apply(DEPT_CS, instance.id, "draft.start", head, { comment: "approved by head" });
    expect(
      (await migratorDb.courseOffering.findUniqueOrThrow({ where: { id: offering.id } }))
        .decisionNote,
    ).toBe("approved by head");
  });

  it("applyIn participates in the caller's transaction", async () => {
    const subjectId = `t-${uniqueSuffix()}`;
    const instance = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: linearKey,
        subject: { subjectType: SUBJECT, subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        await applyIn(tx, instance.id, "draft.start", head);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      (await migratorDb.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } }))
        .currentState,
    ).toBe("draft");
  });
});
