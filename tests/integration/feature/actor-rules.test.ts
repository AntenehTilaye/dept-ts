import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { act, availableActions, createRecord, publishVersionOn, reassign } from "@/platform/feature";
import { jsonHash, lockedHash } from "@/platform/feature/locks";
import { FeatureDefinitionSchema, type FeatureDefinitionInput } from "@/platform/feature/schema";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// Who may act, in practice. A definition names people by rule — this person, that group, the
// person a field holds, whoever the step is assigned to — and every one of those rules has to
// mean the same thing at the moment somebody presses the button.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
let head: Actor;
let instructor: Actor;
let outsider: Actor;
let groupId: string;
let featureKey: string;

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

function definition(key: string, personId: string, group: string): FeatureDefinitionInput {
  return {
    schemaVersion: 1,
    key,
    name: "Rules",
    labels: { singular: "Rule record", plural: "Rule records" },
    navigation: { group: "operations", order: 99, icon: "shield", visibleRoles: ["department_head"] },
    scope: { level: "department" },
    record: {
      numberPrefix: "RR",
      titleTemplate: "{{title}}",
      fields: [
        { key: "title", type: "short_text", label: "Title", constraints: { required: true } },
        { key: "handler", type: "person_picker", label: "Handler" },
      ],
      canCreate: [{ type: "role", roles: ["department_head"] }],
    },
    steps: [
      {
        kind: "step",
        key: "named_person",
        label: "A named person",
        assignee: { type: "person", personId },
        actions: [
          {
            key: "pass",
            label: "Pass on",
            kind: "complete",
            to: "$next",
            actors: [{ type: "person", personId }],
          },
        ],
      },
      {
        kind: "step",
        key: "a_group",
        label: "A group",
        assignee: { type: "group", groupId: group },
        actions: [
          {
            key: "pass",
            label: "Pass on",
            kind: "complete",
            to: "$next",
            actors: [{ type: "group", groupId: group }],
          },
        ],
      },
      {
        kind: "step",
        key: "from_the_record",
        label: "Whoever the record names",
        assignee: { type: "record_field", fieldKey: "handler" },
        // a deadline in the past, so the guard that watches it can be seen refusing
        deadline: { rule: "relative", offsetDays: -3, from: "step_entered" },
        actions: [
          {
            key: "finish",
            label: "Finish",
            kind: "complete",
            to: "done",
            actors: [{ type: "assignee" }],
          },
          {
            key: "finish_in_time",
            label: "Finish in time",
            kind: "complete",
            to: "done",
            actors: [{ type: "assignee" }],
            guards: ["feature.deadlineNotPassed"],
          },
        ],
      },
    ],
    terminalStates: [{ key: "done", label: "Done", category: "success" }],
    listViews: [{ key: "all", label: "All", columns: [{ field: "number", label: "Number" }] }],
    permissions: { defaults: { department_head: "manage", instructor: "assigned" } },
  };
}

async function publish(input: FeatureDefinitionInput) {
  const def = FeatureDefinitionSchema.parse(input);
  return withTenantBypass(bypass, `publish ${def.key}`, async (tx) => {
    const row = await tx.featureDefinition.create({
      data: {
        key: def.key,
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
        definitionId: row.id,
        version: 1,
        status: "draft",
        json: def as never,
        jsonHash: jsonHash(def),
        lockedHash: lockedHash(def, false),
        createdBy: head.userId,
      },
    });
    await publishVersionOn(tx, row.id, version.id, { userId: head.userId, isAdmin: true });
    return row;
  });
}

beforeAll(async () => {
  head = await actorFor("dh.cs@deptts.local");
  instructor = await actorFor("instructor1.cs@deptts.local");
  outsider = await actorFor("chair.cs@deptts.local");

  const { group } = await withDept(DEPT_CS, (tx) =>
    f.committee(tx, DEPT_CS, [{ personId: instructor.personId!, role: "member" }]),
  );
  groupId = group.id;

  featureKey = `rules_${Math.random().toString(36).slice(2, 8)}`;
  await publish(definition(featureKey, head.personId!, groupId));
});

async function newRecord() {
  return withTenantTx(DEPT_CS, (tx) =>
    createRecord(tx, DEPT_CS, head, featureKey, {
      data: { title: "Who may act", handler: instructor.personId },
    }),
  );
}

describe("the actor rules of a definition", () => {
  it("lets the named person act and refuses everybody else", async () => {
    const record = await newRecord();
    await expect(
      withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", outsider)),
    ).rejects.toThrow();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", head));
    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("a_group");
  });

  it("lets a member of the named group act, and assigns the step to the group", async () => {
    const record = await newRecord();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", head));

    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId: record.id, stepKey: "a_group", status: "active" },
    });
    expect(step).toMatchObject({ assigneeType: "group", assigneeId: groupId });

    await expect(
      withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "a_group", "pass", outsider)),
    ).rejects.toThrow();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "a_group", "pass", instructor));
    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("from_the_record");
  });

  it("assigns the step to the person a record field names", async () => {
    const record = await newRecord();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "a_group", "pass", instructor));

    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId: record.id, stepKey: "from_the_record", status: "active" },
    });
    expect(step).toMatchObject({ assigneeType: "person", assigneeId: instructor.personId });
  });

  it("refuses the action whose guard watches a deadline that has passed", async () => {
    const record = await newRecord();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "a_group", "pass", instructor));

    const actions = await withTenantTx(DEPT_CS, (tx) =>
      availableActions(tx, record.id, instructor),
    );
    expect(actions.find((a) => a.key === "finish")?.allowed).toBe(true);
    expect(actions.find((a) => a.key === "finish_in_time")).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("deadline"),
    });

    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        act(tx, record.id, "from_the_record", "finish_in_time", instructor),
      ),
    ).rejects.toThrow(/deadline/);
  });

  it("moves an active step to somebody else, who may then act", async () => {
    const record = await newRecord();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "named_person", "pass", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "a_group", "pass", instructor));

    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId: record.id, stepKey: "from_the_record", status: "active" },
    });
    await withTenantTx(DEPT_CS, (tx) =>
      reassign(tx, step.id, { type: "person", id: outsider.personId! }),
    );

    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "from_the_record", "finish", outsider));
    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("done");
    expect(row.closedAt).not.toBeNull();
  });
});
