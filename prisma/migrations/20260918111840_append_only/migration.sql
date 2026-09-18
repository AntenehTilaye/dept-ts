-- Hand-written (design part 04 §22). Append-only tables and the column-guarded outbox.
-- Function names are unqualified so the migration also lands in per-run test schemas.

CREATE FUNCTION raise_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

REVOKE UPDATE, DELETE ON "audit_event", "workflow_transition_log", "event_handler_receipt" FROM dept_app;
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER workflow_transition_log_immutable BEFORE UPDATE OR DELETE ON "workflow_transition_log"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER event_handler_receipt_immutable BEFORE UPDATE OR DELETE ON "event_handler_receipt"
  FOR EACH ROW EXECUTE FUNCTION raise_immutable();

-- The outbox: the worker may only touch the delivery columns and may delete published rows.
REVOKE UPDATE, DELETE ON "domain_event" FROM dept_app;
GRANT UPDATE ("published_at", "dead_at", "attempts", "last_error") ON "domain_event" TO dept_app;
GRANT DELETE ON "domain_event" TO dept_app;

CREATE FUNCTION domain_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NULL THEN
      RAISE EXCEPTION 'unpublished domain events cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id OR NEW.payload_json IS DISTINCT FROM OLD.payload_json
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'only the delivery columns of domain_event may change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER domain_event_guard BEFORE UPDATE OR DELETE ON "domain_event"
  FOR EACH ROW EXECUTE FUNCTION domain_event_guard();

-- Retention: removes published events older than the cut-off. The worker calls it under
-- tenant bypass (retention.run), so it runs with the caller's rights and search path and
-- works in every schema (a SECURITY DEFINER with a fixed search_path would not).
CREATE FUNCTION purge_domain_events(before timestamptz) RETURNS integer AS $$
DECLARE n integer;
BEGIN
  DELETE FROM domain_event WHERE published_at IS NOT NULL AND occurred_at < before;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION purge_domain_events(timestamptz) TO dept_app;

-- Faculty-level audit rows and outbox events (NULL department_id: admin pages, provisioning,
-- global-table writes) are inserted without tenant bypass; the tenant_isolation policy only
-- permits NULL rows under bypass, so these permissive INSERT policies are OR-ed in.
CREATE POLICY faculty_insert ON "audit_event" FOR INSERT WITH CHECK ("department_id" IS NULL);
CREATE POLICY faculty_insert ON "domain_event" FOR INSERT WITH CHECK ("department_id" IS NULL);
