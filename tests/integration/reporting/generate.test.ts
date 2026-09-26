import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import type { Actor } from "@/platform/identity/can";
import {
  generate,
  listReports,
  ReportForbiddenError,
  runGeneration,
  seedReportDefinitions,
  setPdfRenderer,
} from "@/platform/reporting";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// Asking for a report and getting one, through the real permission check and the real storage.
// The PDF renderer belongs to the worker, so it is stubbed here — what matters is that a queued
// format becomes a job, a synchronous one becomes a file, and neither loses the permission gate.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let root: string;
let head: Actor;
let student: Actor;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-reports-"));
  setStorage(new LocalDiskStorage(root));
  await withDept(DEPT_CS, (tx) => seedReportDefinitions(tx));

  const [dh, rep] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "rep.cs@deptts.local" } }),
  ]);
  const person = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" }),
  );
  head = { userId: dh.id, personId: person.id, departmentId: DEPT_CS, isAdmin: false };
  student = { userId: rep.id, personId: null, departmentId: DEPT_CS, isAdmin: false };
});

afterAll(async () => {
  setStorage(null);
  setPdfRenderer(null);
  await rm(root, { recursive: true, force: true });
});

describe("generating a report", () => {
  it("mirrors the registry into report_definition so a page can list what exists", async () => {
    const rows = await migratorDb.reportDefinition.findMany({ orderBy: { key: "asc" } });
    // the framework's own three; every module that registers a report adds to this list, so the
    // assertion is about the mirroring rather than about how many modules exist today
    expect(rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["audit_extract", "department_activity", "task_list"]),
    );
    expect(rows.map((r) => r.key)).toEqual(listReports().map((r) => r.key).sort());
    const activity = rows.find((r) => r.key === "department_activity")!;
    expect(activity.supportedFormats).toContain("pdf");
    expect(activity.requiredPermission).toBe("task.view");
  });

  it("html comes back at once; the run and its audit row are written either way", async () => {
    const result = await withTenantTx(DEPT_CS, (tx) =>
      generate(tx, head, "department_activity", "html", {}),
    );
    expect(result.status).toBe("done");
    expect(result.html).toContain("<h1>Department activity</h1>");
    const run = await migratorDb.generatedReport.findUniqueOrThrow({ where: { id: result.id } });
    expect(run).toMatchObject({ status: "done", format: "html", reportKey: "department_activity" });
    // the interceptor records the row's own writes; this is the one the framework wrote
    expect(
      await migratorDb.auditEvent.count({
        where: {
          subjectType: "generated_report",
          subjectId: result.id,
          reason: "department_activity as html",
        },
      }),
    ).toBe(1);
  });

  it("csv is stored as a document that can be downloaded", async () => {
    const result = await withTenantTx(DEPT_CS, (tx) =>
      generate(tx, head, "task_list", "csv", { state: "open" }),
    );
    expect(result.documentId).toBeTruthy();
    const version = await migratorDb.documentVersion.findFirstOrThrow({
      where: { documentId: result.documentId! },
    });
    expect(version.mimeType).toBe("text/csv");
    const link = await migratorDb.documentLink.findFirstOrThrow({
      where: { documentId: result.documentId! },
    });
    expect(link).toMatchObject({ linkRole: "generated_output", subjectType: "generated_report" });
  });

  it("a format the worker renders is queued, and running it stores the file", async () => {
    setPdfRenderer(async (html) => Buffer.from(`%PDF-1.4\n${html.length} bytes`));
    const queued = await withTenantTx(DEPT_CS, (tx) =>
      generate(tx, head, "department_activity", "pdf", {}),
    );
    expect(queued.status).toBe("queued");
    expect(
      await migratorDb.scheduledJob.count({
        where: { subjectType: "generated_report", subjectId: queued.id },
      }),
    ).toBe(1);

    const documentId = await withTenantTx(DEPT_CS, (tx) => runGeneration(tx, queued.id));
    const run = await migratorDb.generatedReport.findUniqueOrThrow({ where: { id: queued.id } });
    expect(run.status).toBe("done");
    expect(run.generatedAt).not.toBeNull();
    const version = await migratorDb.documentVersion.findFirstOrThrow({
      where: { documentId: documentId! },
    });
    expect(version.mimeType).toBe("application/pdf");
  });

  it("an xlsx is a real workbook, rendered without a browser", async () => {
    const queued = await withTenantTx(DEPT_CS, (tx) => generate(tx, head, "task_list", "xlsx", {}));
    const documentId = await withTenantTx(DEPT_CS, (tx) => runGeneration(tx, queued.id));
    const version = await migratorDb.documentVersion.findFirstOrThrow({
      where: { documentId: documentId! },
    });
    expect(version.mimeType).toContain("spreadsheetml");
    expect(version.sizeBytes).toBeGreaterThan(1000);
  });

  it("refuses a report the actor may not run, and a format it does not offer", async () => {
    await expect(
      withTenantTx(DEPT_CS, (tx) => generate(tx, student, "audit_extract", "csv", {})),
    ).rejects.toBeInstanceOf(ReportForbiddenError);
    await expect(
      withTenantTx(DEPT_CS, (tx) => generate(tx, head, "audit_extract", "xlsx", {})),
    ).rejects.toThrow(/not available as xlsx/);
  });
});
