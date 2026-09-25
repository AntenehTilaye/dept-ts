import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { listReports } from "./registry";

// The registry is code; `report_definition` is the row an administrator can see and a schedule
// can point at. Seeding mirrors one into the other, so what is offered in the UI is exactly what
// is registered in the process.

export async function seedReportDefinitions(db: Db): Promise<number> {
  const reports = listReports();
  for (const report of reports) {
    const data = {
      title: report.title,
      dataSourceKey: report.key,
      templateKey: report.templateKey ?? "default",
      parametersSchemaJson: toJson({
        fields: report.parameterFields ?? [],
        description: report.description ?? "",
      }),
      supportedFormats: report.formats,
      requiredPermission: report.requiredPermission,
      isSystem: true,
      featureKey: report.featureKey ?? null,
    };
    await db.reportDefinition.upsert({
      where: { key: report.key },
      update: data,
      create: { key: report.key, ...data },
    });
  }
  return reports.length;
}
