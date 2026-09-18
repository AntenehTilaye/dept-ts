import { z, type ZodType } from "zod";

// Every Prisma `Json` column has a Zod schema registered here under "<Model>.<field>".
// prisma/scripts/check-schema.ts fails when a Json column is missing from this map.
export const jsonSchemas: Record<string, ZodType> = {
  "SystemSetting.valueJson": z.unknown(),
};

export function jsonSchemaFor(model: string, field: string): ZodType | undefined {
  return jsonSchemas[`${model}.${field}`];
}
