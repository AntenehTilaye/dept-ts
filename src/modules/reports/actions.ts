"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { downloadUrl } from "@/platform/document";
import { generate, ReportForbiddenError } from "@/platform/reporting";

// Asking for a report. The framework decides whether the answer comes back now (html, csv) or
// as a job (pdf, xlsx); the page polls the run either way.

export const generateReportAction = safeAction(
  z.object({
    reportKey: z.string().min(1),
    format: z.enum(["pdf", "xlsx", "csv", "html"]),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  async ({ input, ctx, db }) => {
    try {
      const actor = actorOf(ctx);
      const result = await generate(db, actor, input.reportKey, input.format, input.params);
      const link = result.documentId
        ? await downloadUrl(db, actor, result.documentId)
        : null;
      revalidatePath(`/d/${ctx.deptSlug}/reports`);
      return {
        id: result.id,
        status: result.status,
        documentId: result.documentId ?? null,
        url: link?.url ?? null,
      };
    } catch (error) {
      if (error instanceof ReportForbiddenError) throw new Error(error.message);
      throw error;
    }
  },
  { permission: "task.view", verb: "read" },
);
