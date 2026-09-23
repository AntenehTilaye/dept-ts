-- CreateTable
CREATE TABLE "feature_definition" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL,
    "nav_group" TEXT NOT NULL,
    "nav_order" INTEGER NOT NULL,
    "scope_level" "scope_type" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active_version_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_definition_version" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "feature_version_status" NOT NULL DEFAULT 'draft',
    "json" JSONB NOT NULL,
    "compiled_json" JSONB,
    "json_hash" TEXT NOT NULL,
    "locked_hash" TEXT NOT NULL,
    "change_note" TEXT,
    "workflow_definition_id" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_definition_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_record" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "definition_version_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "preset_key" TEXT,
    "parent_subject_type" "subject_type",
    "parent_subject_id" TEXT,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" TEXT,
    "owner_person_id" TEXT NOT NULL,
    "created_by_person_id" TEXT NOT NULL,
    "workflow_instance_id" TEXT NOT NULL,
    "current_state_key" TEXT NOT NULL,
    "branch_states_cache" JSONB,
    "deadline_at" TIMESTAMP(3),
    "first_edited_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "task_id" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_step_instance" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "step_key" TEXT NOT NULL,
    "group_key" TEXT,
    "branch_key" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" "feature_step_status" NOT NULL DEFAULT 'active',
    "assignee_type" "assignee_type",
    "assignee_id" TEXT,
    "task_id" TEXT,
    "submission_id" TEXT,
    "deadline_at" TIMESTAMP(3),
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "completed_by_person_id" TEXT,
    "outcome_action_key" TEXT,

    CONSTRAINT "feature_step_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_number_sequence" (
    "department_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "feature_number_sequence_pkey" PRIMARY KEY ("department_id","definition_id","year")
);

-- CreateTable
CREATE TABLE "feature_migration" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "from_version_id" TEXT NOT NULL,
    "to_version_id" TEXT NOT NULL,
    "state_map" JSONB NOT NULL,
    "step_map" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "status" "feature_migration_status" NOT NULL DEFAULT 'planned',
    "records_total" INTEGER NOT NULL DEFAULT 0,
    "records_migrated" INTEGER NOT NULL DEFAULT 0,
    "records_blocked" INTEGER NOT NULL DEFAULT 0,
    "blocked_ids" JSONB,
    "pg_boss_job_id" TEXT,
    "started_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "feature_migration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adapter_registration" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "hook" "adapter_hook" NOT NULL,
    "description" TEXT NOT NULL,
    "simulable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "registered_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adapter_registration_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_definition_active_version_id_key" ON "feature_definition"("active_version_id");

-- CreateIndex
CREATE INDEX "feature_definition_department_id_nav_group_nav_order_idx" ON "feature_definition"("department_id", "nav_group", "nav_order");

-- CreateIndex
CREATE UNIQUE INDEX "feature_definition_key_department_id_key" ON "feature_definition"("key", "department_id");

-- CreateIndex
CREATE INDEX "feature_definition_version_definition_id_status_idx" ON "feature_definition_version"("definition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "feature_definition_version_definition_id_version_key" ON "feature_definition_version"("definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "feature_record_workflow_instance_id_key" ON "feature_record"("workflow_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_record_task_id_key" ON "feature_record"("task_id");

-- CreateIndex
CREATE INDEX "feature_record_department_id_definition_id_current_state_ke_idx" ON "feature_record"("department_id", "definition_id", "current_state_key");

-- CreateIndex
CREATE INDEX "feature_record_parent_subject_type_parent_subject_id_idx" ON "feature_record"("parent_subject_type", "parent_subject_id");

-- CreateIndex
CREATE INDEX "feature_record_department_id_owner_person_id_idx" ON "feature_record"("department_id", "owner_person_id");

-- CreateIndex
CREATE INDEX "feature_record_department_id_deadline_at_idx" ON "feature_record"("department_id", "deadline_at");

-- CreateIndex
CREATE INDEX "feature_record_data_idx" ON "feature_record" USING GIN ("data" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "feature_record_department_id_number_key" ON "feature_record"("department_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "feature_step_instance_task_id_key" ON "feature_step_instance"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_step_instance_submission_id_key" ON "feature_step_instance"("submission_id");

-- CreateIndex
CREATE INDEX "feature_step_instance_department_id_assignee_type_assignee__idx" ON "feature_step_instance"("department_id", "assignee_type", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "feature_step_instance_department_id_status_deadline_at_idx" ON "feature_step_instance"("department_id", "status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "feature_step_instance_record_id_step_key_branch_key_sequenc_key" ON "feature_step_instance"("record_id", "step_key", "branch_key", "sequence");

-- CreateIndex
CREATE INDEX "feature_migration_department_id_definition_id_status_idx" ON "feature_migration"("department_id", "definition_id", "status");

-- AddForeignKey
ALTER TABLE "feature_definition" ADD CONSTRAINT "feature_definition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_definition" ADD CONSTRAINT "feature_definition_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "feature_definition_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_definition_version" ADD CONSTRAINT "feature_definition_version_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "feature_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_definition_version" ADD CONSTRAINT "feature_definition_version_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_record" ADD CONSTRAINT "feature_record_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_record" ADD CONSTRAINT "feature_record_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "feature_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_record" ADD CONSTRAINT "feature_record_definition_version_id_fkey" FOREIGN KEY ("definition_version_id") REFERENCES "feature_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_record" ADD CONSTRAINT "feature_record_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_record" ADD CONSTRAINT "feature_record_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_step_instance" ADD CONSTRAINT "feature_step_instance_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_step_instance" ADD CONSTRAINT "feature_step_instance_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "feature_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_step_instance" ADD CONSTRAINT "feature_step_instance_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_number_sequence" ADD CONSTRAINT "feature_number_sequence_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_migration" ADD CONSTRAINT "feature_migration_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_migration" ADD CONSTRAINT "feature_migration_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "feature_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_migration" ADD CONSTRAINT "feature_migration_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "feature_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_migration" ADD CONSTRAINT "feature_migration_to_version_id_fkey" FOREIGN KEY ("to_version_id") REFERENCES "feature_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=d658afd24834992c8c490bafc0fe86c2830ab32ee34aa82145776e93c5ccbd08
-- shared: FeatureDefinition
ALTER TABLE "feature_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_definition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feature_definition"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: FeatureMigration
ALTER TABLE "feature_migration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_migration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feature_migration"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: FeatureNumberSequence
ALTER TABLE "feature_number_sequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_number_sequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feature_number_sequence"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: FeatureRecord
ALTER TABLE "feature_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feature_record"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: FeatureStepInstance
ALTER TABLE "feature_step_instance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_step_instance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feature_step_instance"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
