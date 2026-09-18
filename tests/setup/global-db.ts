import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { requireEnv, withSchema } from "./urls";

// Vitest globalSetup for the integration and worker projects: creates a fresh schema
// it_<runid> in dept_test as dept_migrator, grants dept_app the same default privileges the
// production schema has, applies every migration into it and provides the name to tests.
export default async function setup(project: TestProject) {
  const migratorUrl = requireEnv("DATABASE_URL_MIGRATE");
  const schema = `it_${randomBytes(4).toString("hex")}`;

  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO dept_app`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES TO dept_app`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${schema}" GRANT EXECUTE ON FUNCTIONS TO dept_app`,
    );
  } finally {
    await client.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL_MIGRATE: withSchema(migratorUrl, schema) },
    stdio: "inherit",
  });

  const { seedMinimal } = await import("./seed-minimal");
  await seedMinimal(schema);

  project.provide("testSchema", schema);
  if (process.env.TEST_LOG !== "silent") console.log(`[test-db] schema ${schema} ready`);

  return async () => {
    if (process.env.KEEP_TEST_SCHEMA === "1") {
      console.log(`[test-db] keeping schema ${schema}`);
      return;
    }
    const drop = new pg.Client({ connectionString: migratorUrl });
    await drop.connect();
    try {
      await drop.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await drop.end();
    }
  };
}
