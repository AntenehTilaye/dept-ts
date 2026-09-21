-- CreateIndex
CREATE INDEX "comment_department_id_idx" ON "comment"("department_id");

-- CreateIndex
CREATE INDEX "document_access_grant_department_id_idx" ON "document_access_grant"("department_id");

-- CreateIndex
CREATE INDEX "document_link_department_id_idx" ON "document_link"("department_id");

-- CreateIndex
CREATE INDEX "document_version_department_id_idx" ON "document_version"("department_id");
