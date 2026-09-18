-- CreateIndex
CREATE INDEX "course_offering_department_id_idx" ON "course_offering"("department_id");
-- The trigram index is declared in the Prisma schema from here on (so `migrate dev` never diffs it away);
-- constraints_p3 already created it on databases migrated before this migration.
CREATE INDEX IF NOT EXISTS "person_full_name_trgm" ON "person" USING gin ("full_name" public.gin_trgm_ops);
