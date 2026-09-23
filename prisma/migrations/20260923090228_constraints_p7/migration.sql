-- Hand-written (design part 06, P7). The partial index the open-work queries rely on:
-- "open" means no completedAt, and those are the rows My work and the overdue sweep scan.
-- `task_backing_check` arrives in P9, once every Task has a feature backing.

CREATE INDEX task_open_due_idx ON "task" ("department_id", "due_at") WHERE "completed_at" IS NULL;
