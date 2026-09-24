-- Hand-written (design part 03 §2). A faculty-wide feature key must be unique on its own:
-- `@@unique([key, department_id])` does not constrain rows whose department_id is NULL, because
-- NULLs never collide in a unique index. Department definitions keep shadowing the faculty one
-- by key, so only the NULL side is constrained here.

CREATE UNIQUE INDEX feature_definition_key_global
  ON feature_definition (key)
  WHERE department_id IS NULL;
