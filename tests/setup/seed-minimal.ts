import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { poolConfig } from "@/lib/db/prisma";
import { seedFaculty } from "../../prisma/seed/faculty";
import { requireEnv } from "./urls";

// The smallest seed every integration test relies on. Runs as dept_migrator under bypass.
// Departments CS and EE are created directly here until the authentication phase switches
// department creation to the better-auth organization API (ids then equal organization ids).
export const DEPT_CS = "dep_cs";
export const DEPT_EE = "dep_ee";

export async function seedMinimal(schema: string): Promise<void> {
  const db = new PrismaClient({
    adapter: new PrismaPg(poolConfig(requireEnv("DATABASE_URL_MIGRATE"), schema, 2), { schema }),
  });
  try {
    await db.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', false)`;
    await seedFaculty(db);
    for (const [id, code, name] of [
      [DEPT_CS, "CS", "Computer Science"],
      [DEPT_EE, "EE", "Electrical Engineering"],
    ] as const) {
      await db.department.upsert({
        where: { id },
        update: {},
        create: { id, organizationId: id, code, name },
      });
    }
  } finally {
    await db.$disconnect();
  }
}
