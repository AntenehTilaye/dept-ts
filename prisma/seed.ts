import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { poolConfig } from "../src/lib/db/prisma";
import { seedDepartments } from "./seed/departments";
import { seedFaculty } from "./seed/faculty";
import { seedPermissions } from "./seed/permissions";
import { seedUsers } from "./seed/users";
import { seedCalendar } from "./seed/calendar";
import { seedDemo } from "./seed/demo";
import { seedReminderSchedules } from "./seed/reminder-schedules";
import { seedTemplates } from "./seed/templates";
import { seedForms } from "./seed/forms";
import { seedAdapters } from "./seed/adapters";
import { seedFeatures } from "./seed/features";
import { backfillOfferingRecords } from "./seed/features/backfill-offering-records";
import { seedReportDefinitions } from "../src/platform/reporting";
import { rebuild as rebuildSearch } from "../src/platform/search";
import { rebuildProjections } from "../src/platform/dashboard";
import { withTenantTx } from "../src/lib/db/tenant";
import { bootstrap } from "../src/lib/bootstrap";
import { stopBoss } from "../src/lib/db/boss";

// Runs via `prisma db seed` under DATABASE_URL_MIGRATE (dept_migrator, BYPASSRLS) for the
// tables it writes directly; users go through better-auth, which uses the runtime client.
// Every seeder is idempotent (upsert by key). Module seeders are appended by their phases.
export async function runSeed(db: PrismaClient) {
  // the demo seeders call platform services, which need the registries and effects installed
  bootstrap();
  await db.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', false)`;
  await seedFaculty(db);
  await seedPermissions(db);
  await seedDepartments(db);
  await seedUsers(db);
  await seedCalendar(db);
  await seedReminderSchedules(db);
  await seedTemplates(db);
  await seedForms(db);
  await seedAdapters(db);
  await seedFeatures();
  await seedReportDefinitions(db);
  if (process.env.SEED_DEMO === "1") await seedDemo(db);

  // an offering that existed before offerings were a process gets the record it should have had
  const backfilled = await backfillOfferingRecords(db);
  if (backfilled.created || backfilled.skipped)
    console.log(
      `seed: offering records — ${backfilled.created} created, ${backfilled.advanced} already under way, ${backfilled.skipped} skipped`,
    );

  // a seeded department is searchable straight away: the subscribers keep the index current
  // from here, but nothing they listen to has happened for the rows the seed just wrote
  for (const department of await db.department.findMany({ select: { id: true } })) {
    const result = await withTenantTx(department.id, (tx) => rebuildSearch(tx, department.id));
    console.log(`seed: search index ${department.id} — ${result.indexed} row(s)`);
    // the dashboards are derived the same way, and for the same reason: nothing the projections
    // listen to has happened for the rows the seed just wrote
    const projections = await withTenantTx(department.id, (tx) =>
      rebuildProjections(tx, department.id),
    );
    console.log(
      `seed: projections ${department.id} — ${projections.map((p) => `${p.projectionKey}=${p.rows}`).join(", ")}`,
    );
  }
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
    // the demo seeders enqueue jobs; the lazily started pg-boss client would keep us alive
    await stopBoss();
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
