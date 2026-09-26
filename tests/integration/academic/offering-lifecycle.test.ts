import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { act } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { provisionOffering } from "@/modules/assessment/provision";
import { backfillOfferingRecords } from "../../../prisma/seed/features/backfill-offering-records";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// An offering is a process whose dates the academic calendar already holds, so it should not need
// anybody to remember that teaching has started. These tests check that the record schedules its own
// transitions, that closing it freezes the figures it produced, and that an offering can no longer
// exist without the record it is the life of.

vi.setConfig({ testTimeout: 120_000 });
bootstrap();

let head: Actor;

beforeAll(async () => {
  const dh = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  const person = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" }),
  );
  head = { userId: dh.id, personId: person.id, departmentId: DEPT_CS, isAdmin: false };
});

describe("the life of an offering", () => {
  it("creates the offering row through the record, and one offering per course and term", async () => {
    const course = await withDept(DEPT_CS, (tx) => f.course(tx, DEPT_CS));
    const term = await withDept(DEPT_CS, (tx) => f.currentTermOf(tx, DEPT_CS));

    const first = await withTenantTx(DEPT_CS, (tx) =>
      provisionOffering(tx, DEPT_CS, head, { courseId: course.id, termId: term.id }),
    );
    expect(first.created).toBe(true);

    const again = await withTenantTx(DEPT_CS, (tx) =>
      provisionOffering(tx, DEPT_CS, head, { courseId: course.id, termId: term.id }),
    );
    expect(again.created).toBe(false);
    expect(again.id).toBe(first.id);

    const row = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseOffering.findUniqueOrThrow({ where: { id: first.id } }),
    );
    expect(row.featureRecordId).toBe(first.featureRecordId);
  });

  it("schedules the start of teaching from the calendar rather than waiting to be told", async () => {
    const course = await withDept(DEPT_CS, (tx) => f.course(tx, DEPT_CS));
    const term = await withDept(DEPT_CS, (tx) => f.currentTermOf(tx, DEPT_CS));
    const provisioned = await withTenantTx(DEPT_CS, (tx) =>
      provisionOffering(tx, DEPT_CS, head, {
        courseId: course.id,
        termId: term.id,
        advanceTo: "confirmed",
      }),
    );

    const step = await withTenantTx(DEPT_CS, (tx) =>
      tx.featureStepInstance.findFirstOrThrow({
        where: { recordId: provisioned.featureRecordId, stepKey: "confirmed", status: "active" },
      }),
    );
    // the deadline is the teaching period's start, taken from the calendar
    expect(step.deadlineAt).not.toBeNull();
    const teaching = await withTenantTx(DEPT_CS, (tx) =>
      tx.calendarPeriod.findFirst({ where: { termId: term.id, kind: "teaching" } }),
    );
    if (teaching)
      expect(step.deadlineAt!.toISOString().slice(0, 10)).toBe(
        teaching.startAt.toISOString().slice(0, 10),
      );

    // and the automatic transition that fires at it is scheduled, not hoped for: the ledger key
    // names the step instance, because that is what the schedule belongs to
    const scheduled = await migratorDb.scheduledJob.findMany({
      where: { queue: "workflow.auto_transition", idempotencyKey: { contains: step.id } },
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.idempotencyKey).toContain("auto_start");
    expect(scheduled[0]!.runAt.toISOString().slice(0, 10)).toBe(
      step.deadlineAt!.toISOString().slice(0, 10),
    );
  });

  it("freezes the figures when the offering is closed, and refuses to change them afterwards", async () => {
    const section = await withDept(DEPT_CS, (tx) => f.section(tx, DEPT_CS));
    const { offering, sectionOfferings } = await withDept(DEPT_CS, (tx) =>
      f.offering(tx, DEPT_CS, { sectionIds: [section.id] }),
    );
    const snapshot = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.create({
        data: {
          departmentId: DEPT_CS,
          courseOfferingId: offering.id,
          sectionOfferingId: sectionOfferings[0]!.id,
          termId: offering.termId,
          gradeDistributionJson: {},
          componentStatsJson: [],
          studentCount: 3,
          computedAt: new Date(),
          sourceHash: "abc",
        },
      }),
    );
    expect(snapshot.frozen).toBe(false);

    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, offering.featureRecordId, "running", "complete", head),
    );

    const frozen = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } }),
    );
    expect(frozen.frozen).toBe(true);

    // the database itself refuses to move a number the department has reported
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        tx.courseMetricsSnapshot.update({
          where: { id: snapshot.id },
          data: { studentCount: 4 },
        }),
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("stands a planned offering down, and will not do it without a reason", async () => {
    const course = await withDept(DEPT_CS, (tx) => f.course(tx, DEPT_CS));
    const term = await withDept(DEPT_CS, (tx) => f.currentTermOf(tx, DEPT_CS));
    const provisioned = await withTenantTx(DEPT_CS, (tx) =>
      provisionOffering(tx, DEPT_CS, head, {
        courseId: course.id,
        termId: term.id,
        advanceTo: "planned",
      }),
    );

    await expect(
      withTenantTx(DEPT_CS, (tx) => act(tx, provisioned.featureRecordId, "planned", "cancel", head)),
    ).rejects.toThrow(/comment/i);

    await withTenantTx(DEPT_CS, (tx) =>
      act(tx, provisioned.featureRecordId, "planned", "cancel", head, {
        comment: "Nobody is available to teach it this term",
      }),
    );
    const closed = await withTenantTx(DEPT_CS, (tx) =>
      tx.featureRecord.findUniqueOrThrow({ where: { id: provisioned.featureRecordId } }),
    );
    expect(closed.currentStateKey).toBe("cancelled");
    expect(closed.closedAt).not.toBeNull();
  });
});

describe("the backfill that made offerings records", () => {
  it("does nothing the second time it runs", async () => {
    const first = await backfillOfferingRecords(migratorDb);
    const second = await backfillOfferingRecords(migratorDb);
    expect(second.created).toBe(0);
    expect(second.advanced).toBe(0);
    void first;
  });

  it("will not let an offering exist without its record", async () => {
    const course = await withDept(DEPT_CS, (tx) => f.course(tx, DEPT_CS));
    const term = await withDept(DEPT_CS, (tx) => f.currentTermOf(tx, DEPT_CS));
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO course_offering (id, department_id, course_id, term_id, updated_at)
           VALUES ('co-no-record', $1, $2, $3, now())`,
          DEPT_CS,
          course.id,
          term.id,
        ),
      ),
    ).rejects.toThrow();
  });
});
