-- 452_audit_append_only.sql — Constitution 12 §187 (audit finding H3): the audit trail cannot be rewritten.
--
-- audit_events and audit_logs had no protection: any code path — or anyone holding the application's database
-- credentials — could UPDATE or DELETE history. No production code does either today (retention is preview-only:
-- "NEVER deletes a log row", audit-retention.service.ts), so making both append-only breaks nothing that runs.
--
-- UPDATE is always refused. DELETE is refused unless ALL of:
--   1. the session set `aps.audit_retention = 'on'` (the future purge job, and only it);
--   2. the row is older than 365 days (retention-core's floor for audit data);
--   3. (audit_events) no ACTIVE legal hold covers it — matched with the SAME semantics the retention preview uses
--      (global / tenant / user / action substring / date_range 'start|end'), so no purge job can delete held rows even
--      if its own code forgets to check.
-- The same shape as security_events (migration 449).
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
DECLARE
  ts_col  text := TG_ARGV[0];
  holds   boolean := coalesce(TG_ARGV[1], 'no') = 'holds';
  row_ts  timestamptz := (to_jsonb(OLD) ->> ts_col)::timestamptz;
  held    boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only (UPDATE refused)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_setting('aps.audit_retention', true) IS DISTINCT FROM 'on' OR row_ts IS NULL OR row_ts >= now() - interval '365 days' THEN
    RAISE EXCEPTION '% is append-only (DELETE refused: not the retention job, or inside retention)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF holds THEN
    SELECT EXISTS (
      SELECT 1 FROM audit_legal_holds h WHERE h.status = 'active' AND (
        h.scope_type = 'global'
        OR (h.scope_type = 'tenant' AND h.scope_value = OLD.tenant_id::text)
        OR (h.scope_type = 'user' AND h.scope_value = OLD.actor_user_id::text)
        OR (h.scope_type = 'action' AND position(lower(h.scope_value) in lower(coalesce(OLD.action, ''))) > 0)
        OR (h.scope_type = 'date_range' AND row_ts::date BETWEEN split_part(h.scope_value, '|', 1)::date AND split_part(h.scope_value, '|', 2)::date)
      )) INTO held;
    IF held THEN
      RAISE EXCEPTION '% row is under an active legal hold (DELETE refused)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_append_only('occurred_at', 'holds');
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_append_only('created_at', 'no');
