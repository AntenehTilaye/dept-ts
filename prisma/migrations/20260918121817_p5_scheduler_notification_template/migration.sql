-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "recipient_person_id" TEXT NOT NULL,
    "category" "notification_category" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "subject_type" "subject_type",
    "subject_id" TEXT,
    "template_key" TEXT,
    "ack_required" BOOLEAN NOT NULL DEFAULT false,
    "declinable" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "read_at" TIMESTAMP(3),
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_ref" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" "notification_category",
    "channel" "channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest" "digest" NOT NULL DEFAULT 'immediate',
    "quiet_hours_json" JSONB,

    CONSTRAINT "channel_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_schedule" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "offsets_json" JSONB NOT NULL,
    "repeat_every_days" INTEGER,
    "escalation_json" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_subscription" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "kind" "reminder_kind" NOT NULL,
    "deadline_spec_json" JSONB NOT NULL,
    "resolved_deadline_at" TIMESTAMP(3),
    "schedule_key" TEXT NOT NULL,
    "audience_spec_json" JSONB NOT NULL,
    "variables_json" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_job" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "kind" "job_kind" NOT NULL,
    "queue" TEXT NOT NULL,
    "subject_type" "subject_type",
    "subject_id" TEXT,
    "run_at" TIMESTAMP(3) NOT NULL,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'scheduled',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "pg_boss_job_id" TEXT,
    "singleton_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "kind" "template_kind" NOT NULL,
    "context_type" "subject_type",
    "active_version" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_version" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel_variants_json" JSONB NOT NULL,
    "declared_variables_json" JSONB NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mustache',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" "version_status" NOT NULL DEFAULT 'draft',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupe_key_key" ON "notification"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_recipient_person_id_read_at_created_at_idx" ON "notification"("recipient_person_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_subject_type_subject_id_ack_required_idx" ON "notification"("subject_type", "subject_id", "ack_required");

-- CreateIndex
CREATE INDEX "notification_department_id_idx" ON "notification"("department_id");

-- CreateIndex
CREATE INDEX "notification_delivery_status_idx" ON "notification_delivery"("status");

-- CreateIndex
CREATE INDEX "notification_delivery_department_id_idx" ON "notification_delivery"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_notification_id_channel_key" ON "notification_delivery"("notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "channel_preference_user_id_category_channel_key" ON "channel_preference"("user_id", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_schedule_department_id_key_key" ON "reminder_schedule"("department_id", "key");

-- CreateIndex
CREATE INDEX "reminder_subscription_resolved_deadline_at_active_idx" ON "reminder_subscription"("resolved_deadline_at", "active");

-- CreateIndex
CREATE INDEX "reminder_subscription_subject_type_subject_id_idx" ON "reminder_subscription"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "reminder_subscription_department_id_idx" ON "reminder_subscription"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_job_idempotency_key_key" ON "scheduled_job"("idempotency_key");

-- CreateIndex
CREATE INDEX "scheduled_job_status_run_at_idx" ON "scheduled_job"("status", "run_at");

-- CreateIndex
CREATE INDEX "scheduled_job_kind_run_at_idx" ON "scheduled_job"("kind", "run_at");

-- CreateIndex
CREATE INDEX "scheduled_job_department_id_idx" ON "scheduled_job"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_department_id_key_key" ON "template"("department_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "template_version_template_id_version_key" ON "template_version"("template_id", "version");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_person_id_fkey" FOREIGN KEY ("recipient_person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_subscription" ADD CONSTRAINT "reminder_subscription_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_job" ADD CONSTRAINT "scheduled_job_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=96580bae72fdfab601606b32e88f19227062494f6d02e615b0179a135d28ceac
-- tenant: Notification
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: NotificationDelivery
ALTER TABLE "notification_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_delivery"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: ReminderSchedule
ALTER TABLE "reminder_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_schedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_schedule"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: ReminderSubscription
ALTER TABLE "reminder_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_subscription"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: ScheduledJob
ALTER TABLE "scheduled_job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_job" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scheduled_job"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: Template
ALTER TABLE "template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "template" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "template"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
