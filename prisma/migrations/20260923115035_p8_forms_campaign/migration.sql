-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "kind" "campaign_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "form_definition_id" TEXT NOT NULL,
    "form_version" INTEGER NOT NULL,
    "term_id" TEXT NOT NULL,
    "window_anchor_json" JSONB NOT NULL,
    "resolved_opens_at" TIMESTAMP(3) NOT NULL,
    "resolved_closes_at" TIMESTAMP(3) NOT NULL,
    "anonymity_mode" "anonymity" NOT NULL DEFAULT 'identified',
    "submission_rule" "submission_rule" NOT NULL DEFAULT 'single',
    "audience_spec_json" JSONB NOT NULL,
    "audience_resolution_mode" "audience_mode" NOT NULL DEFAULT 'snapshot_at_publish',
    "subject_mode" "subject_mode" NOT NULL DEFAULT 'none',
    "invitation_template_key" TEXT NOT NULL DEFAULT 'campaign_invitation',
    "reminder_schedule_key" TEXT NOT NULL DEFAULT 'default_7_3_1_0_overdue',
    "aggregation_spec_json" JSONB,
    "export_spec_id" TEXT,
    "min_responses_for_report" INTEGER NOT NULL DEFAULT 5,
    "options_json" JSONB NOT NULL DEFAULT '{}',
    "feature_record_id" TEXT,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "aggregated_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_subject" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "subject_type" "campaign_subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "capacity" INTEGER,
    "evaluator_audience_spec_json" JSONB,
    "evaluator_group" "evaluator_group",

    CONSTRAINT "campaign_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_invitation" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "subject_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aggregation_result" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "subject_id" TEXT,
    "question_stable_key" TEXT NOT NULL,
    "group_by_key" TEXT NOT NULL DEFAULT '',
    "group_by_json" JSONB NOT NULL DEFAULT '{}',
    "n" INTEGER NOT NULL,
    "stats_json" JSONB NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aggregation_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_definition" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "form_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scoring_json" JSONB,
    "questions_hash" TEXT NOT NULL,
    "locked_paths_json" JSONB NOT NULL DEFAULT '[]',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "form_status" NOT NULL DEFAULT 'draft',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question" (
    "id" TEXT NOT NULL,
    "form_definition_id" TEXT NOT NULL,
    "stable_key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "label" TEXT NOT NULL,
    "help_text" TEXT,
    "options_json" JSONB,
    "source_binding" "source_binding" NOT NULL DEFAULT 'none',
    "binding_args_json" JSONB,
    "constraints_json" JSONB,
    "score_weight" DECIMAL(6,3),
    "aggregation" "aggregation" NOT NULL DEFAULT 'none',
    "parent_stable_key" TEXT,
    "computed_by" TEXT,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "form_definition_id" TEXT NOT NULL,
    "form_version" INTEGER NOT NULL,
    "campaign_id" TEXT,
    "campaign_subject_id" TEXT,
    "subject_type" "subject_type",
    "subject_id" TEXT,
    "step_key" TEXT,
    "respondent_person_id" TEXT,
    "invitation_id" TEXT,
    "respondent_group" "evaluator_group",
    "cohort_attributes_json" JSONB,
    "pseudonym_hash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "submission_status" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "question_stable_key" TEXT NOT NULL,
    "group_index" INTEGER NOT NULL DEFAULT 0,
    "value_json" JSONB NOT NULL,
    "numeric_value" DECIMAL(12,4),
    "rank" INTEGER,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "text_value" TEXT,

    CONSTRAINT "answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_feature_record_id_key" ON "campaign"("feature_record_id");

-- CreateIndex
CREATE INDEX "campaign_department_id_term_id_kind_idx" ON "campaign"("department_id", "term_id", "kind");

-- CreateIndex
CREATE INDEX "campaign_subject_department_id_idx" ON "campaign_subject"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_subject_campaign_id_subject_type_subject_id_evalua_key" ON "campaign_subject"("campaign_id", "subject_type", "subject_id", "evaluator_group");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invitation_token_hash_key" ON "campaign_invitation"("token_hash");

-- CreateIndex
CREATE INDEX "campaign_invitation_person_id_status_idx" ON "campaign_invitation"("person_id", "status");

-- CreateIndex
CREATE INDEX "campaign_invitation_department_id_idx" ON "campaign_invitation"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invitation_campaign_id_person_id_subject_id_key" ON "campaign_invitation"("campaign_id", "person_id", "subject_id");

-- CreateIndex
CREATE INDEX "aggregation_result_department_id_idx" ON "aggregation_result"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "aggregation_result_campaign_id_subject_id_question_stable_k_key" ON "aggregation_result"("campaign_id", "subject_id", "question_stable_key", "group_by_key");

-- CreateIndex
CREATE INDEX "form_definition_key_status_idx" ON "form_definition"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form_definition_department_id_key_version_key" ON "form_definition"("department_id", "key", "version");

-- CreateIndex
CREATE INDEX "question_form_definition_id_order_idx" ON "question"("form_definition_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "question_form_definition_id_stable_key_key" ON "question"("form_definition_id", "stable_key");

-- CreateIndex
CREATE INDEX "submission_campaign_id_campaign_subject_id_idx" ON "submission"("campaign_id", "campaign_subject_id");

-- CreateIndex
CREATE INDEX "submission_subject_type_subject_id_step_key_idx" ON "submission"("subject_type", "subject_id", "step_key");

-- CreateIndex
CREATE INDEX "submission_respondent_person_id_idx" ON "submission"("respondent_person_id");

-- CreateIndex
CREATE INDEX "submission_department_id_idx" ON "submission"("department_id");

-- CreateIndex
CREATE INDEX "answer_ref_type_ref_id_idx" ON "answer"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "answer_department_id_idx" ON "answer"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_submission_id_question_stable_key_group_index_key" ON "answer"("submission_id", "question_stable_key", "group_index");

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_form_definition_id_fkey" FOREIGN KEY ("form_definition_id") REFERENCES "form_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_subject" ADD CONSTRAINT "campaign_subject_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_subject" ADD CONSTRAINT "campaign_subject_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitation" ADD CONSTRAINT "campaign_invitation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitation" ADD CONSTRAINT "campaign_invitation_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitation" ADD CONSTRAINT "campaign_invitation_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invitation" ADD CONSTRAINT "campaign_invitation_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "campaign_subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregation_result" ADD CONSTRAINT "aggregation_result_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregation_result" ADD CONSTRAINT "aggregation_result_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregation_result" ADD CONSTRAINT "aggregation_result_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "campaign_subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_definition" ADD CONSTRAINT "form_definition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question" ADD CONSTRAINT "question_form_definition_id_fkey" FOREIGN KEY ("form_definition_id") REFERENCES "form_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_form_definition_id_fkey" FOREIGN KEY ("form_definition_id") REFERENCES "form_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_campaign_subject_id_fkey" FOREIGN KEY ("campaign_subject_id") REFERENCES "campaign_subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_respondent_person_id_fkey" FOREIGN KEY ("respondent_person_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer" ADD CONSTRAINT "answer_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer" ADD CONSTRAINT "answer_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=2a6d554e14a14715c752d8c2398cf61f407eda43111509c7f39d5e593a86f86f
-- tenant: AggregationResult
ALTER TABLE "aggregation_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aggregation_result" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "aggregation_result"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Answer
ALTER TABLE "answer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "answer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "answer"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Campaign
ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: CampaignInvitation
ALTER TABLE "campaign_invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign_invitation"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: CampaignSubject
ALTER TABLE "campaign_subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_subject" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign_subject"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: FormDefinition
ALTER TABLE "form_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_definition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "form_definition"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Submission
ALTER TABLE "submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "submission"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
