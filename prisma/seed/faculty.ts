import type { PrismaClient } from "../../src/generated/prisma/client";
import packageJson from "../../package.json" with { type: "json" };

// Faculty-wide SystemSettings (scope global). Idempotent: existing values are kept for keys an
// administrator may have edited; only `app.version` is always refreshed.
export const FACULTY_SETTINGS: Array<{ key: string; value: unknown; refresh?: boolean }> = [
  { key: "app.version", value: packageJson.version, refresh: true },
  // Permissions a `manage`-level role (DPT) does not get even though the DH does.
  {
    key: "rbac.manageExcludedPermissions",
    value: [
      "portfolio.approve",
      "evaluation.close",
      "evaluation.analyze",
      "plan.approve",
      "minutes.approve",
    ],
  },
  // Aggregated evaluation/survey cells with fewer responses than this are suppressed.
  { key: "campaign.kThreshold", value: 5 },
  // Notifications to more recipients than this need an explicit confirmation.
  { key: "notify.massSendThreshold", value: 200 },
  { key: "upload.maxBytes", value: 25 * 1024 * 1024 },
  // Soft-deleted documents are purged (objects and rows) this many days later.
  { key: "document.retentionDays", value: 90 },
  { key: "import.maxRows", value: 5000 },
  { key: "case.autoCloseDays", value: 7 },
  { key: "appointments.publicRequests", value: true },
  // aggregate: attendance is captured in the portfolio narrative; per_student: imported per section.
  { key: "attendanceCaptureMode", value: "aggregate" },
];

export async function seedFaculty(db: PrismaClient) {
  for (const { key, value, refresh } of FACULTY_SETTINGS) {
    const where = { key_scope_scopeId: { key, scope: "global" as const, scopeId: "" } };
    const existing = await db.systemSetting.findUnique({ where });
    if (existing && !refresh) continue;
    await db.systemSetting.upsert({
      where,
      update: { valueJson: value as object },
      create: { key, scope: "global", scopeId: "", valueJson: value as object, updatedBy: "seed" },
    });
  }
}
