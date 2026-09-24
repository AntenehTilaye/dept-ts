import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { act, availableActions, createRecord, publishVersionOn } from "@/platform/feature";
import { jsonHash, lockedHash } from "@/platform/feature/locks";
import { FeatureDefinitionSchema, type FeatureDefinitionInput } from "@/platform/feature/schema";
import { contextOf, label, relationships, variables } from "@/platform/subject-registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// The two backings that are not "just a record": a task-backed feature IS a Task row, and a
// dynamic parallel group opens one branch per person. Plus what the rest of the system sees when
// it asks the SubjectRegistry about a record.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
let head: Actor;
let instructor: Actor;

async function actorFor(email: string): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  const person = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: user.id, email }));
  return {
    userId: user.id,
    personId: person.id,
    departmentId: DEPT_CS,
    isAdmin: user.role === "admin",
  };
}

beforeAll(async () => {
  head = await actorFor("dh.cs@deptts.local");
  instructor = await actorFor("instructor1.cs@deptts.local");
});

describe("a task-backed feature", () => {
  it("creates the Task row the record IS, and re-assigns it instead of adding another", async () => {
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, head, "case", {
        data: {
          summary: "Projector keeps switching off",
          details: "Room 201, every afternoon.",
          category: "facility",
        },
      }),
    );
    expect(record.number).toMatch(/^F-C-\d{4}-\d{4}$/);

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.taskId).not.toBeNull();
    const task = await migratorDb.task.findUniqueOrThrow({ where: { id: row.taskId! } });
    expect(task.kind).toBe("case");
    expect(task.featureRecordId).toBe(record.id);

    // no step spawns a second task: the steps re-point the one the record already is
    const steps = await migratorDb.featureStepInstance.findMany({ where: { recordId: record.id } });
    expect(steps.every((s) => s.taskId === null)).toBe(true);
    expect(
      await migratorDb.task.count({ where: { featureStepInstanceId: { in: steps.map((s) => s.id) } } }),
    ).toBe(0);
  });

  it("runs the adapters the definition names when it enters and leaves a step", async () => {
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, head, "case", {
        data: { summary: "Broken chair", details: "Lab A", category: "facility" },
      }),
    );
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "raised", "take", head));

    // case.subscribeIntervalNudge runs on entering "in_progress"
    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId: record.id, stepKey: "in_progress" },
    });
    const subscription = await migratorDb.reminderSubscription.findFirst({
      where: { subjectType: "feature_step_instance", subjectId: step.id },
    });
    expect(subscription?.scheduleKey).toBe("case_interval_nudge");

    // resolving runs case.setResolvedAt and schedules the automatic close of the resolved step
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "in_progress", "resolve", head, { comment: "New chair delivered" }),
    );
    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("resolved");
    const caseRow = await migratorDb.case.findFirst({ where: { taskId: row.taskId! } });
    expect(caseRow?.resolvedAt ?? null).not.toBeNull();

    const resolvedStep = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId: record.id, stepKey: "resolved" },
    });
    const job = await migratorDb.scheduledJob.findFirst({
      where: { idempotencyKey: `feature_step_instance:${resolvedStep.id}:auto:auto_close` },
    });
    expect(job).not.toBeNull();
  });
});

describe("a dynamic parallel group", () => {
  it("opens one branch per resolved person and joins when they are all done", async () => {
    const definition = await seedDynamicFeature();
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, head, definition.key, { data: { topic: "Curriculum note" } }),
    );
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "draft", "circulate", head));

    const branches = await migratorDb.featureStepInstance.findMany({
      where: { recordId: record.id, stepKey: "read_it", status: "active" },
    });
    expect(branches.length).toBeGreaterThanOrEqual(1);
    // a dynamic branch is keyed by the person it belongs to
    expect(branches.every((b) => b.branchKey === b.assigneeId)).toBe(true);

    for (const branch of branches)
      await withTenantTx(DEPT_CS, (tx) =>
        act(tx, record.id, "read_it", "acknowledge", head, { branchKey: branch.branchKey! }),
      );

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("circulated");
    expect(row.closedAt).not.toBeNull();
  });
});

describe("what the rest of the system sees", () => {
  it("labels, contextualises and describes a record through the SubjectRegistry", async () => {
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, instructor, "generic_request", {
        data: { subject: "A second monitor", details: "for the lab bench", urgency: "routine" },
      }),
    );
    const ref = { subjectType: "feature_record", subjectId: record.id };

    const text = await withTenantTx(DEPT_CS, (tx) => label(tx, ref));
    expect(text).toContain(record.number);

    const context = await withTenantTx(DEPT_CS, (tx) => contextOf(tx, ref));
    expect(context).toMatchObject({ departmentId: DEPT_CS, ownerPersonId: instructor.personId });

    const rels = await withTenantTx(DEPT_CS, (tx) =>
      relationships(tx, ref, instructor.personId),
    );
    expect(rels).toContain("owner");
    expect(rels).toContain("assignee");

    const vars = await withTenantTx(DEPT_CS, (tx) => variables(tx, ref));
    expect(vars).toMatchObject({ record_number: record.number, feature_name: "Requests" });

    const actions = await withTenantTx(DEPT_CS, (tx) =>
      availableActions(tx, record.id, instructor),
    );
    expect(actions.map((a) => a.key)).toContain("submit");
  });
});

/** A small feature with a dynamic group, published just for this test. */
async function seedDynamicFeature() {
  const key = `circulation_${Math.random().toString(36).slice(2, 8)}`;
  const input: FeatureDefinitionInput = {
    schemaVersion: 1,
    key,
    name: "Circulations",
    labels: { singular: "Circulation", plural: "Circulations" },
    navigation: { group: "communication", order: 90, icon: "send", visibleRoles: ["department_head"] },
    scope: { level: "department" },
    record: {
      numberPrefix: "CI",
      titleTemplate: "{{topic}}",
      fields: [{ key: "topic", type: "short_text", label: "Topic", constraints: { required: true } }],
      canCreate: [{ type: "role", roles: ["department_head"] }],
    },
    steps: [
      {
        kind: "step",
        key: "draft",
        label: "Draft",
        assignee: { type: "creator" },
        actions: [
          {
            key: "circulate",
            label: "Circulate",
            kind: "submit",
            to: "$next",
            actors: [{ type: "creator" }],
          },
        ],
      },
      {
        kind: "parallel",
        key: "reading",
        label: "Reading",
        branches: {
          mode: "dynamic",
          perPerson: { type: "role", roles: ["instructor"] },
          branch: {
            key: "reader",
            label: "Reader",
            steps: [
              {
                kind: "step",
                key: "read_it",
                label: "Read it",
                assignee: { type: "creator" },
                actions: [
                  {
                    key: "acknowledge",
                    label: "Acknowledge",
                    kind: "complete",
                    to: "$next",
                    actors: [{ type: "assignee" }, { type: "role", roles: ["department_head"] }],
                  },
                ],
              },
            ],
          },
        },
        completion: { rule: "all" },
        onComplete: "circulated",
      },
    ],
    terminalStates: [{ key: "circulated", label: "Circulated", category: "success" }],
    listViews: [
      { key: "all", label: "All", columns: [{ field: "number", label: "Number" }] },
    ],
    permissions: { defaults: { department_head: "manage", instructor: "assigned" } },
  };
  const def = FeatureDefinitionSchema.parse(input);

  return withTenantBypass(bypass, "seed a dynamic feature", async (tx) => {
    const definition = await tx.featureDefinition.create({
      data: {
        key,
        departmentId: null,
        name: def.name,
        icon: def.navigation.icon,
        navGroup: def.navigation.group,
        navOrder: def.navigation.order,
        scopeLevel: "department",
        isSystem: false,
        createdBy: head.userId,
      },
    });
    const version = await tx.featureDefinitionVersion.create({
      data: {
        definitionId: definition.id,
        version: 1,
        status: "draft",
        json: def as never,
        jsonHash: jsonHash(def),
        lockedHash: lockedHash(def, false),
        createdBy: head.userId,
      },
    });
    await publishVersionOn(tx, definition.id, version.id, { userId: head.userId, isAdmin: true });
    return { key, definitionId: definition.id };
  });
}
