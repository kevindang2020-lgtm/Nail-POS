-- 725_messaging_registration_sync.sql — Phone & Messaging round 2 (Four-Module Completion Guide §6–§7, Oct 30 2026):
-- PM-01 branch-specific test SMS, PM-03 Twilio 10DLC status sync, PM-04 toll-free verification tracking, OPS-01
-- per-number inbound webhook evidence and API key scope.
--
-- EXPAND-ONLY and idempotent (CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). Nothing existing is rewritten or
-- dropped. Holds EVIDENCE only — never a secret value:
--
--   tenant_messaging_registration_snapshots  append-only: each provider read of one registration item (10DLC brand, A2P
--                                            campaign, Messaging Service, number ↔ Messaging Service association,
--                                            toll-free verification) for ONE salon: provider id, the provider's raw
--                                            status token, the normalized state, whether the provider CONFIRMED it in
--                                            this read (`verified`), source, error class, the last successful read
--                                            time and the retry state. Registration submitted from Super Admin is
--                                            never "approved" until a row here says the provider confirmed it.
--   tenant_messaging_registration_sync_runs  one row per refresh run (manual "Refresh Status" or the scheduled job):
--                                            outcome, error class, items read. Unique per salon + idempotency key, so a
--                                            retried job or a double tap never runs twice.
--   sms_test_events (+3 columns)             PM-01: which configuration a test used (branch_override / tenant_default),
--                                            the account's last 4 and the sender kind. branch_id already exists (721).
--   tenant_messaging_health_checks (+2)      OPS-01: per-number inbound webhook results and the API key scope
--                                            assessment (a Restricted key that lacks a read is "limited", not "rejected").
--
-- Recovery: every object is new or an added nullable column. Rolling back the code leaves them unread; forward-fix
-- only (docs/handoff/PHONE_MESSAGING_ROUND2_2026-10-30.md).

CREATE TABLE IF NOT EXISTS tenant_messaging_registration_sync_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  trigger_kind          text NOT NULL,
  idempotency_key       text NOT NULL,
  account_source        text,
  outcome               text NOT NULL DEFAULT 'running',
  error_class           text,
  items_checked         integer NOT NULL DEFAULT 0,
  requested_by_user_id  uuid,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  CONSTRAINT uq_tmrsr_idem UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_tmrsr_trigger CHECK (trigger_kind IN ('manual', 'scheduled')),
  CONSTRAINT ck_tmrsr_outcome CHECK (outcome IN ('running', 'ok', 'partial', 'provider_unreachable', 'not_configured', 'error'))
);
CREATE INDEX IF NOT EXISTS ix_tmrsr_tenant_started ON tenant_messaging_registration_sync_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tenant_messaging_registration_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  run_id            uuid,
  item_kind         text NOT NULL,
  provider_id       text,
  raw_status        text,
  normalized_state  text NOT NULL,
  verified          boolean NOT NULL DEFAULT false,
  source            text NOT NULL,
  account_source    text,
  error_class       text,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  last_success_at   timestamptz,
  retry_count       integer NOT NULL DEFAULT 0,
  next_retry_at     timestamptz,
  CONSTRAINT ck_tmrs_kind CHECK (item_kind IN ('brand', 'campaign', 'messaging_service', 'number_association', 'tollfree_verification')),
  CONSTRAINT ck_tmrs_state CHECK (normalized_state IN ('approved', 'pending', 'rejected', 'suspended', 'not_started', 'unknown', 'not_applicable')),
  CONSTRAINT ck_tmrs_source CHECK (source IN ('provider', 'registration_record', 'not_configured'))
);
CREATE INDEX IF NOT EXISTS ix_tmrs_tenant_kind_checked ON tenant_messaging_registration_snapshots (tenant_id, item_kind, checked_at DESC);

CREATE OR REPLACE FUNCTION messaging_registration_snapshots_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tenant_messaging_registration_snapshots is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_tmrs_append_only ON tenant_messaging_registration_snapshots;
CREATE TRIGGER trg_tmrs_append_only BEFORE UPDATE OR DELETE ON tenant_messaging_registration_snapshots FOR EACH ROW EXECUTE FUNCTION messaging_registration_snapshots_append_only();

ALTER TABLE sms_test_events ADD COLUMN IF NOT EXISTS config_source text;
ALTER TABLE sms_test_events ADD COLUMN IF NOT EXISTS account_sid_last4 text;
ALTER TABLE sms_test_events ADD COLUMN IF NOT EXISTS sender_kind text;
CREATE INDEX IF NOT EXISTS ix_sms_test_tenant_branch_created ON sms_test_events (tenant_id, branch_id, created_at DESC);

ALTER TABLE tenant_messaging_health_checks ADD COLUMN IF NOT EXISTS numbers_inbound jsonb;
ALTER TABLE tenant_messaging_health_checks ADD COLUMN IF NOT EXISTS api_key_scope text;
