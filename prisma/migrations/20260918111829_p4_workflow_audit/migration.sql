-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "actor_user_id" TEXT,
    "action" "audit_action" NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "field_changes_json" JSONB,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,
    "client_info_json" JSONB,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "aggregate_type" "subject_type" NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "dead_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "correlation_id" TEXT,

    CONSTRAINT "domain_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_handler_receipt" (
    "event_id" TEXT NOT NULL,
    "handler_key" TEXT NOT NULL,
    "handled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "event_handler_receipt_pkey" PRIMARY KEY ("event_id","handler_key")
);

-- CreateTable
CREATE TABLE "workflow_definition" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "initial_state" TEXT NOT NULL,
    "states_json" JSONB NOT NULL,
    "transitions_json" JSONB NOT NULL,
    "locked_paths_json" JSONB NOT NULL DEFAULT '[]',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "version_status" NOT NULL DEFAULT 'draft',
    "feature_version_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "definition_key" TEXT NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "current_state" TEXT NOT NULL,
    "branch_states" JSONB,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transition_log" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "transition_key" TEXT NOT NULL,
    "branch_key" TEXT,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "comment" TEXT,
    "payload_json" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transition_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_event_subject_type_subject_id_at_idx" ON "audit_event"("subject_type", "subject_id", "at");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_at_idx" ON "audit_event"("actor_user_id", "at");

-- CreateIndex
CREATE INDEX "audit_event_department_id_at_idx" ON "audit_event"("department_id", "at");

-- CreateIndex
CREATE INDEX "domain_event_published_at_id_idx" ON "domain_event"("published_at", "id");

-- CreateIndex
CREATE INDEX "domain_event_aggregate_type_aggregate_id_idx" ON "domain_event"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "domain_event_department_id_idx" ON "domain_event"("department_id");

-- CreateIndex
CREATE INDEX "workflow_definition_key_status_idx" ON "workflow_definition"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definition_department_id_key_version_key" ON "workflow_definition"("department_id", "key", "version");

-- CreateIndex
CREATE INDEX "workflow_instance_department_id_definition_key_current_stat_idx" ON "workflow_instance"("department_id", "definition_key", "current_state");

-- CreateIndex
CREATE INDEX "workflow_instance_due_at_idx" ON "workflow_instance"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instance_subject_type_subject_id_definition_key_key" ON "workflow_instance"("subject_type", "subject_id", "definition_key");

-- CreateIndex
CREATE INDEX "workflow_transition_log_instance_id_at_idx" ON "workflow_transition_log"("instance_id", "at");

-- CreateIndex
CREATE INDEX "workflow_transition_log_department_id_idx" ON "workflow_transition_log"("department_id");

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_event" ADD CONSTRAINT "domain_event_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_handler_receipt" ADD CONSTRAINT "event_handler_receipt_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "domain_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition_log" ADD CONSTRAINT "workflow_transition_log_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition_log" ADD CONSTRAINT "workflow_transition_log_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=0c1f91135d5044ed1e289fa97e0732512e1b0a152dfa23f63cd10db457a57002
-- shared: AuditEvent
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_event"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: DomainEvent
ALTER TABLE "domain_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_event"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: WorkflowDefinition
ALTER TABLE "workflow_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_definition"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: WorkflowInstance
ALTER TABLE "workflow_instance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_instance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_instance"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: WorkflowTransitionLog
ALTER TABLE "workflow_transition_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_transition_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_transition_log"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
