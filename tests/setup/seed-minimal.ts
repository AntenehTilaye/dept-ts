import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { seedFaculty } from "../../prisma/seed/faculty";
import { requireEnv } from "./urls";

// The smallest seed every integration test relies on. Runs as dept_migrator under bypass.
// Later phases add departments CS and EE (via the better-auth organization API), one
// academic year/term, one user per role per department and the permission matrix.
export async function seedMinimal(schema: string): Promise<void> {
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: requireEnv("DATABASE_URL_MIGRATE"), max: 2 },
      { schema },
    ),
  });
  try {
    await db.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', false)`;
    await seedFaculty(db);
  } finally {
    await db.$disconnect();
  }
}
