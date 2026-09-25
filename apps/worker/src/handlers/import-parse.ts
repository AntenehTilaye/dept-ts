import type { Job } from "pg-boss";
import { withTenantTx } from "@/lib/db/tenant";
import { runWithAudit } from "@/platform/audit/context";
import { storage } from "@/lib/storage";
import { parseBatch, validateBatch } from "@/platform/import";
import type { WorkerHandler } from "./types";

interface Data {
  batchId: string;
  departmentId: string;
  storageKey: string;
  nameOrType: string;
  sheetName?: string | null;
  headerRowIndex?: number;
  /** Check the rows as soon as they are read; a big file is usually both in one go. */
  validate?: boolean;
}

/**
 * Reads a file too large to read inside a request. The states of the import are the same either
 * way — this only moves the reading off the web process — so the page shows the same batch with
 * more rows in it when the job finishes.
 */
const handler: WorkerHandler<Data> = {
  queue: "import.parse",
  async handle(jobs: Job<Data>[]) {
    for (const job of jobs) {
      const { batchId, departmentId, storageKey, nameOrType, sheetName, headerRowIndex } = job.data;
      const stream = await storage().get(storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      const bytes = Buffer.concat(chunks);

      const summary = await runWithAudit(
        { departmentId, actorUserId: null, correlationId: `import-parse:${batchId}` },
        () =>
          withTenantTx(departmentId, async (tx) => {
            const parsed = await parseBatch(tx, batchId, {
              bytes,
              nameOrType,
              sheetName: sheetName ?? null,
              ...(headerRowIndex ? { headerRowIndex } : {}),
            });
            return job.data.validate ? validateBatch(tx, batchId) : parsed;
          }),
      );
      console.log(
        `[import.parse] ${batchId}: ${summary.rows} row(s), ${summary.errors} with errors`,
      );
    }
  },
};

export default handler;
