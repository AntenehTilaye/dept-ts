import { describe, expect, it, vi } from "vitest";
import linear from "../../fixtures/workflows/linear.json";
import { bootstrap } from "@/lib/bootstrap";
import type { Actor } from "@/platform/identity/can";
import { isRegistered, replace } from "@/platform/subject-registry";
import { apply, start } from "@/platform/workflow/engine";
import { upsertDefinition } from "@/platform/workflow/registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();
if (!isRegistered("task")) {
  replace("task", {
    label: async (_db, id) => `Task ${id}`,
    snapshot: async (_db, id) => ({ label: `Task ${id}` }),
    contextOf: async () => ({ departmentId: DEPT_CS }),
    relationships: async () => [],
  });
}

const NOTIFY_ASSIGN = {
  kind: "notify",
  args: {
    templateKey: "task_assignment",
    category: "assignment",
    recipientRule: "actor",
    ackRequired: true,
    dedupe: "eff:assign",
    variables: { due_date: "tomorrow" },
  },
};
const NOTIFY_HEAD = {
  kind: "notify",
  args: {
    recipientRule: "department_head",
    title: "Submitted",
    body: "Please review",
    category: "workflow",
    channels: ["in_app"],
  },
};

describe("scheduler-backed workflow effects", () => {
  it("notify, subscribeReminders, cancelReminders and cancelScheduled run inside the transition", async () => {
    const u = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
    const person = await withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: u.id, email: "dh.cs@deptts.local" }),
    );
    const head: Actor = {
      userId: u.id,
      personId: person.id,
      departmentId: DEPT_CS,
      isAdmin: false,
    };
    const key = `test.effects.${f.uniqueSuffix()}`;
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    const subscribe = {
      kind: "subscribeReminders",
      args: {
        scheduleKey: "default_7_3_1_0_overdue",
        deadline: { at: deadline },
        audienceSpec: { roles: ["department_head"] },
      },
    };
    const transitions = linear.transitions.map((t) => {
      if (t.key === "draft.start") return { ...t, effects: [NOTIFY_ASSIGN, subscribe] };
      if (t.key === "in_progress.submit")
        return {
          ...t,
          effects: [
            { kind: "cancelReminders", args: {} },
            { kind: "cancelScheduled", args: {} },
            NOTIFY_HEAD,
          ],
        };
      return t;
    });
    await upsertDefinition({ ...linear, key, departmentId: DEPT_CS, transitions });
    const subjectId = `e-${f.uniqueSuffix()}`;
    const inst = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: "task", subjectId },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await apply(DEPT_CS, inst.id, "draft.start", head);
    const n = await migratorDb.notification.findUnique({
      where: { dedupeKey: `eff:assign:${person.id}` },
    });
    expect(n).toMatchObject({
      category: "assignment",
      ackRequired: true,
      subjectId,
      templateKey: "task_assignment",
    });
    expect(n?.body).toContain(`Task ${subjectId}`);
    expect(n?.body).toContain("tomorrow");
    const sub = await migratorDb.reminderSubscription.findFirst({ where: { subjectId } });
    expect(sub?.active).toBe(true);
    expect(
      await migratorDb.scheduledJob.count({ where: { subjectId, status: "scheduled" } }),
    ).toBeGreaterThan(0);

    await apply(DEPT_CS, inst.id, "in_progress.submit", head, { fields: { summary: "done" } });
    expect(
      (await migratorDb.reminderSubscription.findUniqueOrThrow({ where: { id: sub!.id } })).active,
    ).toBe(false);
    expect(await migratorDb.scheduledJob.count({ where: { subjectId, status: "scheduled" } })).toBe(
      0,
    );
    const review = await migratorDb.notification.findFirst({
      where: { subjectId, title: "Submitted" },
    });
    expect(review?.recipientPersonId).toBe(person.id);
  });
});
