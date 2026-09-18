-- CreateTable
CREATE TABLE "academic_year" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "quarter_boundaries_json" JSONB NOT NULL,
    "status" "year_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "ordinal" "term_ordinal" NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "term_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_period" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "kind" "period_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "credit_hours" DECIMAL(4,1) NOT NULL,
    "program_id" TEXT,
    "course_type" "course_type" NOT NULL,
    "predecessor_course_id" TEXT,
    "status" "course_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offering" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "coordinator_person_id" TEXT,
    "feature_record_id" TEXT,
    "decision_note" TEXT,
    "scheme_structure_locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_offering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_offering" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "course_offering_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "section_code" TEXT NOT NULL,
    "enrolled_count" INTEGER NOT NULL DEFAULT 0,
    "assessment_locked_at" TIMESTAMP(3),
    "assessment_locked_by_portfolio_id" TEXT,

    CONSTRAINT "section_offering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_assignment" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "section_offering_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" "teaching_role" NOT NULL,
    "load_hours" DECIMAL(5,2),
    "share_percent" INTEGER,
    "source" "assignment_source" NOT NULL,
    "import_batch_id" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),

    CONSTRAINT "teaching_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "section_offering_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "status" "enrollment_status" NOT NULL,
    "source" "enrollment_source" NOT NULL,
    "decided_in_campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_timetable_slot" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "section_offering_id" TEXT NOT NULL,
    "teaching_assignment_id" TEXT,
    "resource_id" TEXT,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "week_pattern" "week_pattern" NOT NULL DEFAULT 'all',
    "source" "row_source" NOT NULL,
    "import_batch_id" TEXT,

    CONSTRAINT "class_timetable_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "resource_kind" NOT NULL,
    "building" TEXT,
    "location" TEXT,
    "capacity" INTEGER,
    "responsible_person_id" TEXT,
    "computer_count" INTEGER,
    "software_list" TEXT[],
    "attributes_json" JSONB NOT NULL DEFAULT '{}',
    "status" "resource_status" NOT NULL DEFAULT 'available',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "type" "person_type" NOT NULL,
    "organization_name" TEXT,
    "role_label" TEXT,
    "status" "active_status" NOT NULL DEFAULT 'active',
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_person" (
    "department_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "department_person_pkey" PRIMARY KEY ("department_id","person_id")
);

-- CreateTable
CREATE TABLE "staff_profile" (
    "person_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "academic_rank" TEXT,
    "employment_type" TEXT,
    "specialization" TEXT,
    "academic_interests" TEXT[],
    "office_location" TEXT,
    "office_hours_text" TEXT,
    "joined_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profile_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "profile_item" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" "profile_item_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "institution_or_venue" TEXT,
    "date_from" DATE,
    "date_to" DATE,
    "details_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "person_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "student_number" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "admission_year" INTEGER NOT NULL,
    "status" "student_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "program" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "degree_level" TEXT NOT NULL,
    "duration_years" INTEGER NOT NULL,
    "grade_scale_key" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "year_level" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER,
    "group_id" TEXT NOT NULL,

    CONSTRAINT "section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_section_membership" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "source" "row_source" NOT NULL DEFAULT 'manual',

    CONSTRAINT "student_section_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_representative" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "is_primary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "section_representative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "kind" "group_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "context_type" "subject_type",
    "context_id" TEXT,
    "status" "active_status" NOT NULL DEFAULT 'active',
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_membership" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role_in_group" "group_role" NOT NULL DEFAULT 'member',
    "responsibilities" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),

    CONSTRAINT "group_membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_year_department_id_code_key" ON "academic_year"("department_id", "code");

-- CreateIndex
CREATE INDEX "term_department_id_status_idx" ON "term"("department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "term_academic_year_id_ordinal_key" ON "term"("academic_year_id", "ordinal");

-- CreateIndex
CREATE INDEX "calendar_period_term_id_kind_idx" ON "calendar_period"("term_id", "kind");

-- CreateIndex
CREATE INDEX "calendar_period_department_id_idx" ON "calendar_period"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_department_id_code_key" ON "course"("department_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "course_offering_feature_record_id_key" ON "course_offering"("feature_record_id");

-- CreateIndex
CREATE INDEX "course_offering_term_id_idx" ON "course_offering"("term_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_offering_course_id_term_id_key" ON "course_offering"("course_id", "term_id");

-- CreateIndex
CREATE INDEX "section_offering_section_id_idx" ON "section_offering"("section_id");

-- CreateIndex
CREATE INDEX "section_offering_department_id_idx" ON "section_offering"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_offering_course_offering_id_section_id_key" ON "section_offering"("course_offering_id", "section_id");

-- CreateIndex
CREATE INDEX "teaching_assignment_person_id_valid_to_idx" ON "teaching_assignment"("person_id", "valid_to");

-- CreateIndex
CREATE INDEX "teaching_assignment_department_id_idx" ON "teaching_assignment"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_assignment_section_offering_id_person_id_role_vali_key" ON "teaching_assignment"("section_offering_id", "person_id", "role", "valid_from");

-- CreateIndex
CREATE INDEX "enrollment_student_id_idx" ON "enrollment"("student_id");

-- CreateIndex
CREATE INDEX "enrollment_department_id_idx" ON "enrollment"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_section_offering_id_student_id_key" ON "enrollment"("section_offering_id", "student_id");

-- CreateIndex
CREATE INDEX "class_timetable_slot_term_id_section_offering_id_idx" ON "class_timetable_slot"("term_id", "section_offering_id");

-- CreateIndex
CREATE INDEX "class_timetable_slot_resource_id_weekday_idx" ON "class_timetable_slot"("resource_id", "weekday");

-- CreateIndex
CREATE INDEX "class_timetable_slot_department_id_idx" ON "class_timetable_slot"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_department_id_code_key" ON "resource"("department_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "person_user_id_key" ON "person"("user_id");

-- CreateIndex
CREATE INDEX "person_email_idx" ON "person"("email");

-- CreateIndex
CREATE INDEX "person_full_name_idx" ON "person"("full_name");

-- CreateIndex
CREATE INDEX "department_person_person_id_idx" ON "department_person"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_department_id_staff_id_key" ON "staff_profile"("department_id", "staff_id");

-- CreateIndex
CREATE INDEX "profile_item_person_id_kind_idx" ON "profile_item"("person_id", "kind");

-- CreateIndex
CREATE INDEX "profile_item_department_id_idx" ON "profile_item"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_department_id_student_number_key" ON "student"("department_id", "student_number");

-- CreateIndex
CREATE UNIQUE INDEX "program_department_id_code_key" ON "program"("department_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "section_group_id_key" ON "section"("group_id");

-- CreateIndex
CREATE INDEX "section_department_id_idx" ON "section"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_program_id_academic_year_id_code_key" ON "section"("program_id", "academic_year_id", "code");

-- CreateIndex
CREATE INDEX "student_section_membership_section_id_valid_to_idx" ON "student_section_membership"("section_id", "valid_to");

-- CreateIndex
CREATE INDEX "student_section_membership_department_id_idx" ON "student_section_membership"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_section_membership_student_id_academic_year_id_vali_key" ON "student_section_membership"("student_id", "academic_year_id", "valid_from");

-- CreateIndex
CREATE INDEX "section_representative_section_id_academic_year_id_idx" ON "section_representative"("section_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "section_representative_student_id_idx" ON "section_representative"("student_id");

-- CreateIndex
CREATE INDEX "section_representative_department_id_idx" ON "section_representative"("department_id");

-- CreateIndex
CREATE INDEX "group_department_id_kind_status_idx" ON "group"("department_id", "kind", "status");

-- CreateIndex
CREATE INDEX "group_context_type_context_id_idx" ON "group"("context_type", "context_id");

-- CreateIndex
CREATE INDEX "group_membership_person_id_valid_to_idx" ON "group_membership"("person_id", "valid_to");

-- CreateIndex
CREATE INDEX "group_membership_department_id_idx" ON "group_membership"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_membership_group_id_person_id_valid_from_key" ON "group_membership"("group_id", "person_id", "valid_from");

-- AddForeignKey
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_period" ADD CONSTRAINT "calendar_period_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_period" ADD CONSTRAINT "calendar_period_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_predecessor_course_id_fkey" FOREIGN KEY ("predecessor_course_id") REFERENCES "course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_coordinator_person_id_fkey" FOREIGN KEY ("coordinator_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_offering" ADD CONSTRAINT "section_offering_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_offering" ADD CONSTRAINT "section_offering_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_offering" ADD CONSTRAINT "section_offering_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timetable_slot" ADD CONSTRAINT "class_timetable_slot_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timetable_slot" ADD CONSTRAINT "class_timetable_slot_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timetable_slot" ADD CONSTRAINT "class_timetable_slot_section_offering_id_fkey" FOREIGN KEY ("section_offering_id") REFERENCES "section_offering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timetable_slot" ADD CONSTRAINT "class_timetable_slot_teaching_assignment_id_fkey" FOREIGN KEY ("teaching_assignment_id") REFERENCES "teaching_assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timetable_slot" ADD CONSTRAINT "class_timetable_slot_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource" ADD CONSTRAINT "resource_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource" ADD CONSTRAINT "resource_responsible_person_id_fkey" FOREIGN KEY ("responsible_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_person" ADD CONSTRAINT "department_person_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_person" ADD CONSTRAINT "department_person_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_item" ADD CONSTRAINT "profile_item_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_item" ADD CONSTRAINT "profile_item_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section" ADD CONSTRAINT "section_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section" ADD CONSTRAINT "section_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section" ADD CONSTRAINT "section_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section" ADD CONSTRAINT "section_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_section_membership" ADD CONSTRAINT "student_section_membership_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_section_membership" ADD CONSTRAINT "student_section_membership_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_section_membership" ADD CONSTRAINT "student_section_membership_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_section_membership" ADD CONSTRAINT "student_section_membership_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_representative" ADD CONSTRAINT "section_representative_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_representative" ADD CONSTRAINT "section_representative_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_representative" ADD CONSTRAINT "section_representative_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("person_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_representative" ADD CONSTRAINT "section_representative_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group" ADD CONSTRAINT "group_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=4ae06ef4c67703b797b106198df0878d80a576dc55a9081b435071ff9fb514f2
-- tenant: AcademicYear
ALTER TABLE "academic_year" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_year" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "academic_year"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: CalendarPeriod
ALTER TABLE "calendar_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_period" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_period"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: ClassTimetableSlot
ALTER TABLE "class_timetable_slot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_timetable_slot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "class_timetable_slot"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Course
ALTER TABLE "course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "course"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: CourseOffering
ALTER TABLE "course_offering" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_offering" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "course_offering"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: DepartmentPerson
ALTER TABLE "department_person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "department_person" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "department_person"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Enrollment
ALTER TABLE "enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "enrollment"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Group
ALTER TABLE "group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "group"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: GroupMembership
ALTER TABLE "group_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "group_membership"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: ProfileItem
ALTER TABLE "profile_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "profile_item"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Program
ALTER TABLE "program" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "program" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "program"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Resource
ALTER TABLE "resource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "resource"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Section
ALTER TABLE "section" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "section" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "section"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: SectionOffering
ALTER TABLE "section_offering" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "section_offering" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "section_offering"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: SectionRepresentative
ALTER TABLE "section_representative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "section_representative" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "section_representative"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: StaffProfile
ALTER TABLE "staff_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_profile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_profile"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Student
ALTER TABLE "student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: StudentSectionMembership
ALTER TABLE "student_section_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_section_membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student_section_membership"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: TeachingAssignment
ALTER TABLE "teaching_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teaching_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "teaching_assignment"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Term
ALTER TABLE "term" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "term" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "term"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
