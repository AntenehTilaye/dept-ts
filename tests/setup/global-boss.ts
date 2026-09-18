import { randomBytes } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import type { TestProject } from "vitest/node";
import { requireEnv } from "./urls";

// Provides a per-run pg-boss schema name (pgboss_it_<runid>) owned by dept_app: migrated here
// once (so the send-only client of the platform can enqueue without a supervising boss), used
// by the worker tests' own PgBoss (tests/setup/boss.ts), dropped afterwards.
export default async function setup(project: TestProject) {
  const schema = `pgboss_it_${randomBytes(4).toString("hex")}`;
  const migrator = new PgBoss({
    connectionString: requireEnv("DATABASE_URL"),
    schema,
    migrate: true,
    supervise: false,
    schedule: false,
    max: 2,
  });
  await migrator.start();
  const { ensureQueues } = await import("@/lib/db/boss");
  await ensureQueues(migrator);
  await migrator.stop({ graceful: false, timeout: 2_000 });
  project.provide("bossSchema", schema);
  return async () => {
    const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL") });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  };
}
