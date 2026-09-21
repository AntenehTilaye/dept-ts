-- Hand-written (design part 04 §22, phase P6). Document versions are append-only for the
-- runtime role: it may insert, and may only set the lock and extracted-text columns. A locked
-- version refuses every further update. Function names are unqualified so the migration also
-- lands in per-run test schemas.

REVOKE UPDATE, DELETE ON "document_version" FROM dept_app;
GRANT UPDATE ("locked_at", "locked_by_transition_log_id", "extracted_text") ON "document_version" TO dept_app;

CREATE FUNCTION document_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'document version % of % is locked', OLD.version_no, OLD.document_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_version_immutable BEFORE UPDATE ON "document_version"
  FOR EACH ROW EXECUTE FUNCTION document_version_immutable();

-- Locks a version on behalf of an approving transition. SECURITY DEFINER (owner: the migrator,
-- which bypasses RLS) so the tenant check is repeated here; no fixed search_path on purpose so
-- the same function serves per-run test schemas (see DEVIATIONS, P4).
CREATE FUNCTION document_version_lock(p_document_id text, p_version_no integer, p_transition_log_id text)
RETURNS void AS $$
DECLARE v record;
BEGIN
  SELECT id, department_id, locked_at INTO v FROM document_version
    WHERE document_id = p_document_id AND version_no = p_version_no FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document version % of % does not exist', p_version_no, p_document_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF coalesce(current_setting('app.tenant_bypass', true), '') <> 'on'
     AND v.department_id IS DISTINCT FROM current_setting('app.current_department_id', true) THEN
    RAISE EXCEPTION 'document version belongs to another department' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'document version % of % is already locked', p_version_no, p_document_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE document_version SET locked_at = now(), locked_by_transition_log_id = p_transition_log_id
    WHERE id = v.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION document_version_lock(text, integer, text) TO dept_app;

-- Retention: removes every version row of a document (the caller deletes the stored objects
-- and the document row). Locked versions are kept; the count returned excludes them.
CREATE FUNCTION document_version_purge(p_document_id text) RETURNS integer AS $$
DECLARE n integer;
BEGIN
  IF coalesce(current_setting('app.tenant_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION 'document_version_purge requires tenant bypass' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM document_version WHERE document_id = p_document_id AND locked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION document_version_purge(text) TO dept_app;
