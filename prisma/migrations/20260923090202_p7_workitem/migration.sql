-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "task_kind" NOT NULL DEFAULT 'general',
    "priority" "priority" NOT NULL DEFAULT 'normal',
    "context_type" "subject_type",
    "context_id" TEXT,
    "parent_task_id" TEXT,
    "feature_record_id" TEXT,
    "feature_step_instance_id" TEXT,
    "created_by" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "deadline_anchor_json" JSONB,
    "expected_deliverables_json" JSONB NOT NULL DEFAULT '[]',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "recurrence_rule_id" TEXT,
    "reminder_schedule_key" TEXT,
    "completed_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignment" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "assignee_type" "assignee_type" NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "role" "assignment_role" NOT NULL DEFAULT 'responsible',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_audience_spec_json" JSONB,

    CONSTRAINT "task_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rule" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "frequency" "frequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "by_weekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "by_month_day" INTEGER,
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3),
    "count" INTEGER,
    "spawned_count" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "next_spawn_at" TIMESTAMP(3),
    "template_task_id" TEXT,

    CONSTRAINT "recurrence_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case" (
    "task_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "requester_person_id" TEXT,
    "origin_type" "subject_type",
    "origin_id" TEXT,
    "section_id" TEXT,
    "issue" TEXT NOT NULL,
    "issue_category" TEXT,
    "required_action" TEXT,
    "waiting_on" TEXT,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "case_pkey" PRIMARY KEY ("task_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_feature_record_id_key" ON "task"("feature_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_feature_step_instance_id_key" ON "task"("feature_step_instance_id");

-- CreateIndex
CREATE INDEX "task_department_id_kind_due_at_idx" ON "task"("department_id", "kind", "due_at");

-- CreateIndex
CREATE INDEX "task_context_type_context_id_idx" ON "task"("context_type", "context_id");

-- CreateIndex
CREATE INDEX "task_department_id_created_by_idx" ON "task"("department_id", "created_by");

-- CreateIndex
CREATE INDEX "task_assignment_assignee_type_assignee_id_idx" ON "task_assignment"("assignee_type", "assignee_id");

-- CreateIndex
CREATE INDEX "task_assignment_department_id_idx" ON "task_assignment"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignment_task_id_assignee_type_assignee_id_role_key" ON "task_assignment"("task_id", "assignee_type", "assignee_id", "role");

-- CreateIndex
CREATE INDEX "recurrence_rule_next_spawn_at_idx" ON "recurrence_rule"("next_spawn_at");

-- CreateIndex
CREATE INDEX "recurrence_rule_department_id_idx" ON "recurrence_rule"("department_id");

-- CreateIndex
CREATE INDEX "case_section_id_idx" ON "case"("section_id");

-- CreateIndex
CREATE INDEX "case_department_id_idx" ON "case"("department_id");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "recurrence_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_requester_person_id_fkey" FOREIGN KEY ("requester_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=b98c9e10b3e36231b7e7870a981a74ea81d344296bc61bc20b7196d18efa689f
-- tenant: Case
ALTER TABLE "case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: RecurrenceRule
ALTER TABLE "recurrence_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurrence_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recurrence_rule"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Task
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: TaskAssignment
ALTER TABLE "task_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_assignment"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
