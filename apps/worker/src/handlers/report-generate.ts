import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { runGeneration, setPdfRenderer } from "@/platform/reporting";
import { renderPdf } from "../pdf/browser";
import type { WorkerHandler } from "./types";

interface Data {
  generatedReportId: string;
  departmentId: string;
}

// Rendering a report the web process could not: a PDF needs a browser, and a workbook can be
// large enough that nobody should wait for it in a request. The failure is written onto the run
// so the page can say what went wrong rather than spinning.

setPdfRenderer(renderPdf);

const handler: WorkerHandler<Data> = {
  queue: "report.generate",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { generatedReportId, departmentId } = job.data;
      try {
        const documentId = await runWithAudit(
          { departmentId, actorUserId: null, correlationId: `report:${generatedReportId}` },
          () => withTenantTx(departmentId, (tx) => runGeneration(tx, generatedReportId)),
        );
        console.log(`[report.generate] ${generatedReportId}: stored ${documentId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        await withTenantTx(departmentId, (tx) =>
          tx.generatedReport.update({
            where: { id: generatedReportId },
            data: { status: "failed", error: message },
          }),
        );
        console.error(`[report.generate] ${generatedReportId} failed: ${message}`);
        throw error;
      }
    }
  },
};

export default handler;
