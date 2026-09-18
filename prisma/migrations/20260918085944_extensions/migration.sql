-- Hand-written. Extensions are database-wide and already created by docker/postgres/init.sql;
-- repeated here (trusted extensions, idempotent) so any fresh database gets them too.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
