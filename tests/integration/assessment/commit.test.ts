import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { dispatchPending } from "@/platform/audit/outbox";
import { assignTeaching } from "@/platform/academic/teaching";
import { act } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { createBatch, fixRow, summaryFor } from "@/platform/import";
import { setComponents } from "@/modules/assessment/service";
import { recomputeSection } from "@/modules/assessment/snapshots";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";
import { ASSESSMENT_ERRORS, ASSESSMENT_VALID, workbookOf } from "../../fixtures/workbooks";

// A sheet of marks end to end: upload, read, see what is wrong with which line, fix it, commit. The
// pipeline is P10's; what this proves is that the assessment kind plugs into it, that a commit
// replaces the section's marks rather than adding to them, and that only somebody who teaches the
// section may write them.

vi.setConfig({ testTimeout: 180_000 });
bootstrap();

let root: string;
let head: Actor;
let instructor: Actor;
let stranger: Actor;
let sectionOfferingId: string;
let courseOfferingId: string;
const students: { personId: string; studentNumber: string; fullName: string }[] = [];

const SCHEME = [
  { key: "quiz", name: "Quiz", maxMark: 10, weightPercent: 10 },
  { key: "mid", name: "Mid-semester", maxMark: 30, weightPercent: 30 },
  { key: "final", name: "Final", maxMark: 60, weightPercent: 60, isFinal: true },
];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-assessment-"));
  setStorage(new LocalDiskStorage(root));

  const [dh, ins, other] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor2.cs@deptts.local" } }),
  ]);

  await withDept(DEPT_CS, async (tx) => {
    const p1 = await f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" });
    const p2 = await f.staff(tx, DEPT_CS, { userId: ins.id, email: "instructor1.cs@deptts.local" });
    const p3 = await f.staff(tx, DEPT_CS, { userId: other.id, email: "instructor2.cs@deptts.local" });
    head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
    instructor = { userId: ins.id, personId: p2.id, departmentId: DEPT_CS, isAdmin: false };
    stranger = { userId: other.id, personId: p3.id, departmentId: DEPT_CS, isAdmin: false };

    const section = await f.section(tx, DEPT_CS);
    const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, {
      sectionIds: [section.id],
    });
    courseOfferingId = offering.id;
    sectionOfferingId = sectionOfferings[0]!.id;

    // the three students of the fixture sheets, enrolled in this section
    for (const [number, name] of [
      ["CS/2001/24", "Rep Student"],
      ["CS/2003/24", "Student 03"],
      ["CS/2005/24", "Student 05"],
    ] as const) {
      const student = await f.student(tx, DEPT_CS, {
        studentNumber: number,
        fullName: name,
        sectionId: section.id,
      });
      students.push({ personId: student.personId, studentNumber: number, fullName: name });
      await tx.enrollment.create({
        data: {
          departmentId: DEPT_CS,
          sectionOfferingId,
          studentId: student.personId,
          status: "enrolled",
          source: "manual",
        },
      });
    }

    // whoever teaches the section is who may write its marks
    await assignTeaching(tx, DEPT_CS, {
      sectionOfferingId,
      personId: p2.id,
      role: "lecture",
    });

    await setComponents(tx, DEPT_CS, { courseOfferingId }, SCHEME);
  });
});

afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

/**
 * Uploads a sheet and takes it as far as the preview — through the process, because reading the
 * file and checking the rows are the `parse` and `validate` steps' own effects.
 */
async function upload(sheet: typeof ASSESSMENT_VALID, actor: Actor = instructor) {
  const bytes = await workbookOf([sheet]);
  // one transaction per step, as the pages do
  const created = await withTenantTx(DEPT_CS, (tx) =>
    createBatch(tx, DEPT_CS, actor, {
      kind: "assessment",
      context: { subjectType: "section_offering", subjectId: sectionOfferingId },
      file: { bytes, originalName: "marks.xlsx", mimeType: "application/vnd.ms-excel" },
    }),
  );
  await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "uploaded", "parse", actor));
  await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "parsed", "validate", actor));
  const summary = await withTenantTx(DEPT_CS, (tx) => summaryFor(tx, created.batchId));
  return { ...created, summary };
}

/** Commits through the process, which is the only way a batch is ever committed. */
async function commit(recordId: string, actor: Actor = instructor) {
  return withTenantTx(DEPT_CS, (tx) => act(tx, recordId, "validated", "commit", actor));
}

describe("committing a sheet of marks", () => {
  it("reads the file, maps the component columns and writes a mark per student per component", async () => {
    const { recordId, batchId, summary } = await upload(ASSESSMENT_VALID);
    expect(summary.errors).toBe(0);
    // the component columns are the section's own, discovered from the scheme
    expect(Object.keys(summary.mappings ?? {})).toEqual(
      expect.arrayContaining(["student_number", "component:quiz", "component:mid", "component:final"]),
    );

    await commit(recordId);
    void batchId;

    const rows = await withTenantTx(DEPT_CS, (tx) =>
      tx.assessmentRecord.findMany({
        where: { sectionOfferingId },
        include: { component: { select: { key: true } } },
      }),
    );
    expect(rows).toHaveLength(9);
    const dawit = students.find((s) => s.studentNumber === "CS/2005/24")!;
    const missing = rows.find((r) => r.studentId === dawit.personId && r.component.key === "final")!;
    // an empty cell is recorded as not sat, not as a zero
    expect(missing.mark).toBeNull();
    expect(missing.isMissing).toBe(true);
  });

  it("locks the structure of the scheme once marks exist against it", async () => {
    const offering = await withTenantTx(DEPT_CS, (tx) =>
      tx.courseOffering.findUniqueOrThrow({ where: { id: courseOfferingId } }),
    );
    expect(offering.schemeStructureLockedAt).not.toBeNull();
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        setComponents(tx, DEPT_CS, { courseOfferingId }, SCHEME.slice(0, 2)),
      ),
    ).rejects.toThrow(/locked/i);
  });

  it("asks the worker to recompute exactly once per commit", async () => {
    const before = await migratorDb.scheduledJob.count({
      where: { queue: "snapshot.compute", subjectId: sectionOfferingId },
    });
    await dispatchPending(200);
    const after = await migratorDb.scheduledJob.findMany({
      where: { queue: "snapshot.compute", subjectId: sectionOfferingId },
    });
    expect(after.length).toBeGreaterThan(before);
    // the dispatcher marks the event received in its own transaction, so asking again adds nothing
    await dispatchPending(200);
    const again = await migratorDb.scheduledJob.count({
      where: { queue: "snapshot.compute", subjectId: sectionOfferingId },
    });
    expect(again).toBe(after.length);
  });

  it("replaces the section's marks on a second sheet and marks the first as superseded", async () => {
    const corrected = {
      ...ASSESSMENT_VALID,
      rows: [
        ["CS/2001/24", "Rep Student", 10, 30, 60],
        ["CS/2003/24", "Student 03", 5, 15, 30],
      ] as (string | number | null)[][],
    };
    const { recordId, batchId } = await upload(corrected);
    await commit(recordId);

    const state = await withTenantTx(DEPT_CS, async (tx) => ({
      rows: await tx.assessmentRecord.findMany({ where: { sectionOfferingId } }),
      batch: await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } }),
    }));
    // two students, three components: the third student's marks are gone because the sheet is the
    // whole truth about the section
    expect(state.rows).toHaveLength(6);
    expect(state.rows.every((r) => r.importBatchId === batchId)).toBe(true);
    expect(state.batch.replacesBatchId).not.toBeNull();
  });

  it("recomputes the results and the section's figures from the marks that are there", async () => {
    const result = await withTenantTx(DEPT_CS, (tx) =>
      recomputeSection(tx, DEPT_CS, sectionOfferingId),
    );
    expect(result.students).toBe(2);

    const state = await withTenantTx(DEPT_CS, async (tx) => ({
      results: await tx.studentCourseResult.findMany({ where: { sectionOfferingId } }),
      snapshot: await tx.courseMetricsSnapshot.findFirst({
        where: { sectionOfferingId },
        orderBy: { computedAt: "desc" },
      }),
    }));
    const abebe = students.find((s) => s.studentNumber === "CS/2001/24")!;
    const top = state.results.find((r) => r.studentId === abebe.personId)!;
    expect(Number(top.total)).toBe(100);
    expect(top.letterGrade).toBe("A+");
    expect(top.outcome).toBe("pass");

    expect(state.snapshot).not.toBeNull();
    expect(state.snapshot!.studentCount).toBe(2);
    expect(Number(state.snapshot!.averageMark)).toBe(75);
    expect(Number(state.snapshot!.passRate)).toBe(1);
  });

  it("shows every problem of a bad sheet against the line that has it, and lets somebody fix it", async () => {
    const { recordId, batchId, summary } = await upload(ASSESSMENT_ERRORS);
    expect(summary.errors).toBeGreaterThan(0);

    const rows = await withTenantTx(DEPT_CS, (tx) =>
      tx.importRow.findMany({ where: { batchId }, orderBy: { rowNo: "asc" } }),
    );
    const codesOf = (row: (typeof rows)[number]) =>
      ((row.errorsJson ?? []) as { code: string }[]).map((e) => e.code);
    expect(codesOf(rows[0]!)).toContain("DUPLICATE_STUDENT");
    expect(codesOf(rows[2]!)).toContain("NON_NUMERIC");
    expect(codesOf(rows[3]!)).toContain("OUT_OF_RANGE");
    expect(codesOf(rows[4]!)).toContain("UNKNOWN_STUDENT");

    // a committer never sees a row in error, so the commit is refused until they are fixed
    await expect(commit(recordId)).rejects.toThrow();

    // fixing the two fixable rows and dropping the two that cannot be fixed
    await withTenantTx(DEPT_CS, async (tx) => {
      await fixRow(tx, batchId, 3, { Quiz: 6 });
      await fixRow(tx, batchId, 4, { Mid: 24 });
    });
    const after = await withTenantTx(DEPT_CS, (tx) =>
      tx.importRow.findMany({ where: { batchId }, orderBy: { rowNo: "asc" } }),
    );
    expect(codesOf(after[2]!)).not.toContain("NON_NUMERIC");
    expect(codesOf(after[3]!)).not.toContain("OUT_OF_RANGE");
  });
});

describe("who may write a section's marks", () => {
  it("refuses somebody who teaches nothing in the section", async () => {
    const { batchId } = await upload(ASSESSMENT_VALID, head);
    const verdict = await withTenantTx(DEPT_CS, async (tx) => {
      const { commitAuthority } = await import("@/platform/import");
      const authority = commitAuthority("assessment")!;
      return authority({
        tx,
        actor: stranger,
        context: { subjectType: "section_offering", subjectId: sectionOfferingId },
      });
    });
    expect(verdict).not.toBe(true);
    expect((verdict as { reason: string }).reason).toMatch(/teaching this section/i);
    void batchId;
  });

  it("lets the head write any section's marks, because they manage the registry", async () => {
    const verdict = await withTenantTx(DEPT_CS, async (tx) => {
      const { commitAuthority } = await import("@/platform/import");
      return commitAuthority("assessment")!({
        tx,
        actor: head,
        context: { subjectType: "section_offering", subjectId: sectionOfferingId },
      });
    });
    expect(verdict).toBe(true);
  });

  it("refuses a commit into a section whose assessment is already locked", async () => {
    await withTenantTx(DEPT_CS, (tx) =>
      tx.sectionOffering.update({
        where: { id: sectionOfferingId },
        data: { assessmentLockedAt: new Date() },
      }),
    );
    const { recordId, batchId } = await upload(ASSESSMENT_VALID);
    await expect(commit(recordId)).rejects.toThrow(/locked/i);
    await withTenantTx(DEPT_CS, (tx) =>
      tx.sectionOffering.update({
        where: { id: sectionOfferingId },
        data: { assessmentLockedAt: null },
      }),
    );
    void batchId;
  });
});
