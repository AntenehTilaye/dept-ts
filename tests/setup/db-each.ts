import { afterAll, beforeAll, inject } from "vitest";

// Runs before each test file is imported: point the process-wide root client
// (src/lib/db/prisma.ts, used by worker handlers) at the per-run schema, then wipe every
// non-seed table and restore the minimal seed.
process.env.DATABASE_SCHEMA = inject("testSchema");
process.env.PGBOSS_SCHEMA = inject("bossSchema");

const { migratorDb, appDb, testSchema } = await import("./db");
const { truncateAll } = await import("./truncate");
const { seedMinimal } = await import("./seed-minimal");

beforeAll(async () => {
  await truncateAll(migratorDb, testSchema);
  await seedMinimal(testSchema);
});

afterAll(async () => {
  await Promise.all([migratorDb.$disconnect(), appDb.$disconnect()]);
});
