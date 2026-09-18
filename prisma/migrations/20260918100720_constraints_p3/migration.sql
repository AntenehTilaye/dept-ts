-- Hand-written constraints for the people/academic registry (design part 04 §22).
-- One open primary representative per section and academic year.
CREATE UNIQUE INDEX "section_rep_primary" ON "section_representative" ("section_id", "academic_year_id")
  WHERE "is_primary" AND "valid_to" IS NULL;
-- Trigram index behind the people directory search (pg_trgm from the extensions migration).
CREATE INDEX "person_full_name_trgm" ON "person" USING gin ("full_name" public.gin_trgm_ops);
-- Tenant guards that Prisma cannot express: the grant identity and the timetable clock format.
ALTER TABLE "class_timetable_slot"
  ADD CONSTRAINT "class_timetable_slot_time_check"
  CHECK ("start_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "end_time" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "start_time" < "end_time"),
  ADD CONSTRAINT "class_timetable_slot_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7);
