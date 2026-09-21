-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "current_version_no" INTEGER NOT NULL DEFAULT 0,
    "access_mode" "access_mode" NOT NULL DEFAULT 'inherit',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retention_class" TEXT,
    "created_by" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "extracted_text" TEXT,
    "locked_at" TIMESTAMP(3),
    "locked_by_transition_log_id" TEXT,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "link_role" "link_role" NOT NULL,
    "slot_key" TEXT NOT NULL DEFAULT '',
    "linked_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_grant" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "grantee_type" "grantee_type" NOT NULL,
    "grantee_id" TEXT NOT NULL,
    "permission" "doc_permission" NOT NULL,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "subject_type" "subject_type",
    "subject_id" TEXT,
    "kind" "thread_kind" NOT NULL,
    "title" TEXT,
    "participant_group_id" TEXT,
    "section_id" TEXT,
    "opened_by" TEXT NOT NULL,
    "status" "thread_status" NOT NULL DEFAULT 'open',
    "escalated_to_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_person_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "visibility" NOT NULL DEFAULT 'all',
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_department_id_category_idx" ON "document"("department_id", "category");

-- CreateIndex
CREATE INDEX "document_department_id_created_by_created_at_idx" ON "document"("department_id", "created_by", "created_at");

-- CreateIndex
CREATE INDEX "document_tags_idx" ON "document" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_storage_key_key" ON "document_version"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_document_id_version_no_key" ON "document_version"("document_id", "version_no");

-- CreateIndex
CREATE INDEX "document_link_subject_type_subject_id_link_role_slot_key_idx" ON "document_link"("subject_type", "subject_id", "link_role", "slot_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_link_document_id_subject_type_subject_id_link_role_key" ON "document_link"("document_id", "subject_type", "subject_id", "link_role", "slot_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_access_grant_document_id_grantee_type_grantee_id_key" ON "document_access_grant"("document_id", "grantee_type", "grantee_id");

-- CreateIndex
CREATE INDEX "thread_section_id_status_idx" ON "thread"("section_id", "status");

-- CreateIndex
CREATE INDEX "thread_department_id_status_updated_at_idx" ON "thread"("department_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "thread_subject_type_subject_id_kind_key" ON "thread"("subject_type", "subject_id", "kind");

-- CreateIndex
CREATE INDEX "comment_thread_id_created_at_idx" ON "comment"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grant" ADD CONSTRAINT "document_access_grant_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grant" ADD CONSTRAINT "document_access_grant_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_participant_group_id_fkey" FOREIGN KEY ("participant_group_id") REFERENCES "group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_person_id_fkey" FOREIGN KEY ("author_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- generated by gen-rls.ts; manifest-hash=6682467186c4ab36b34099b003d22d8a67a737c781236398202292c7f87a9273
-- tenant: Comment
ALTER TABLE "comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comment"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Document
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: DocumentAccessGrant
ALTER TABLE "document_access_grant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_access_grant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_access_grant"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: DocumentLink
ALTER TABLE "document_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_link"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: DocumentVersion
ALTER TABLE "document_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_version"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');

-- tenant: Thread
ALTER TABLE "thread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thread"
  USING ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on')
  WITH CHECK ("department_id" = current_setting('app.current_department_id', true) OR current_setting('app.tenant_bypass', true) = 'on');
