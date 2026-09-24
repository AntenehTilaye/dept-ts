-- Hand-written (design part 06, P9b). The promise P7 deferred: every task has a feature
-- backing, so there is exactly one lifecycle for a task wherever it came from.
--
-- A Task row is one of three things and nothing else:
--   * the record of the `task` feature it belongs to (feature_record_id),
--   * the companion a feature step created for whoever works on it (feature_step_instance_id),
--   * the template of a recurrence rule, which is a description of future tasks, not work
--     anybody does (recurrence_rule_id).
-- The provisional `task` workflow definition was retired with this constraint: nothing can
-- create a task that owns a lifecycle of its own any more.

ALTER TABLE "task"
  ADD CONSTRAINT task_backing_check CHECK (
    "feature_record_id" IS NOT NULL
    OR "feature_step_instance_id" IS NOT NULL
    OR "recurrence_rule_id" IS NOT NULL
  );
