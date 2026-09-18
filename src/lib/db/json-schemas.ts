import { z, type ZodType } from "zod";

// Every Prisma `Json` column has a Zod schema registered here under "<Model>.<field>".
// prisma/scripts/check-schema.ts fails when a Json column is missing from this map, and the
// services validate at the boundary before writing (Prisma Json is untyped).
export const jsonSchemas: Record<string, ZodType> = {
  "Department.settingsJson": z.record(z.string(), z.unknown()),
  "SystemSetting.valueJson": z.unknown(),
};
