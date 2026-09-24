-- Hand-written (design part 06, P10). The busy-time ledger is only worth having if the database
-- itself refuses a double booking, so two rules sit on `availability_block`:
--
--   * a block ends after it starts;
--   * two HARD blocks of the same owner may not overlap in time. The exclusion covers persons
--     and resources alike (owner_type is part of the key), and skips the weekly templates
--     (`weekday IS NOT NULL`) — `materialiseRecurring(termId)` expands those into concrete rows,
--     which is when they join the constraint.
--
-- btree_gist gives the equality operators for the two text/enum columns inside a gist index, and
-- the range is `tsrange`: Prisma stores DateTime as `timestamp(3)` without a zone, and
-- `tstzrange` over those columns depends on the session's TimeZone, which an index may not.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "availability_block"
  ADD CONSTRAINT block_range_valid CHECK ("end_at" > "start_at");

ALTER TABLE "availability_block"
  ADD CONSTRAINT no_hard_overlap EXCLUDE USING gist (
    "owner_type" WITH =,
    "owner_id" WITH =,
    tsrange("start_at", "end_at") WITH &&
  ) WHERE ("severity" = 'hard' AND "weekday" IS NULL);
