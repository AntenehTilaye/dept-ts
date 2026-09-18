import type { PrismaClient } from "../../src/generated/prisma/client";
import packageJson from "../../package.json" with { type: "json" };

// Faculty-wide SystemSettings. Later phases add their keys here (rbac exclusions,
// k-anonymity threshold, mass-send threshold, upload and import limits, ...).
export async function seedFaculty(db: PrismaClient) {
  const settings: Array<{ key: string; value: unknown }> = [
    { key: "app.version", value: packageJson.version },
  ];
  for (const { key, value } of settings) {
    await db.systemSetting.upsert({
      where: { key_scope_scopeId: { key, scope: "global", scopeId: "" } },
      update: { valueJson: value as object },
      create: { key, scope: "global", scopeId: "", valueJson: value as object, updatedBy: "seed" },
    });
  }
}
