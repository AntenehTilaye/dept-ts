-- CreateTable
CREATE TABLE "assessment_scheme" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "section_offering_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_component" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "scheme_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_mark" DECIMAL(6,2) NOT NULL,
    "weight_percent" DECIMAL(5,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "offering_component_id" TEXT,
    "excluded_from_consolidation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_record" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "section_offering_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "mark" DECIMAL(6,2),
    "is_missing" BOOLEAN NOT NULL DEFAULT false,
    "import_batch_id" TEXT NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_attendance_summary" (
    "section_offering_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "sessions_held" INTEGER NOT NULL,
    "sessions_attended" INTEGER NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_attendance_summary_pkey" PRIMARY KEY ("section_offering_id","student_id")
);

-- CreateTable
CREATE TABLE "student_course_result" (
    "section_offering_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "total" DECIMAL(6,2) NOT NULL,
    "letter_grade" TEXT NOT NULL,
    "outcome" "outcome" NOT NULL,
    "grade_scale_key" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "source_import_batch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_course_result_pkey" PRIMARY KEY ("section_offering_id","student_id")
);

-- CreateTable
CREATE TABLE "course_metrics_snapshot" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "section_offering_id" TEXT,
    "term_id" TEXT NOT NULL,
    "average_mark" DECIMAL(6,2),
    "pass_rate" DECIMAL(5,4),
    "fail_rate" DECIMAL(5,4),
    "grade_distribution_json" JSONB NOT NULL,
    "component_stats_json" JSONB NOT NULL,
    "completion_rate" DECIMAL(5,4),
    "attendance_rate" DECIMAL(5,4),
    "student_count" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "source_hash" TEXT NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_metrics_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_scheme_department_id_idx" ON "assessment_scheme"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_scheme_course_offering_id_section_offering_id_key" ON "assessment_scheme"("course_offering_id", "section_offering_id");

-- CreateIndex
CREATE INDEX "assessment_component_department_id_idx" ON "assessment_component"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_component_scheme_id_key_key" ON "assessment_component"("scheme_id", "key");

-- CreateIndex
CREATE INDEX "assessment_record_import_batch_id_idx" ON "assessment_record"("import_batch_id");

-- CreateIndex
CREATE INDEX "assessment_record_department_id_idx" ON "assessment_record"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_record_section_offering_id_student_id_component__key" ON "assessment_record"("section_offering_id", "student_id", "component_id");

-- CreateIndex
CREATE INDEX "student_attendance_summary_department_id_idx" ON "student_attendance_summary"("department_id");

-- CreateIndex
CREATE INDEX "student_course_result_department_id_idx" ON "student_course_result"("department_id");

-- CreateIndex
CREATE INDEX "course_metrics_snapshot_course_offering_id_section_offering_idx" ON "course_metrics_snapshot"("course_offering_id", "section_offering_id", "computed_at");

-- CreateIndex
CREATE INDEX "course_metrics_snapshot_department_id_idx" ON "course_metrics_snapshot"("department_id");

-- AddForeignKey
ALTER TABLE "assessment_scheme" ADD CONSTRAINT "assessment_scheme_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_scheme" ADD CONSTRAINT "assessment_scheme_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_scheme" ADD CONSTRAINT "assessment_scheme_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "assessment_scheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_record" ADD CONSTRAINT "assessment_record_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_record" ADD CONSTRAINT "assessment_record_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_record" ADD CONSTRAINT "assessment_record_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_record" ADD CONSTRAINT "assessment_record_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "assessment_component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_record" ADD CONSTRAINT "assessment_record_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance_summary" ADD CONSTRAINT "student_attendance_summary_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance_summary" ADD CONSTRAINT "student_attendance_summary_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance_summary" ADD CONSTRAINT "student_attendance_summary_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance_summary" ADD CONSTRAINT "student_attendance_summary_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_course_result" ADD CONSTRAINT "student_course_result_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_course_result" ADD CONSTRAINT "student_course_result_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_course_result" ADD CONSTRAINT "student_course_result_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_metrics_snapshot" ADD CONSTRAINT "course_metrics_snapshot_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_metrics_snapshot" ADD CONSTRAINT "course_metrics_snapshot_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_metrics_snapshot" ADD CONSTRAINT "course_metrics_snapshot_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_metrics_snapshot" ADD CONSTRAINT "course_metrics_snapshot_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=ffeecc9175aa6976cc09658d39a39252e04089d3d1ed3dec3bb17219bff1baf5
-- tenant: AssessmentComponent
ALTER TABLE "assessment_component" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_component" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assessment_component"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: AssessmentRecord
ALTER TABLE "assessment_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assessment_record"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: AssessmentScheme
ALTER TABLE "assessment_scheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_scheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assessment_scheme"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: CourseMetricsSnapshot
ALTER TABLE "course_metrics_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_metrics_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "course_metrics_snapshot"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: StudentAttendanceSummary
ALTER TABLE "student_attendance_summary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_attendance_summary" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student_attendance_summary"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: StudentCourseResult
ALTER TABLE "student_course_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_course_result" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student_course_result"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- A snapshot the department has reported on is the number it published: once frozen, nothing
-- may change it. `raise_immutable()` ships with the append_only migration.
CREATE TRIGGER course_metrics_snapshot_frozen
  BEFORE UPDATE ON "course_metrics_snapshot"
  FOR EACH ROW WHEN (OLD.frozen)
  EXECUTE FUNCTION raise_immutable();
