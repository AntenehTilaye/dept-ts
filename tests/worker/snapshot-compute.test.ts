import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { setComponents } from "@/modules/assessment/service";
import snapshotCompute from "../../apps/worker/src/handlers/snapshot-compute";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";

// The figures are derived, so the job that computes them has to be safe to run again: the same
// marks must produce the same rows, and a snapshot the department has already reported on must be
// left exactly as it was.

vi.setConfig({ testTimeout: 180_000 });
bootstrap();

let sectionOfferingId: string;
let secondSectionId: string;
let courseOfferingId: string;
let batchId: string;
const studentIds: string[] = [];

const SCHEME = [
  { key: "quiz", name: "Quiz", maxMark: 10, weightPercent: 40 },
  { key: "final", name: "Final", maxMark: 60, weightPercent: 60, isFinal: true },
];

function job(data: Record<string, unknown>) {
  return [{ id: "job", name: "snapshot.compute", data } as never];
}

beforeAll(async () => {
  await withDept(DEPT_CS, async (tx) => {
    const sectionA = await f.section(tx, DEPT_CS);
    const sectionB = await f.section(tx, DEPT_CS);
    const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, {
      sectionIds: [sectionA.id, sectionB.id],
    });
    courseOfferingId = offering.id;
    sectionOfferingId = sectionOfferings[0]!.id;
    secondSectionId = sectionOfferings[1]!.id;

    await setComponents(tx, DEPT_CS, { courseOfferingId }, SCHEME);
    const components = await tx.assessmentComponent.findMany({
      where: { scheme: { courseOfferingId, sectionOfferingId: null } },
    });

    const batch = await tx.importBatch.create({
      data: {
        departmentId: DEPT_CS,
        kind: "assessment",
        contextType: "section_offering",
        contextId: sectionOfferingId,
        mode: "file",
        featureRecordId: `fixture-${sectionOfferingId}`,
        uploadedBy: "system",
        committedAt: new Date(),
      },
    });
    batchId = batch.id;

    // two students of the first section: one who did everything, one who missed the final
    for (const [name, quiz, final] of [
      ["Top Student", 10, 60],
      ["Absent Student", 8, null],
    ] as const) {
      const student = await f.student(tx, DEPT_CS, { fullName: name, sectionId: sectionA.id });
      studentIds.push(student.personId);
      for (const component of components) {
        const mark = component.key === "quiz" ? quiz : final;
        await tx.assessmentRecord.create({
          data: {
            departmentId: DEPT_CS,
            sectionOfferingId,
            studentId: student.personId,
            componentId: component.id,
            mark,
            isMissing: mark === null,
            importBatchId: batch.id,
          },
        });
      }
    }
  });
});

describe("the snapshot.compute job", () => {
  it("writes a result per student and a snapshot for the section", async () => {
    await snapshotCompute.handle(job({ departmentId: DEPT_CS, sectionOfferingId }), {
      boss: null as never,
    });

    const state = await withTenantTx(DEPT_CS, async (tx) => ({
      results: await tx.studentCourseResult.findMany({ where: { sectionOfferingId } }),
      snapshot: await tx.courseMetricsSnapshot.findFirst({
        where: { sectionOfferingId },
        orderBy: { computedAt: "desc" },
      }),
    }));

    expect(state.results).toHaveLength(2);
    const top = state.results.find((r) => r.studentId === studentIds[0])!;
    expect(Number(top.total)).toBe(100);
    expect(top.outcome).toBe("pass");
    // the one who did not sit the final has no grade, whatever the rest of their marks were
    const absent = state.results.find((r) => r.studentId === studentIds[1])!;
    expect(absent.letterGrade).toBe("I");
    expect(absent.outcome).toBe("incomplete");
    expect(Number(absent.total)).toBe(32);

    expect(state.snapshot!.studentCount).toBe(2);
    expect(Number(state.snapshot!.passRate)).toBe(1);
    expect(Number(state.snapshot!.completionRate)).toBe(0.5);
    const stats = state.snapshot!.componentStatsJson as unknown as { key: string; missing: number }[];
    expect(stats.find((s) => s.key === "final")!.missing).toBe(1);
  });

  it("writes the same thing again when it runs again", async () => {
    const before = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findFirstOrThrow({
        where: { sectionOfferingId },
        orderBy: { computedAt: "desc" },
      }),
    );
    await snapshotCompute.handle(job({ departmentId: DEPT_CS, sectionOfferingId }), {
      boss: null as never,
    });
    const after = await withTenantTx(DEPT_CS, async (tx) => ({
      snapshots: await tx.courseMetricsSnapshot.count({ where: { sectionOfferingId } }),
      latest: await tx.courseMetricsSnapshot.findFirstOrThrow({
        where: { sectionOfferingId },
        orderBy: { computedAt: "desc" },
      }),
      results: await tx.studentCourseResult.count({ where: { sectionOfferingId } }),
    }));

    // one snapshot per section, rewritten rather than accumulated, and the same figures
    expect(after.snapshots).toBe(1);
    expect(after.results).toBe(2);
    expect(after.latest.sourceHash).toBe(before.sourceHash);
    expect(Number(after.latest.averageMark)).toBe(Number(before.averageMark));
  });

  it("consolidates the offering from the sections that have figures", async () => {
    await snapshotCompute.handle(job({ departmentId: DEPT_CS, courseOfferingId }), {
      boss: null as never,
    });

    const offeringLevel = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findFirst({
        where: { courseOfferingId, sectionOfferingId: null },
        orderBy: { computedAt: "desc" },
      }),
    );
    expect(offeringLevel).not.toBeNull();
    // only the first section has marks, so the course looks like that section
    expect(offeringLevel!.studentCount).toBe(2);
    const empty = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findFirst({ where: { sectionOfferingId: secondSectionId } }),
    );
    expect(empty?.studentCount ?? 0).toBe(0);
    void batchId;
  });

  // last, because a frozen row can never be updated again — not even to unfreeze it, which is
  // the whole point of freezing it
  it("leaves a frozen snapshot exactly as it was", async () => {
    await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.updateMany({
        where: { sectionOfferingId },
        data: { frozen: true },
      }),
    );
    const frozen = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findFirstOrThrow({ where: { sectionOfferingId } }),
    );

    // the marks change underneath it ...
    await withTenantTx(DEPT_CS, (tx) =>
      tx.assessmentRecord.updateMany({
        where: { sectionOfferingId, studentId: studentIds[0] },
        data: { mark: 1 },
      }),
    );
    // ... and the job runs, and writes nothing over the number that was published
    await snapshotCompute.handle(job({ departmentId: DEPT_CS, sectionOfferingId }), {
      boss: null as never,
    });

    const after = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseMetricsSnapshot.findFirstOrThrow({ where: { id: frozen.id } }),
    );
    expect(Number(after.averageMark)).toBe(Number(frozen.averageMark));
    expect(after.computedAt.toISOString()).toBe(frozen.computedAt.toISOString());

    // the results themselves are current, because they are what a student is owed
    const results = await withTenantTx(DEPT_CS, (tx) =>
      tx.studentCourseResult.findMany({ where: { sectionOfferingId } }),
    );
    const recomputed = results.find((r) => r.studentId === studentIds[0])!;
    expect(Number(recomputed.total)).toBeLessThan(100);
  });

  it("does nothing at all when it is asked about nothing", async () => {
    await expect(
      snapshotCompute.handle(job({ departmentId: DEPT_CS }), { boss: null as never }),
    ).resolves.toBeUndefined();
    await expect(
      snapshotCompute.handle(job({}), { boss: null as never }),
    ).resolves.toBeUndefined();
    void migratorDb;
  });
});
