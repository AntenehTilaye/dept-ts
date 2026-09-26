"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { createBatch } from "@/platform/import";
import { act } from "@/platform/feature";
import { SchemeError, setComponents } from "./service";

// The two things somebody does on the assessment page that are not the import process itself:
// saying how the course is marked, and starting an import of marks for one section. Everything
// after the start — reading the file, the columns, the preview, the fixes, the commit — is the
// `import_batch` process, on its own pages.

const Component = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "a component key is lower_snake_case"),
  name: z.string().min(1).max(120),
  maxMark: z.coerce.number().min(0.01).max(1000),
  weightPercent: z.coerce.number().min(0).max(100),
  isFinal: z.coerce.boolean().optional(),
  excludedFromConsolidation: z.coerce.boolean().optional(),
});

export const saveSchemeAction = safeAction(
  z.object({
    courseOfferingId: z.string().min(1),
    sectionOfferingId: z.string().min(1).nullable().default(null),
    components: z.array(Component).min(1),
  }),
  async ({ input, ctx, db }) => {
    try {
      const result = await setComponents(
        db,
        ctx.departmentId,
        {
          courseOfferingId: input.courseOfferingId,
          sectionOfferingId: input.sectionOfferingId,
        },
        input.components,
      );
      revalidatePath(`/d/${ctx.deptSlug}/assessment`);
      if (input.sectionOfferingId)
        revalidatePath(`/d/${ctx.deptSlug}/assessment/${input.sectionOfferingId}`);
      return result;
    } catch (error) {
      // a locked structure and a scheme that does not add up are things to tell somebody, not
      // stack traces to hide
      if (error instanceof SchemeError) throw new Error(error.message);
      throw error;
    }
  },
  { permission: "academic.manage", verb: "manage" },
);

export const startMarkImportAction = safeAction(
  z.object({
    sectionOfferingId: z.string().min(1),
    kind: z.enum(["assessment", "attendance"]).default("assessment"),
    fileName: z.string().min(1).max(200),
    /** The workbook, base64 — the page reads the file the person chose. */
    bytes: z.string().min(1),
    mimeType: z.string().min(1).max(120),
  }),
  async ({ input, ctx, db }) => {
    const actor = actorOf(ctx);
    const created = await createBatch(db, ctx.departmentId, actor, {
      kind: input.kind,
      context: { subjectType: "section_offering", subjectId: input.sectionOfferingId },
      file: {
        bytes: Buffer.from(input.bytes, "base64"),
        originalName: input.fileName,
        mimeType: input.mimeType,
      },
    });
    // reading the file is the first step's own work, so the import arrives at the columns page
    await act(db, created.recordId, "uploaded", "parse", actor);
    revalidatePath(`/d/${ctx.deptSlug}/assessment/${input.sectionOfferingId}`);
    return { recordId: created.recordId, batchId: created.batchId };
  },
  {
    permission: "assessment.import",
    verb: "submit",
    // the section is the subject: an instructor holds `assessment.import` for the sections they
    // are assigned to teach, and for no others
    subject: (input) => ({
      subjectType: "section_offering",
      subjectId: input.sectionOfferingId,
    }),
  },
);
