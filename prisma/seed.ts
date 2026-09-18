import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { poolConfig } from "../src/lib/db/prisma";
import { seedDepartments } from "./seed/departments";
import { seedFaculty } from "./seed/faculty";
import { seedPermissions } from "./seed/permissions";
import { seedUsers } from "./seed/users";

// Runs via `prisma db seed` under DATABASE_URL_MIGRATE (dept_migrator, BYPASSRLS) for the
// tables it writes directly; users go through better-auth, which uses the runtime client.
// Every seeder is idempotent (upsert by key). Module seeders are appended by their phases.
export async function runSeed(db: PrismaClient) {
  await db.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', false)`;
  await seedFaculty(db);
  await seedPermissions(db);
  await seedDepartments(db);
  await seedUsers(db);
}

async function main() {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) throw new Error("DATABASE_URL_MIGRATE is required to seed");
  const schema = new URL(url).searchParams.get("schema") ?? "public";
  process.env.DATABASE_SCHEMA = schema;
  const db = new PrismaClient({ adapter: new PrismaPg(poolConfig(url, schema, 4), { schema }) });
  try {
    await runSeed(db);
    console.log("seed: done");
  } finally {
    await db.$disconnect();
  }
}

const invokedDirectly = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
