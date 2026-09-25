import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { dispatchPending } from "@/platform/audit/outbox";
import { act } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { createBatch, fixRow, preview } from "@/platform/import";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import { upsertProgram } from "@/platform/academic/courses";
import * as f from "../../setup/factories";
import { csvOf, ROSTER_ERRORS, ROSTER_VALID, workbookOf } from "../../fixtures/workbooks";

// The staged pipeline end to end: a file arrives, the columns are worked out, the rows are
// checked, somebody fixes what is wrong, and only then is anything written. The states are the
// `import_batch` feature's, so this also proves the definition and the adapters agree.

vi.setConfig({ testTimeout: 120_000 });
bootstrap();

let root: string;
let head: Actor;
let sectionId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-import-"));
  setStorage(new LocalDiskStorage(root));

  const user = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  const person = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: user.id, email: "dh.cs@deptts.local" }),
  );
  head = { userId: user.id, personId: person.id, departmentId: DEPT_CS, isAdmin: false };

  // the fixtures name a programme and a section, so this schema has to hold those codes
  await withDept(DEPT_CS, async (tx) => {
    const program = await upsertProgram(tx, DEPT_CS, {
      code: "BSC-CS",
      name: "BSc in Computer Science",
      degreeLevel: "BSc",
      durationYears: 4,
    });
    const existing = await tx.section.findFirst({ where: { code: "CS-Y2-A" } });
    sectionId =
      existing?.id ??
      (await f.section(tx, DEPT_CS, { code: "CS-Y2-A", yearLevel: 2, programId: program.id })).id;
  });
});

afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

const section = () => ({ subjectType: "section", subjectId: sectionId });

describe("the import pipeline", () => {
  it("reads a workbook into rows, checks them and commits the roster", async () => {
    const created = await withTenantTx(DEPT_CS, (tx) =>
      createBatch(tx, DEPT_CS, head, {
        kind: "roster",
        context: section(),
        file: {
          bytes: Buffer.from(csvOf(ROSTER_VALID)),
          originalName: "roster.csv",
          mimeType: "text/csv",
        },
      }),
    );
    // the record is the lifecycle: it exists, it is in `uploaded`, and it has the file
    const record = await migratorDb.featureRecord.findUniqueOrThrow({
      where: { id: created.recordId },
    });
    expect(record.currentStateKey).toBe("uploaded");
    const batch = await migratorDb.importBatch.findUniqueOrThrow({ where: { id: created.batchId } });
    expect(batch.sourceDocumentId).not.toBeNull();
    expect(created.summary.rows).toBe(3);
    expect(created.summary.mappings).toMatchObject({ student_number: "Student number" });

    // reading the file and checking the rows are the two transitions of the process
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "uploaded", "parse", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "parsed", "validate", head));
    const validated = await migratorDb.importBatch.findUniqueOrThrow({
      where: { id: created.batchId },
    });
    expect((validated.summaryJson as { errors: number }).errors).toBe(0);
    expect(
      await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: created.recordId } }),
    ).toMatchObject({ currentStateKey: "validated" });

    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "validated", "commit", head));

    const committed = await migratorDb.importBatch.findUniqueOrThrow({
      where: { id: created.batchId },
    });
    expect(committed.committedAt).not.toBeNull();
    const students = await migratorDb.student.findMany({
      where: { studentNumber: { in: ROSTER_VALID.rows.map((r) => String(r[0])) } },
      include: { sectionMemberships: true },
    });
    expect(students).toHaveLength(3);
    expect(students.every((s) => s.sectionMemberships.some((m) => m.sectionId === sectionId))).toBe(
      true,
    );
    // and it said so, for whoever is listening
    await dispatchPending(50);
    expect(
      await migratorDb.domainEvent.count({
        where: { name: "import.committed", aggregateId: created.batchId },
      }),
    ).toBe(1);
  });

  it("refuses to commit while a row is wrong, and accepts it once the row is fixed", async () => {
    const bytes = await workbookOf([ROSTER_ERRORS]);
    const created = await withTenantTx(DEPT_CS, (tx) =>
      createBatch(tx, DEPT_CS, head, {
        kind: "roster",
        context: section(),
        file: {
          bytes,
          originalName: "roster-errors.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      }),
    );
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "uploaded", "parse", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "parsed", "validate", head));

    const summary = (
      await migratorDb.importBatch.findUniqueOrThrow({ where: { id: created.batchId } })
    ).summaryJson as { errors: number; warnings: number };
    expect(summary.errors).toBe(3); // the two duplicates and the row with two problems
    expect(summary.warnings).toBe(1); // the name that disagrees with the record

    // the commit is refused by the guard, with the count in the message
    await expect(
      withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "validated", "commit", head)),
    ).rejects.toThrow(/row\(s\) still have errors/);

    // the preview shows the rows with what is wrong beside them
    const page = await withTenantTx(DEPT_CS, (tx) =>
      preview(tx, created.batchId, { only: "error" }),
    );
    expect(page.total).toBe(3);

    // fixing the lines is enough: the batch is checked again and the errors go
    await withTenantTx(DEPT_CS, (tx) =>
      fixRow(tx, created.batchId, 2, { student_number: "UGR/2099/16" }),
    );
    const fixed = await withTenantTx(DEPT_CS, (tx) =>
      fixRow(tx, created.batchId, 3, {
        email: "elias@student.local",
        section_code: "CS-Y2-A",
      }),
    );
    expect(fixed.errors).toBe(0);

    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "validated", "commit", head));
    expect(
      await migratorDb.student.count({ where: { studentNumber: "UGR/2099/16" } }),
    ).toBe(1);
  });

  it("a commit replaces the previous batch of the same context", async () => {
    const batches = await migratorDb.importBatch.findMany({
      where: { contextType: "section", contextId: sectionId, committedAt: { not: null } },
      orderBy: { committedAt: "asc" },
    });
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.at(-1)!.replacesBatchId).toBe(batches.at(-2)!.id);
  });

  it("a typed grid needs no file and travels the same states", async () => {
    const created = await withTenantTx(DEPT_CS, (tx) =>
      createBatch(tx, DEPT_CS, head, {
        kind: "roster",
        context: section(),
        manualRows: {
          headers: ["Student number", "Full name"],
          rows: [{ "Student number": "UGR/3001/16", "Full name": "Genet Alemu" }],
        },
      }),
    );
    expect(created.summary.rows).toBe(1);
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "uploaded", "parse", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "parsed", "validate", head));
    await withTenantTx(DEPT_CS, (tx) => act(tx, created.recordId, "validated", "commit", head));
    expect(await migratorDb.student.count({ where: { studentNumber: "UGR/3001/16" } })).toBe(1);
  });
});
