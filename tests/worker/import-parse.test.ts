import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage, storage } from "@/lib/storage";
import type { Actor } from "@/platform/identity/can";
import { createBatch } from "@/platform/import";
import importParse from "../../apps/worker/src/handlers/import-parse";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import { upsertProgram } from "@/platform/academic/courses";
import * as f from "../setup/factories";
import { csvOf, ROSTER_VALID } from "../fixtures/workbooks";

// A file too large to read inside a request is read by the worker instead. The states of the
// import do not change — only where the reading happens — so this checks that the handler
// leaves the batch exactly as the inline path would.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let root: string;
let head: Actor;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-import-worker-"));
  setStorage(new LocalDiskStorage(root));
  const user = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  const person = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: user.id, email: "dh.cs@deptts.local" }),
  );
  head = { userId: user.id, personId: person.id, departmentId: DEPT_CS, isAdmin: false };

  // the fixture names a programme and a section, and a roster that names neither is all errors
  await withDept(DEPT_CS, async (tx) => {
    const program = await upsertProgram(tx, DEPT_CS, {
      code: "BSC-CS",
      name: "BSc in Computer Science",
      degreeLevel: "BSc",
      durationYears: 4,
    });
    if (!(await tx.section.findFirst({ where: { code: "CS-Y2-A" } })))
      await f.section(tx, DEPT_CS, { code: "CS-Y2-A", yearLevel: 2, programId: program.id });
  });
});

afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

describe("import.parse", () => {
  it("reads the stored file into rows and checks them in one job", async () => {
    const created = await withTenantTx(DEPT_CS, (tx) =>
      createBatch(tx, DEPT_CS, head, {
        kind: "roster",
        file: {
          bytes: Buffer.from(csvOf(ROSTER_VALID)),
          originalName: "roster.csv",
          mimeType: "text/csv",
        },
      }),
    );
    // the rows the inline path already stored are replaced by the job's own reading
    await migratorDb.importRow.deleteMany({ where: { batchId: created.batchId } });

    const stored = await storage().put(Buffer.from(csvOf(ROSTER_VALID)), { mimeType: "text/csv" });
    await importParse.handle(
      [
        {
          id: "job",
          name: "import.parse",
          data: {
            batchId: created.batchId,
            departmentId: DEPT_CS,
            storageKey: stored.key,
            nameOrType: "roster.csv",
            validate: true,
          },
        } as never,
      ],
      { boss: null as never },
    );

    const rows = await migratorDb.importRow.findMany({ where: { batchId: created.batchId } });
    expect(rows).toHaveLength(3);
    // "checked" means every row has a verdict, not merely that it was read
    expect(rows.every((r) => Array.isArray(r.errorsJson))).toBe(true);
    const batch = await migratorDb.importBatch.findUniqueOrThrow({
      where: { id: created.batchId },
    });
    expect(batch.summaryJson).toMatchObject({ rows: 3, errors: 0 });
  });
});
