-- 703_audit_no_truncate.sql — Security Deep Scan §137 (Oct 28 2026 re-audit): the audit tables are append-only.
--
-- 452_audit_append_only.sql refuses UPDATE and DELETE row by row (and honours legal holds), but a row trigger never fires
-- on TRUNCATE — so whoever can run DDL-level statements on these tables (today: the application connects as the table
-- owner, §85, until the aps_api / aps_worker roles are provisioned) could empty the whole audit history in one statement.
-- A BEFORE TRUNCATE statement trigger refuses it. Additive: no data is touched; nothing in the application truncates these
-- tables (the test suites build a fresh schema per run). A deliberate purge stays possible for the database owner by
-- disabling the trigger first, which is itself a logged DDL change.
CREATE OR REPLACE FUNCTION audit_refuse_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_no_truncate ON audit_events;
CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();

DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();

DROP TRIGGER IF EXISTS trg_security_events_no_truncate ON security_events;
CREATE TRIGGER trg_security_events_no_truncate BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();

DROP TRIGGER IF EXISTS trg_authorization_audit_events_no_truncate ON authorization_audit_events;
CREATE TRIGGER trg_authorization_audit_events_no_truncate BEFORE TRUNCATE ON authorization_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_refuse_truncate();
