-- CreateEnum
CREATE TYPE "subject_type" AS ENUM ('department', 'person', 'staff_profile', 'student', 'program', 'section', 'group', 'group_membership', 'section_representative', 'student_section_membership', 'academic_year', 'term', 'calendar_period', 'course', 'course_offering', 'section_offering', 'teaching_assignment', 'enrollment', 'resource', 'asset', 'maintenance_record', 'committee', 'committee_report', 'task', 'meeting', 'appointment', 'case', 'annual_plan', 'planned_activity', 'quarterly_report', 'portfolio', 'cqi_report', 'campaign', 'campaign_subject', 'campaign_invitation', 'submission', 'form_definition', 'thread', 'comment', 'announcement', 'document', 'template', 'exam_schedule', 'exam_session', 'lab_schedule', 'lab_session', 'duty_assignment', 'import_batch', 'load_cycle', 'availability_policy', 'availability_block', 'workflow_instance', 'notification', 'user', 'feature_definition', 'feature_record', 'feature_step_instance', 'report', 'generated_report');

-- CreateEnum
CREATE TYPE "person_type" AS ENUM ('staff', 'student', 'external');

-- CreateEnum
CREATE TYPE "active_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('active', 'graduated', 'withdrawn');

-- CreateEnum
CREATE TYPE "group_kind" AS ENUM ('committee', 'section', 'meeting', 'panel', 'lab_team', 'adhoc');

-- CreateEnum
CREATE TYPE "group_role" AS ENUM ('chair', 'secretary', 'member', 'lead', 'ra', 'attendee');

-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('global', 'department', 'committee', 'section', 'program', 'section_offering', 'lab_schedule', 'meeting', 'feature_record');

-- CreateEnum
CREATE TYPE "permission_level" AS ENUM ('full', 'manage', 'review', 'own', 'assigned', 'participate', 'limited', 'view', 'submit', 'none');

-- CreateEnum
CREATE TYPE "grant_source" AS ENUM ('manual', 'derived');

-- CreateEnum
CREATE TYPE "profile_item_kind" AS ENUM ('qualification', 'publication', 'research_activity', 'training', 'certification', 'work_experience', 'responsibility');

-- CreateEnum
CREATE TYPE "year_status" AS ENUM ('planned', 'active', 'closed');

-- CreateEnum
CREATE TYPE "term_ordinal" AS ENUM ('first', 'second', 'summer');

-- CreateEnum
CREATE TYPE "term_status" AS ENUM ('planned', 'current', 'closed');

-- CreateEnum
CREATE TYPE "period_kind" AS ENUM ('registration', 'add_drop', 'course_preference', 'elective_selection', 'teaching', 'examination', 'portfolio_submission', 'evaluation', 'custom');

-- CreateEnum
CREATE TYPE "course_type" AS ENUM ('core', 'elective', 'common');

-- CreateEnum
CREATE TYPE "course_status" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "teaching_role" AS ENUM ('lecture', 'lab', 'tutorial', 'coordinator');

-- CreateEnum
CREATE TYPE "assignment_source" AS ENUM ('manual', 'load_import', 'preference_review');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('enrolled', 'added', 'dropped', 'withdrawn');

-- CreateEnum
CREATE TYPE "enrollment_source" AS ENUM ('import', 'add_drop_decision', 'manual');

-- CreateEnum
CREATE TYPE "week_pattern" AS ENUM ('all', 'odd', 'even');

-- CreateEnum
CREATE TYPE "row_source" AS ENUM ('import', 'manual');

-- CreateEnum
CREATE TYPE "resource_kind" AS ENUM ('classroom', 'computer_lab', 'meeting_room', 'office', 'exam_hall', 'other');

-- CreateEnum
CREATE TYPE "resource_status" AS ENUM ('available', 'maintenance', 'retired');

-- CreateEnum
CREATE TYPE "asset_category" AS ENUM ('computer', 'projector', 'networking', 'software_license', 'furniture', 'equipment', 'other');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('in_use', 'spare', 'repair', 'retired');

-- CreateEnum
CREATE TYPE "task_kind" AS ENUM ('general', 'committee_task', 'department_task', 'instructor_task', 'student_activity', 'administrative', 'action_item', 'case', 'student_issue', 'planned_activity', 'cqi_action', 'maintenance', 'lab_activity', 'feature_step');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "assignee_type" AS ENUM ('person', 'group');

-- CreateEnum
CREATE TYPE "assignment_role" AS ENUM ('responsible', 'contributor', 'reviewer');

-- CreateEnum
CREATE TYPE "frequency" AS ENUM ('daily', 'weekly', 'monthly', 'termly', 'yearly');

-- CreateEnum
CREATE TYPE "form_kind" AS ENUM ('evaluation', 'add_drop', 'elective', 'preference', 'survey', 'issue', 'committee_report', 'portfolio_narrative', 'cqi_narrative', 'quarterly_narrative', 'activity_progress', 'appointment_request', 'feature_step', 'generic');

-- CreateEnum
CREATE TYPE "form_status" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('short_text', 'long_text', 'number', 'date', 'datetime', 'boolean', 'single_choice', 'multi_choice', 'likert', 'scale', 'person_picker', 'group_picker', 'course_picker', 'offering_picker', 'section_picker', 'term_picker', 'resource_picker', 'task_picker', 'record_picker', 'audience_picker', 'ranked_list', 'file', 'repeating_group', 'section_header', 'computed');

-- CreateEnum
CREATE TYPE "source_binding" AS ENUM ('offerings_in_term', 'courses_in_program', 'electives_in_campaign', 'own_enrollments', 'staff_in_department', 'tasks_in_context', 'members_of_parent', 'prior_cqi_items', 'resources_of_kind', 'records_of_feature', 'participants_of_parent', 'none');

-- CreateEnum
CREATE TYPE "aggregation" AS ENUM ('mean', 'distribution', 'count', 'rank_sum', 'top_n', 'none');

-- CreateEnum
CREATE TYPE "campaign_kind" AS ENUM ('evaluation', 'add_drop', 'elective', 'preference', 'survey');

-- CreateEnum
CREATE TYPE "anonymity" AS ENUM ('identified', 'anonymous', 'pseudonymous');

-- CreateEnum
CREATE TYPE "submission_rule" AS ENUM ('single', 'editable_until_close', 'multiple');

-- CreateEnum
CREATE TYPE "audience_mode" AS ENUM ('snapshot_at_publish', 'live');

-- CreateEnum
CREATE TYPE "subject_mode" AS ENUM ('none', 'per_subject');

-- CreateEnum
CREATE TYPE "campaign_subject_type" AS ENUM ('person', 'course', 'course_offering', 'section_offering', 'teaching_assignment');

-- CreateEnum
CREATE TYPE "evaluator_group" AS ENUM ('students', 'colleagues', 'dh', 'other');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'opened', 'submitted', 'expired');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('draft', 'submitted', 'withdrawn');

-- CreateEnum
CREATE TYPE "state_category" AS ENUM ('initial', 'active', 'waiting', 'terminal');

-- CreateEnum
CREATE TYPE "version_status" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "feature_version_status" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "feature_step_status" AS ENUM ('pending', 'active', 'done', 'skipped', 'rejected');

-- CreateEnum
CREATE TYPE "feature_migration_status" AS ENUM ('planned', 'running', 'done', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "adapter_hook" AS ENUM ('guard', 'effect', 'on_enter', 'on_exit', 'compute', 'validate', 'auto', 'backing', 'export', 'source_binding', 'relationship', 'projection');

-- CreateEnum
CREATE TYPE "org_scope" AS ENUM ('faculty', 'department', 'program', 'section');

-- CreateEnum
CREATE TYPE "reminder_kind" AS ENUM ('deadline', 'interval');

-- CreateEnum
CREATE TYPE "job_kind" AS ENUM ('reminder', 'interval_nudge', 'outbox_dispatch', 'campaign_open', 'campaign_close', 'campaign_aggregate', 'auto_transition', 'recurrence_spawn', 'snapshot_compute', 'portfolio_provision', 'report_generate', 'feature_migrate', 'overdue_sweep', 'grant_reconcile', 'calendar_autotransition', 'retention', 'search_reindex', 'projection_rebuild');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('scheduled', 'sent', 'running', 'done', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('assignment', 'deadline_approaching', 'deadline_missed', 'committee_task', 'portfolio_reminder', 'evaluation_invitation', 'appointment', 'meeting', 'invigilation', 'lab_assignment', 'preference_request', 'campaign', 'announcement', 'mention', 'workflow', 'report_ready', 'system_alert');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('in_app', 'email', 'sms');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'queued', 'sent', 'failed', 'bounced');

-- CreateEnum
CREATE TYPE "digest" AS ENUM ('immediate', 'daily');

-- CreateEnum
CREATE TYPE "template_kind" AS ENUM ('message', 'reminder', 'document', 'report', 'export_layout');

-- CreateEnum
CREATE TYPE "access_mode" AS ENUM ('inherit', 'explicit');

-- CreateEnum
CREATE TYPE "link_role" AS ENUM ('attachment', 'deliverable', 'tor', 'minutes', 'evidence', 'source', 'generated_output', 'signature');

-- CreateEnum
CREATE TYPE "grantee_type" AS ENUM ('role', 'person', 'group');

-- CreateEnum
CREATE TYPE "doc_permission" AS ENUM ('read', 'write');

-- CreateEnum
CREATE TYPE "thread_kind" AS ENUM ('comments', 'revision_notes', 'conversation');

-- CreateEnum
CREATE TYPE "thread_status" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "visibility" AS ENUM ('all', 'reviewers_only', 'internal');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'transition', 'publish', 'login', 'export', 'download', 'permission_change', 'denied', 'tenant_bypass');

-- CreateEnum
CREATE TYPE "import_kind" AS ENUM ('assessment', 'attendance', 'roster', 'students', 'staff', 'lab_schedule', 'class_timetable', 'exam_timetable', 'load_result', 'assets');

-- CreateEnum
CREATE TYPE "import_mode" AS ENUM ('file', 'manual');

-- CreateEnum
CREATE TYPE "disposition" AS ENUM ('ok', 'error', 'skip');

-- CreateEnum
CREATE TYPE "owner_type" AS ENUM ('person', 'resource');

-- CreateEnum
CREATE TYPE "block_kind" AS ENUM ('teaching', 'lab', 'exam', 'invigilation', 'meeting', 'appointment', 'leave', 'blackout');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('hard', 'soft');

-- CreateEnum
CREATE TYPE "policy_purpose" AS ENUM ('appointments', 'invigilation', 'leave');

-- CreateEnum
CREATE TYPE "report_format" AS ENUM ('pdf', 'xlsx', 'csv', 'html');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "export_row_source" AS ENUM ('reviewed_preferences', 'campaign_results');

-- CreateEnum
CREATE TYPE "file_format" AS ENUM ('xlsx', 'csv');

-- CreateEnum
CREATE TYPE "completion_status" AS ENUM ('fully', 'partially', 'not_completed');

-- CreateEnum
CREATE TYPE "comparison_strategy" AS ENUM ('previous_semester', 'previous_year', 'all', 'custom');

-- CreateEnum
CREATE TYPE "cqi_kind" AS ENUM ('problem', 'action_taken', 'recommendation', 'planned_action');

-- CreateEnum
CREATE TYPE "cqi_category" AS ENUM ('low_performance', 'difficult_topic', 'assessment', 'resources', 'attendance', 'other');

-- CreateEnum
CREATE TYPE "impl_status" AS ENUM ('n_a', 'planned', 'implemented', 'partial', 'not_implemented', 'dropped');

-- CreateEnum
CREATE TYPE "outcome" AS ENUM ('pass', 'fail', 'incomplete');

-- CreateEnum
CREATE TYPE "exam_type" AS ENUM ('midterm', 'final', 'makeup');

-- CreateEnum
CREATE TYPE "duty_role" AS ENUM ('chief', 'assistant', 'lab_instructor', 'ra', 'responsible');

-- CreateEnum
CREATE TYPE "end_reason" AS ENUM ('replaced', 'declined', 'schedule_superseded');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'excused');

-- CreateEnum
CREATE TYPE "pref_decision" AS ENUM ('accept', 'adjust', 'reject', 'added_by_department');

-- CreateTable
CREATE TABLE "department" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "faculty_name" TEXT,
    "head_person_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "feature_key" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" TEXT NOT NULL,
    "department_id" TEXT,
    "role_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "level" "permission_level" NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_organization_id_key" ON "department"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_code_key" ON "department"("code");

-- CreateIndex
CREATE INDEX "permission_module_idx" ON "permission"("module");

-- CreateIndex
CREATE INDEX "role_department_id_idx" ON "role"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_department_id_key_key" ON "role"("department_id", "key");

-- CreateIndex
CREATE INDEX "role_permission_department_id_idx" ON "role_permission"("department_id");

-- CreateIndex
CREATE INDEX "role_permission_permission_key_idx" ON "role_permission"("permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_department_id_role_id_permission_key_key" ON "role_permission"("department_id", "role_id", "permission_key");

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=2129461f8f823ded42cafa9d58d2cd3139dc3da2fb3122e91bed716febd90e83
-- shared: Role
ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- shared: RolePermission
ALTER TABLE "role_permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permission"
  USING ("department_id" IS NULL OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK (("department_id" IS NULL AND current_setting('app.tenant_bypass', true) = 'on') OR "department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
