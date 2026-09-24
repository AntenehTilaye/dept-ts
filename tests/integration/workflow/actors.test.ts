import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import type { Actor } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import {
  actorRoleKeys,
  matchesActorRule,
  matchesAnyActorRule,
  type ActorRuleContext,
} from "@/platform/workflow/actors";
import { evaluateGuard, hasGuard, registerGuard } from "@/platform/workflow/guards";
import {
  allowSetField,
  recorded,
  registerHandler,
  runEffects,
  type EffectContext,
} from "@/platform/workflow/effects";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("actor rules", () => {
  let head: Actor;
  let instructor: Actor;
  let instructorPersonId: string;
  let groupId: string;
  let resourceId: string;

  beforeAll(async () => {
    const dh = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
    const ins = await migratorDb.user.findUniqueOrThrow({
      where: { email: "instructor3.cs@deptts.local" },
    });
    await withDept(DEPT_CS, async (tx) => {
      const p = await f.staff(tx, DEPT_CS, {
        userId: ins.id,
        email: "instructor3.cs@deptts.local",
      });
      instructorPersonId = p.id;
      const { group } = await f.committee(tx, DEPT_CS, [{ personId: p.id, role: "chair" }]);
      groupId = group.id;
      const r = await tx.resource.create({
        data: {
          departmentId: DEPT_CS,
          code: `AR-${f.uniqueSuffix()}`,
          name: "Room",
          kind: "classroom",
          responsiblePersonId: p.id,
        },
      });
      resourceId = r.id;
    });
    head = { userId: dh.id, personId: null, departmentId: DEPT_CS, isAdmin: false };
    instructor = {
      userId: ins.id,
      personId: instructorPersonId,
      departmentId: DEPT_CS,
      isAdmin: false,
    };
  });

  const ctxFor = (
    tx: ActorRuleContext["tx"],
    actor: Actor,
    subject = { subjectType: "resource", subjectId: resourceId },
  ): ActorRuleContext => ({ tx, actor, subject, store: dbPolicyStore });

  it("evaluates every rule type against grants, memberships, permissions and registry relationships", async () => {
    await withDept(DEPT_CS, async (tx) => {
      expect((await actorRoleKeys(tx, head)).has("department_head")).toBe(true);
      expect(
        await matchesActorRule(
          { type: "role", roles: ["department_head"], scope: "department" },
          ctxFor(tx, head),
        ),
      ).toBe(true);
      expect(
        await matchesActorRule(
          { type: "role", roles: ["department_head"], scope: "department" },
          ctxFor(tx, instructor),
        ),
      ).toBe(false);
      expect(
        await matchesActorRule(
          { type: "role", roles: ["student"], scope: "department" },
          ctxFor(tx, { ...instructor, isAdmin: true }),
        ),
      ).toBe(true);
      expect(
        await matchesActorRule({ type: "permission", key: "task.manage" }, ctxFor(tx, head)),
      ).toBe(true);
      expect(
        await matchesActorRule({ type: "permission", key: "task.manage" }, ctxFor(tx, instructor)),
      ).toBe(false);
      expect(
        await matchesActorRule(
          { type: "person", personId: instructorPersonId },
          ctxFor(tx, instructor),
        ),
      ).toBe(true);
      expect(
        await matchesActorRule({ type: "person", personId: instructorPersonId }, ctxFor(tx, head)),
      ).toBe(false);
      expect(await matchesActorRule({ type: "group", groupId }, ctxFor(tx, instructor))).toBe(true);
      expect(await matchesActorRule({ type: "group", groupId }, ctxFor(tx, head))).toBe(false);
      expect(await matchesActorRule({ type: "system" }, ctxFor(tx, head))).toBe(false);
      expect(await matchesActorRule({ type: "owner" }, ctxFor(tx, instructor))).toBe(true);
      expect(await matchesActorRule({ type: "owner" }, ctxFor(tx, head))).toBe(false);
      expect(await matchesActorRule({ type: "assignee" }, ctxFor(tx, instructor))).toBe(false);
      const g = { subjectType: "group", subjectId: groupId };
      expect(
        await matchesActorRule(
          { type: "relationship", rel: "parent_chair" },
          ctxFor(tx, instructor, g),
        ),
      ).toBe(true);
      expect(
        await matchesActorRule(
          { type: "relationship", rel: "requester" },
          ctxFor(tx, instructor, g),
        ),
      ).toBe(false);
      expect(
        await matchesActorRule(
          { type: "record_field", fieldKey: "reviewer" },
          ctxFor(tx, instructor),
        ),
      ).toBe(false);
      expect(
        await matchesActorRule(
          { type: "record_field", fieldKey: "reviewer" },
          { ...ctxFor(tx, instructor), recordField: async () => [instructorPersonId] },
        ),
      ).toBe(true);
      expect(await matchesAnyActorRule([], ctxFor(tx, head))).toBe(true);
      expect(
        await matchesAnyActorRule([{ type: "system" }, { type: "owner" }], ctxFor(tx, instructor)),
      ).toBe(true);
      expect(await matchesAnyActorRule([{ type: "system" }], ctxFor(tx, instructor))).toBe(false);
    });
  });

  it("guards fail closed for unknown names and the built-ins behave", async () => {
    const base = {
      tx: {} as never,
      definition: {} as never,
      instance: {
        id: "i",
        subjectType: "task",
        subjectId: "t",
        currentState: "s",
        departmentId: DEPT_CS,
      },
      transition: {} as never,
      actor: null,
    };
    expect(hasGuard("always")).toBe(true);
    expect(await evaluateGuard("nope", { ...base, input: {} })).toMatchObject({ ok: false });
    expect(
      await evaluateGuard("comment.present", { ...base, input: { comment: " " } }),
    ).toMatchObject({ ok: false });
    expect(await evaluateGuard("comment.present", { ...base, input: { comment: "yes" } })).toBe(
      true,
    );
    registerGuard("test.async", async () => true as const);
    expect(await evaluateGuard("test.async", { ...base, input: {} })).toBe(true);
  });

  it("effects: named handlers, value placeholders, allow-list extension and unknown kinds", async () => {
    const calls: unknown[] = [];
    registerHandler("test.capture", async (ctx, args) => {
      calls.push({ args, comment: ctx.input.comment });
    });
    await withDept(DEPT_CS, async (tx) => {
      const r = await tx.resource.create({
        data: {
          departmentId: DEPT_CS,
          code: `EF-${f.uniqueSuffix()}`,
          name: "Room",
          kind: "classroom",
        },
      });
      allowSetField("resource", "location", { model: "resource", column: "location" });
      const ctx: EffectContext = {
        tx,
        definition: {} as never,
        instance: {
          id: "inst",
          subjectType: "resource",
          subjectId: r.id,
          departmentId: DEPT_CS,
          currentState: "x",
        },
        step: { transitionKey: "a.b", fromState: "a", toState: "b", system: false, effects: [] },
        // createTask spawns a record of the `task` feature, and a record is owned by a person
        actor: instructor,
        input: { comment: "hello", fields: { where: "B12" } },
      };
      await runEffects(
        [
          { kind: "invokeHandler", args: { handler: "test.capture", n: 1 } },
          { kind: "setField", args: { field: "location", value: "$fields.where" } },
          { kind: "emit", args: { name: "resource.moved", payload: { by: "$actorUserId" } } },
          { kind: "createTask", args: { title: "later" } },
        ],
        ctx,
      );
      expect(calls).toEqual([{ args: { handler: "test.capture", n: 1 }, comment: "hello" }]);
      expect((await tx.resource.findUniqueOrThrow({ where: { id: r.id } })).location).toBe("B12");
      expect(
        await tx.domainEvent.count({ where: { name: "resource.moved", aggregateId: r.id } }),
      ).toBe(1);
      // the work-item phase replaced the createTask recorder with the real effect
      expect(recorded.some((x) => x.kind === "createTask")).toBe(false);
      const spawned = await tx.task.findFirstOrThrow({ where: { title: "later" } });
      expect(spawned).toMatchObject({ contextType: "resource", contextId: r.id });
      // and the spawned task has the one task lifecycle, on its own record
      expect(spawned.featureRecordId).not.toBeNull();
      await expect(
        runEffects([{ kind: "invokeHandler", args: { handler: "missing" } }], ctx),
      ).rejects.toThrow(/unknown handler/);
      await expect(runEffects([{ kind: "emit", args: {} }], ctx)).rejects.toThrow(
        /name is required/,
      );
      await expect(
        runEffects(
          [{ kind: "setField", args: { subjectType: "person", field: "fullName", value: "x" } }],
          ctx,
        ),
      ).rejects.toThrow(/allow-listed/);
    });
  });
});
