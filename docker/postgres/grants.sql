-- Re-grants what `dept_app` needs on the current database. `init.sql` does this once when the
-- cluster is created, but `prisma migrate reset` drops and recreates the `public` schema, and the
-- grants go with it — after which the application role can read nothing and the seed fails with
-- "permission denied for schema public".
--
-- Run it against whichever database was reset:
--   docker compose exec -T db psql -U dept_migrator -d dept_e2e -f /docker-entrypoint-initdb.d/grants.sql
-- or, from the host with the file piped in:
--   docker compose exec -T db psql -U dept_migrator -d dept_e2e < docker/postgres/grants.sql

GRANT USAGE ON SCHEMA public TO dept_app;

-- what the migrator creates from now on
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO dept_app;

-- and what it has already created
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dept_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dept_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dept_app;

-- the append-only tables stay append-only (init.sql revokes these; a reset re-grants them)
REVOKE UPDATE, DELETE ON "audit_event", "workflow_transition_log", "event_handler_receipt"
  FROM dept_app;
