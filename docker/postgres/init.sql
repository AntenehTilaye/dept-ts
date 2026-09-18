-- Runs once when the pgdata volume is created. The ONLY place roles and databases are created.
-- dept_migrator: owner of every table, BYPASSRLS, used by prisma migrate / db seed / test resets.
-- dept_app:      runtime role for web, worker and integration tests; NOBYPASSRLS so RLS is the boundary.
CREATE ROLE dept_migrator LOGIN PASSWORD 'dept_migrator' CREATEDB BYPASSRLS;
CREATE ROLE dept_app      LOGIN PASSWORD 'dept_app' NOBYPASSRLS;

CREATE DATABASE dept      OWNER dept_migrator;
CREATE DATABASE dept_test OWNER dept_migrator;
CREATE DATABASE dept_e2e  OWNER dept_migrator;
-- pg-boss (running as dept_app) owns and migrates its own schema; CREATE SCHEMA IF NOT EXISTS
-- checks the database privilege before the existence check, so dept_app needs CREATE here.
GRANT CREATE ON DATABASE dept      TO dept_app;
GRANT CREATE ON DATABASE dept_test TO dept_app;
GRANT CREATE ON DATABASE dept_e2e  TO dept_app;

\connect dept
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA pgboss AUTHORIZATION dept_app;
GRANT USAGE ON SCHEMA public TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO dept_app;

\connect dept_e2e
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA pgboss AUTHORIZATION dept_app;
GRANT USAGE ON SCHEMA public TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO dept_app;

\connect dept_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA pgboss AUTHORIZATION dept_app;
GRANT USAGE ON SCHEMA public TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dept_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dept_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO dept_app;
