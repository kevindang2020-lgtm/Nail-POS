-- 748_email_center.sql — Email Management & Delivery Center (Email Complete Build Guide, Oct 31 2026). ADDITIVE only.
--
-- The ONE outgoing-message ledger stays `notifications` (channel 'email' rows, 101 / 663 / 741). This migration adds what
-- the email path was missing; it creates no second email store:
--   notification_opt_outs.scope       'all' (every email: bounce, complaint, staff) | 'marketing' (unsubscribe link):
--                                     a marketing unsubscribe never blocks a receipt; a hard bounce / complaint blocks all.
--                                     Existing rows keep 'all' — exactly what they meant before (no silent change).
--   notification_consent_events       three new sources: provider_bounce, provider_complaint, email_unsubscribe
--   email_send_keys                   claim-before-send: one key → one attempt (booking confirmation per appointment,
--                                     test sends, receipts). A crash between claim and provider leaves the key with no
--                                     notification — shown as Unknown, never auto-resent.
--   email_health_checks               append-only provider / sender / callback checks (manual + scheduled), so the page
--                                     shows the last check and the last SUCCESSFUL check separately (guide §05).
-- Rollback: DROP TABLE email_health_checks, email_send_keys; ALTER TABLE notification_opt_outs DROP COLUMN scope; restore
-- ck_notification_consent_events_source without the three new sources (only if no such rows exist).

ALTER TABLE notification_opt_outs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'all';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notification_opt_outs_scope') THEN
    ALTER TABLE notification_opt_outs ADD CONSTRAINT ck_notification_opt_outs_scope CHECK (scope IN ('all', 'marketing'));
  END IF;
END $$;

-- consent sources: the inline CHECK from 741 has a generated name; replace it with a named one that adds the email sources
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'notification_consent_events'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%source%inbound_stop%' LOOP
    EXECUTE format('ALTER TABLE notification_consent_events DROP CONSTRAINT %I', c);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notification_consent_events_source') THEN
    ALTER TABLE notification_consent_events ADD CONSTRAINT ck_notification_consent_events_source CHECK (source IN
      ('inbound_stop', 'inbound_start', 'staff', 'phone_change', 'system', 'legacy_backfill', 'provider_bounce', 'provider_complaint', 'email_unsubscribe'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_send_keys (
  tenant_id        UUID NOT NULL,
  idempotency_key  TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  category         TEXT NOT NULL CHECK (category IN ('booking_confirmation', 'receipt', 'test', 'manual', 'marketing', 'other')),
  notification_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_email_send_keys_notification ON email_send_keys (tenant_id, notification_id) WHERE notification_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_health_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  trigger_type     TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  configuration    TEXT NOT NULL CHECK (configuration IN ('not_configured', 'incomplete', 'ready_to_check', 'invalid', 'unknown')),
  sender_identity  TEXT NOT NULL CHECK (sender_identity IN ('unverified', 'pending', 'verified', 'failed', 'unknown')),
  provider_health  TEXT NOT NULL CHECK (provider_health IN ('healthy', 'degraded', 'down', 'not_checked', 'unknown')),
  callbacks        TEXT NOT NULL CHECK (callbacks IN ('receiving', 'not_configured', 'stale', 'unknown')),
  overall          TEXT NOT NULL CHECK (overall IN ('ready', 'attention_required', 'setup_required', 'unknown')),
  issue_code       TEXT,
  detail           TEXT,
  checked_by       UUID,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_health_checks_tenant ON email_health_checks (tenant_id, checked_at DESC);
CREATE OR REPLACE FUNCTION email_health_checks_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'email health checks are immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_email_health_checks_immutable ON email_health_checks;
CREATE TRIGGER trg_email_health_checks_immutable BEFORE UPDATE OR DELETE ON email_health_checks
  FOR EACH ROW EXECUTE FUNCTION email_health_checks_immutable();

-- the email history page: newest first per tenant, and provider-id lookups from the email event webhook
CREATE INDEX IF NOT EXISTS idx_notifications_email_tenant_created ON notifications (tenant_id, created_at DESC, id DESC) WHERE channel = 'email';
CREATE INDEX IF NOT EXISTS idx_notifications_provider_id ON notifications (provider_id) WHERE provider_id IS NOT NULL;
