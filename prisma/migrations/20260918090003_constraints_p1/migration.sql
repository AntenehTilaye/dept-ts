-- Hand-written. NULL department_id rows are faculty-wide seeds; NULLs are distinct in the
-- composite unique (department_id, key), so global role keys need their own uniqueness.
CREATE UNIQUE INDEX "role_key_global" ON "role" ("key") WHERE "department_id" IS NULL;
