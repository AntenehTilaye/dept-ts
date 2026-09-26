import type { PrismaClient } from "../../../src/generated/prisma/client";
import { validateBody } from "../../../src/platform/template/mustache-safe";
import { SEED_TEMPLATES as KERNEL_TEMPLATES } from "./catalogue";
import { ASSESSMENT_TEMPLATES } from "./assessment";
import { COMMITTEE_TEMPLATES } from "./committee";

// The kernel's own keys plus every module's. A module owns its keys outright: nothing here
// merges two sources for one key, so a duplicate would be a bug the seed test catches.
export const SEED_TEMPLATES = [
  ...KERNEL_TEMPLATES,
  ...COMMITTEE_TEMPLATES,
  ...ASSESSMENT_TEMPLATES,
];

/** Seeds the faculty templates (version 1, active); refreshes v1 in place while it is the active one. */
export async function seedTemplates(db: PrismaClient) {
  for (const t of SEED_TEMPLATES) {
    for (const [variant, body] of [
      ["inApp", t.inApp],
      ["emailSubject", t.emailSubject],
      ["emailBody", t.emailBody],
    ] as const) {
      const undeclared = validateBody(body, t.variables);
      if (undeclared.length)
        throw new Error(
          `seed template ${t.key}.${variant} references undeclared variables: ${undeclared.join(", ")}`,
        );
    }
    const variants = { inApp: t.inApp, emailSubject: t.emailSubject, emailBody: t.emailBody };
    const existing = await db.template.findFirst({
      where: { departmentId: null, key: t.key },
      include: { versions: { where: { version: 1 } } },
    });
    if (existing) {
      const v1 = existing.versions[0];
      if (v1 && existing.activeVersion === 1) {
        await db.templateVersion.update({
          where: { id: v1.id },
          data: { channelVariantsJson: variants, declaredVariablesJson: t.variables },
        });
      }
      continue;
    }
    const row = await db.template.create({
      data: {
        departmentId: null,
        key: t.key,
        kind: t.kind,
        contextType: (t.contextType ?? null) as never,
        isSystem: true,
        activeVersion: 1,
      },
    });
    await db.templateVersion.create({
      data: {
        templateId: row.id,
        version: 1,
        channelVariantsJson: variants,
        declaredVariablesJson: t.variables,
        status: "active",
        createdBy: "seed",
      },
    });
  }
}
