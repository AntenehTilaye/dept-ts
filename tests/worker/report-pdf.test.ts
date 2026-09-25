import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage, storage } from "@/lib/storage";
import type { Actor } from "@/platform/identity/can";
import { generate, seedReportDefinitions, setPdfRenderer } from "@/platform/reporting";
import reportGenerate from "../../apps/worker/src/handlers/report-generate";
import { closeBrowser, renderPdf } from "../../apps/worker/src/pdf/browser";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";

// The one place a real browser is involved. It is slow, so there is one test of the renderer
// itself and one of the handler that uses it — enough to know that a PDF is a PDF and that a
// failure is written onto the run instead of vanishing.

vi.setConfig({ testTimeout: 180_000 });
bootstrap();

let root: string;
let head: Actor;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-pdf-"));
  setStorage(new LocalDiskStorage(root));
  await withDept(DEPT_CS, (tx) => seedReportDefinitions(tx));
  const user = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  const person = await withDept(DEPT_CS, (tx) =>
    f.staff(tx, DEPT_CS, { userId: user.id, email: "dh.cs@deptts.local" }),
  );
  head = { userId: user.id, personId: person.id, departmentId: DEPT_CS, isAdmin: false };
});

afterAll(async () => {
  await closeBrowser();
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

describe("rendering a PDF", () => {
  it("turns a report page into a real PDF", async () => {
    const pdf = await renderPdf(
      "<!doctype html><html><body><h1>Department activity</h1><p>March</p></body></html>",
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("the handler stores what it rendered, and two pages share one browser", async () => {
    const queued = await withTenantTx(DEPT_CS, (tx) =>
      generate(tx, head, "department_activity", "pdf", {}),
    );
    await reportGenerate.handle(
      [
        {
          id: "job",
          name: "report.generate",
          data: { generatedReportId: queued.id, departmentId: DEPT_CS },
        } as never,
      ],
      { boss: null as never },
    );

    const run = await migratorDb.generatedReport.findUniqueOrThrow({ where: { id: queued.id } });
    expect(run.status).toBe("done");
    const version = await migratorDb.documentVersion.findFirstOrThrow({
      where: { documentId: run.documentId! },
    });
    expect(version.mimeType).toBe("application/pdf");

    const stream = await storage().get(version.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("a run that fails says why, on the run itself", async () => {
    const queued = await withTenantTx(DEPT_CS, (tx) =>
      generate(tx, head, "department_activity", "pdf", {}),
    );
    // what a crashed browser looks like from here
    setPdfRenderer(async () => {
      throw new Error("Target page, context or browser has been closed");
    });

    await expect(
      reportGenerate.handle(
        [
          {
            id: "job",
            name: "report.generate",
            data: { generatedReportId: queued.id, departmentId: DEPT_CS },
          } as never,
        ],
        { boss: null as never },
      ),
    ).rejects.toThrow();

    const run = await migratorDb.generatedReport.findUniqueOrThrow({ where: { id: queued.id } });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("browser has been closed");
    setPdfRenderer(renderPdf);
  });
});
