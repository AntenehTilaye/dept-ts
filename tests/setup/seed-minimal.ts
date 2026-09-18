import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { poolConfig } from "@/lib/db/prisma";
import { runSeed } from "../../prisma/seed";
import { requireEnv } from "./urls";

// The smallest seed every integration test relies on: the full idempotent seed (faculty
// settings, permission matrix, departments CS/EE with fixed ids, one user per role).
// Callers must have set process.env.DATABASE_SCHEMA to the per-run schema first, because the
// better-auth user creation goes through the process-wide runtime client.
export const DEPT_CS = "dep_cs";
export const DEPT_EE = "dep_ee";

export async function seedMinimal(schema: string): Promise<void> {
  if (process.env.DATABASE_SCHEMA !== schema) {
    throw new Error(
      `DATABASE_SCHEMA must be "${schema}" before seeding (got "${process.env.DATABASE_SCHEMA}")`,
    );
  }
  const db = new PrismaClient({
    adapter: new PrismaPg(poolConfig(requireEnv("DATABASE_URL_MIGRATE"), schema, 2), { schema }),
  });
  try {
    await runSeed(db);
  } finally {
    await db.$disconnect();
  }
}
