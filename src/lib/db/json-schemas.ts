import { z, type ZodType } from "zod";

// Every Prisma `Json` column has a Zod schema registered here under "<Model>.<field>".
// prisma/scripts/check-schema.ts fails when a Json column is missing from this map, and the
// services validate at the boundary before writing (Prisma Json is untyped).
export const jsonSchemas: Record<string, ZodType> = {
  "Department.settingsJson": z.record(z.string(), z.unknown()),
  "SystemSetting.valueJson": z.unknown(),
  "ProfileItem.detailsJson": z.record(z.string(), z.unknown()),
  "AcademicYear.quarterBoundariesJson": z
    .array(
      z.object({ q: z.number().int().min(1).max(4), startDate: z.string(), endDate: z.string() }),
    )
    .length(4),
  "Resource.attributesJson": z.record(z.string(), z.unknown()),
};
