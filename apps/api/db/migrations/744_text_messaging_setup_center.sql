-- 744_text_messaging_setup_center.sql — Text Messaging Setup & SMS Readiness guide (Oct 31 2026). ADDITIVE ONLY.
--
--   • tenant_messaging_health_checks.trigger_kind may now be 'scheduled' — the controlled nightly health run (guide §11,
--     env-gated MESSAGING_HEALTH_SCHEDULE_ENABLED, OFF by default). Read-only at the provider: it never sends a text,
--     buys a number, registers a carrier or changes a credential. Existing rows ('manual' / 'save') stay valid.
--   • activity-history indexes (guide §14–§16 newest-first, pages of 10/20/50, date basis):
--       sms_test_events (tenant, created_at DESC, id DESC) and (tenant, status_updated_at DESC)
--       tenant_messaging_health_checks (tenant, checked_at DESC, id DESC)
--       tenant_messaging_registration_sync_runs (tenant, started_at DESC, id DESC)
--       tenant_number_purchase_quotes (tenant, created_at DESC, id DESC)
--
-- Rollback: the widened CHECK accepts every old value; the indexes are unread by older code (DROP INDEX is safe).

ALTER TABLE tenant_messaging_health_checks DROP CONSTRAINT IF EXISTS ck_tmhc_trigger;
ALTER TABLE tenant_messaging_health_checks ADD CONSTRAINT ck_tmhc_trigger CHECK (trigger_kind IN ('manual', 'save', 'scheduled'));

CREATE INDEX IF NOT EXISTS ix_sms_test_tenant_created_id ON sms_test_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_sms_test_tenant_status_upd ON sms_test_events (tenant_id, status_updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_tmhc_tenant_checked_id ON tenant_messaging_health_checks (tenant_id, checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_tmrsr_tenant_started_id ON tenant_messaging_registration_sync_runs (tenant_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_tnpq_tenant_created_id ON tenant_number_purchase_quotes (tenant_id, created_at DESC, id DESC);
