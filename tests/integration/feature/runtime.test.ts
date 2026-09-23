import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { act, availableActions, createRecord } from "@/platform/feature";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// The runtime end to end on the seeded `generic_request`: a record is created, it moves through
// a parallel review with a quorum of one and a head's decision, and every derived column stays
// the copy of the workflow instance it is supposed to be.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let instructor: Actor;
let deputy: Actor;
let head: Actor;

async function actorFor(email: string, departmentId = DEPT_CS): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  const person = await withDept(departmentId, (tx) =>
    f.staff(tx, departmentId, { userId: user.id, email }),
  );
  return { userId: user.id, personId: person.id, departmentId, isAdmin: user.role === "admin" };
}

async function fileRequest(actor: Actor = instructor) {
  return withTenantTx(DEPT_CS, (tx) =>
    createRecord(tx, DEPT_CS, actor, "generic_request", {
      data: { subject: "New whiteboard", details: "The one in Lab A is broken", urgency: "soon" },
    }),
  );
}

beforeAll(async () => {
  instructor = await actorFor("instructor1.cs@deptts.local");
  deputy = await actorFor("dpt.cs@deptts.local");
  head = await actorFor("dh.cs@deptts.local");
});

describe("the generic runtime", () => {
  it("numbers the record, enters the first step and gives its assignee a task", async () => {
    const record = await fileRequest();
    expect(record.number).toMatch(/^F-GR-\d{4}-\d{4}$/);
    expect(record.currentStateKey).toBe("request");
    expect(record.title).toBe("New whiteboard");

    const steps = await migratorDb.featureStepInstance.findMany({ where: { recordId: record.id } });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      stepKey: "request",
      status: "active",
      assigneeType: "person",
      assigneeId: instructor.personId,
    });
    const task = await migratorDb.task.findFirst({
      where: { featureStepInstanceId: steps[0]!.id },
      include: { assignments: true },
    });
    expect(task?.kind).toBe("feature_step");
    expect(task?.assignments.map((a) => a.assigneeId)).toContain(instructor.personId);

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    const instance = await migratorDb.workflowInstance.findUniqueOrThrow({
      where: { id: row.workflowInstanceId },
    });
    expect(row.currentStateKey).toBe(instance.currentState);
  });

  it("numbers records consecutively within the department and year", async () => {
    const first = await fileRequest();
    const second = await fileRequest();
    const sequence = (number: string) => Number(number.split("-").at(-1));
    expect(sequence(second.number)).toBe(sequence(first.number) + 1);
  });

  it("refuses to submit while a required answer is missing", async () => {
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, instructor, "generic_request", {
        data: { subject: "Missing details", details: "x", urgency: "routine" },
      }),
    );
    await migratorDb.featureRecord.update({
      where: { id: record.id },
      data: { data: { subject: "Missing details", urgency: "routine" } },
    });
    await expect(
      withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor)),
    ).rejects.toThrow(/details/);
  });

  it("opens both review branches at once, each with its own assignee and task", async () => {
    const record = await fileRequest();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("review");
    const branches = await migratorDb.featureStepInstance.findMany({
      where: { recordId: record.id, status: "active" },
      orderBy: { stepKey: "asc" },
    });
    expect(branches.map((s) => [s.stepKey, s.branchKey])).toEqual([
      ["committee_review", "committee"],
      ["deputy_review", "deputy"],
    ]);
    for (const branch of branches) expect(branch.taskId).not.toBeNull();
    expect(row.deadlineAt).not.toBeNull();
  });

  it("joins on the first endorsement, skips the sibling branch and cancels its task", async () => {
    const record = await fileRequest();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "deputy_review", "endorse", deputy, { branchKey: "deputy" }),
    );

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("decision");

    const steps = await migratorDb.featureStepInstance.findMany({
      where: { recordId: record.id },
      orderBy: { enteredAt: "asc" },
    });
    const byKey = Object.fromEntries(steps.map((s) => [s.stepKey, s]));
    expect(byKey.deputy_review!.status).toBe("done");
    expect(byKey.committee_review!.status).toBe("skipped");
    expect(byKey.decision!.status).toBe("active");

    const skippedTask = await migratorDb.task.findUnique({
      where: { id: byKey.committee_review!.taskId! },
    });
    expect(skippedTask?.completedAt).not.toBeNull();
  });

  it("sends the whole record to the refusal terminal when one branch refuses", async () => {
    const record = await fileRequest();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "deputy_review", "refuse", deputy, {
        branchKey: "deputy",
        comment: "Not this year",
      }),
    );
    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("rejected");
    expect(row.closedAt).not.toBeNull();
    expect(row.deadlineAt).toBeNull();
  });

  it("closes the record when the head approves, and leaves no active step behind", async () => {
    const record = await fileRequest();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "deputy_review", "endorse", deputy, { branchKey: "deputy" }),
    );
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "decision", "approve", head));

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("approved");
    expect(row.closedAt).not.toBeNull();
    expect(
      await migratorDb.featureStepInstance.count({ where: { recordId: record.id, status: "active" } }),
    ).toBe(0);
  });

  it("offers an action only to the people the definition names, with the reason when it cannot run", async () => {
    const record = await fileRequest();
    const forOwner = await withTenantTx(DEPT_CS, (tx) =>
      availableActions(tx, record.id, instructor),
    );
    expect(forOwner.map((a) => a.key).sort()).toEqual(["submit", "withdraw"]);
    expect(forOwner.find((a) => a.key === "submit")!.allowed).toBe(true);
    // withdrawing needs a comment, which is why the button explains itself before it is pressed
    expect(forOwner.find((a) => a.key === "withdraw")).toMatchObject({
      allowed: false,
      requiresComment: true,
      reason: expect.stringContaining("comment"),
    });

    const forStranger = await withTenantTx(DEPT_CS, (tx) => availableActions(tx, record.id, head));
    expect(forStranger.find((a) => a.key === "submit")?.allowed).toBe(false);
  });

  it("keeps two departments apart", async () => {
    const record = await fileRequest();
    const visible = await withTenantTx(DEPT_EE, (tx) =>
      tx.featureRecord.findMany({ where: { id: record.id } }),
    );
    expect(visible).toEqual([]);
  });

  it("re-enters a step with the next sequence when a revision is asked for", async () => {
    const record = await fileRequest();
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "deputy_review", "endorse", deputy, { branchKey: "deputy" }),
    );
    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, record.id, "decision", "send_back", head, { comment: "Add a quote" }),
    );

    const row = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.currentStateKey).toBe("request");
    const entries = await migratorDb.featureStepInstance.findMany({
      where: { recordId: record.id, stepKey: "request" },
      orderBy: { sequence: "asc" },
    });
    expect(entries.map((e) => e.sequence)).toEqual([1, 2]);
    expect(entries[1]!.status).toBe("active");
  });
});
