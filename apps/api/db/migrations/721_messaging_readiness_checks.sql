-- 721_messaging_readiness_checks.sql — Phone & Messaging + Text Messaging Setup (owner guide, Oct 30 2026).
-- EXPAND-ONLY and idempotent: four new tables, indexes and triggers. No existing row or column is read, rewritten or
-- dropped. The salon's ONE credential store stays tenant_messaging_credentials (311/368/521/639/668); these tables hold
-- only EVIDENCE about it (never a secret value):
--
--   tenant_messaging_health_checks   append-only: each authenticated provider check (account, API key, sender number
--                                    ownership + capabilities, inbound URL, Verify) with a safe reason code and a
--                                    fingerprint of the configuration that was checked (a SHA-256 over SIDs and the
--                                    secrets' ciphertext — a changed config is never shown as "checked").
--   sms_test_events                  each Test SMS: masked destination, sender, provider SID, idempotency key, status
--                                    (sending → accepted → sent/delivered/failed/undelivered only from the signed
--                                    status callback). Rows move forward; they are never deleted.
--   tenant_messaging_webhook_activity the last SIGNATURE-VERIFIED inbound / status webhook per salon (inbound readiness
--                                    is proven by a real verified event, never inferred from an outbound test).
--   tenant_number_purchase_quotes    the server-issued, short-lived confirmation for buying a number (token stored as a
--                                    SHA-256 hash, bound to salon + number, single use; the stored result makes a replay
--                                    idempotent).
--
-- Recovery: every table is new. Rolling back the code leaves them unread; nothing needs to be dropped (forward-fix only,
-- docs/handoff/PHONE_MESSAGING_2026-10-30.md).

CREATE TABLE IF NOT EXISTS tenant_messaging_health_checks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  branch_id            uuid,
  config_source        text NOT NULL DEFAULT 'none',
  config_fingerprint   text,
  trigger_kind         text NOT NULL DEFAULT 'manual',
  account_state        text NOT NULL,
  account_reason_code  text,
  account_status       text,
  account_type         text,
  auth_mode            text,
  api_key_state        text,
  sender_number        text,
  sender_state         text,
  sender_capabilities  jsonb,
  inbound_url_state    text,
  verify_state         text,
  verify_reason_code   text,
  duration_ms          integer,
  checked_by_user_id   uuid,
  checked_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tmhc_account_state CHECK (account_state IN ('connected', 'invalid', 'unreachable', 'not_configured', 'error')),
  CONSTRAINT ck_tmhc_trigger CHECK (trigger_kind IN ('manual', 'save'))
);
CREATE INDEX IF NOT EXISTS ix_tmhc_tenant_checked ON tenant_messaging_health_checks (tenant_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS sms_test_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  branch_id             uuid,
  idempotency_key       text NOT NULL,
  destination_masked    text NOT NULL,
  destination_hash      text NOT NULL,
  sender                text,
  provider_message_sid  text,
  status                text NOT NULL DEFAULT 'sending',
  error_code            text,
  warning_codes         text[] NOT NULL DEFAULT '{}',
  created_by_user_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  status_updated_at     timestamptz NOT NULL DEFAULT now(),
  delivered_at          timestamptz,
  CONSTRAINT uq_sms_test_idem UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_sms_test_status CHECK (status IN ('sending', 'accepted', 'sent', 'delivered', 'failed', 'undelivered', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_test_provider_sid ON sms_test_events (provider_message_sid) WHERE provider_message_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sms_test_tenant_created ON sms_test_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_messaging_webhook_activity (
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  webhook_kind       text NOT NULL,
  first_verified_at  timestamptz NOT NULL DEFAULT now(),
  last_verified_at   timestamptz NOT NULL DEFAULT now(),
  events_verified    bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, webhook_kind),
  CONSTRAINT ck_tmwa_kind CHECK (webhook_kind IN ('inbound', 'status'))
);

CREATE TABLE IF NOT EXISTS tenant_number_purchase_quotes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  token_hash          text NOT NULL,
  phone_number        text NOT NULL,
  price_amount        text,
  price_unit          text,
  capabilities        jsonb,
  own_account         boolean NOT NULL DEFAULT false,
  expires_at          timestamptz NOT NULL,
  created_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  consumed_at         timestamptz,
  result_status       text,
  result_number       text,
  result_error_code   text,
  CONSTRAINT uq_tnpq_token UNIQUE (token_hash),
  CONSTRAINT ck_tnpq_result CHECK (result_status IS NULL OR result_status IN ('purchased', 'failed'))
);
CREATE INDEX IF NOT EXISTS ix_tnpq_tenant_created ON tenant_number_purchase_quotes (tenant_id, created_at DESC);

-- append-only evidence: a health check is never rewritten; a test SMS row moves forward but is never deleted
CREATE OR REPLACE FUNCTION messaging_readiness_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_tmhc_append_only ON tenant_messaging_health_checks;
CREATE TRIGGER trg_tmhc_append_only BEFORE UPDATE OR DELETE ON tenant_messaging_health_checks FOR EACH ROW EXECUTE FUNCTION messaging_readiness_append_only();
CREATE OR REPLACE FUNCTION sms_test_events_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'sms_test_events rows are never deleted'; END $$;
DROP TRIGGER IF EXISTS trg_sms_test_no_delete ON sms_test_events;
CREATE TRIGGER trg_sms_test_no_delete BEFORE DELETE ON sms_test_events FOR EACH ROW EXECUTE FUNCTION sms_test_events_no_delete();
