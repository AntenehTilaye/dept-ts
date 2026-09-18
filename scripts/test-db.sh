#!/usr/bin/env sh
# Inside a container: create a throwaway schema in the current DATABASE_URL_MIGRATE database
# with dept_app privileges and migrate it. Prints the schema name.
#   docker compose --profile test run --rm test sh scripts/test-db.sh
set -eu
SCHEMA="${1:-it_$(node -e 'process.stdout.write(require("crypto").randomBytes(4).toString("hex"))')}"
node -e '
const pg = require("pg");
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE });
  await c.connect();
  const s = process.argv[1];
  await c.query(`CREATE SCHEMA IF NOT EXISTS "${s}"`);
  await c.query(`GRANT USAGE ON SCHEMA "${s}" TO dept_app`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${s}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${s}" GRANT USAGE, SELECT ON SEQUENCES TO dept_app`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA "${s}" GRANT EXECUTE ON FUNCTIONS TO dept_app`);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
' "$SCHEMA"
BASE="${DATABASE_URL_MIGRATE%%\?*}"
DATABASE_URL_MIGRATE="${BASE}?schema=${SCHEMA}" npx prisma migrate deploy
echo "$SCHEMA"
