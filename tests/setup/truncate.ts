import type { PrismaClient } from "@/generated/prisma/client";
import { loadDmmf, tableName } from "../../prisma/scripts/dmmf";

// Tables that hold seed data and survive per-file truncation. Later phases append
// roles, permissions, templates, forms, workflows and feature definitions.
export const SEED_TABLES = new Set<string>([
  "system_setting",
  "department",
  "organization",
  "permission",
  "role",
  "role_permission",
  "user",
  "account",
  "member",
  "role_grant",
]);

let cached: string[] | undefined;

export async function truncatableTables(): Promise<string[]> {
  if (!cached) {
    const dmmf = await loadDmmf();
    cached = dmmf.datamodel.models
      .map(tableName)
      .filter((t) => !SEED_TABLES.has(t))
      .sort();
  }
  return cached;
}

export async function truncateAll(db: PrismaClient, schema: string): Promise<void> {
  const tables = await truncatableTables();
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${schema}"."${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
