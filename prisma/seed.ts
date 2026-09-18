import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedFaculty } from "./seed/faculty";

// Runs via `prisma db seed` under DATABASE_URL_MIGRATE (dept_migrator, BYPASSRLS).
// Every seeder is idempotent (upsert by key). Module seeders are appended by their phases.
async function main() {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) throw new Error("DATABASE_URL_MIGRATE is required to seed");
  const schema = new URL(url).searchParams.get("schema") ?? "public";
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 4 }, { schema }),
  });
  try {
    await db.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', false)`;
    await seedFaculty(db);
    console.log("seed: done");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
