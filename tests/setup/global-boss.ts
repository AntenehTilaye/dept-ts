import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { requireEnv } from "./urls";

// Provides a per-run pg-boss schema name (pgboss_it_<runid>) owned by dept_app, which
// tests start their own PgBoss on (see tests/setup/boss.ts), and drops it afterwards.
export default async function setup(project: TestProject) {
  const schema = `pgboss_it_${randomBytes(4).toString("hex")}`;
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
