-- 741_customer_notifications.sql — Customer Notifications Complete Build Guide (30 Oct 2026). ADDITIVE ONLY: no historical
-- notification row is rewritten, re-attributed or deleted ("never fix evidence by overwriting it", guide §08).
--
-- The ONE message ledger stays `notifications` (one row per send attempt; provider id, normalized status, provider status /
-- error code, delivered_at). The guide's logical entities map onto it like this (§13 — adapt, do not duplicate):
--   notifications               = the attempt row. A resend is a NEW row pointing at the row it retries
--                                 (retry_of_notification_id), so the original failure stays visible and auditable.
--   notification_delivery_events  NEW, append-only: every signature-verified provider status callback, deduped per
--                                 (tenant, provider message id, provider status) — timing, out-of-order evidence, freshness.
--   notification_consent_events   NEW, append-only: every opt-out / opt-in with its source (customer STOP / START, staff with
--                                 a consent note, phone-number change, legacy backfill). notification_opt_outs stays the
--                                 CURRENT suppression state that every sender already checks.
--   notification_retry_requests   NEW: the authorized, idempotent "retry this failed notification" requests and their outcome.
--   incidents                     owner_alerts (category 'messaging_failure'): its existing acknowledged / resolved lifecycle,
--                                 Owner App surfacing and realtime event are reused; a partial unique index makes ONE open
--                                 incident per (tenant, rule, channel) — repeated detections update it instead of piling up.
--   messaging health             read from the existing Phone & Messaging readiness rows (tenant_messaging_* , 69x) — no copy.
--
-- New columns on notifications (NULL on every historical row = "not recorded", never guessed):
--   branch_id                   the branch the send belongs to (for branch filters), when the sender knew it
--   source_type / source_id     what produced the message (appointment / ticket / campaign / thread / follow-up / retry)
--   retry_of_notification_id    the attempt this row re-sends
--
-- Rollback: drop the three new tables and the owner_alerts index; the added columns are nullable and ignored by older code.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS retry_of_notification_id UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notifications_source_type') THEN
    ALTER TABLE notifications ADD CONSTRAINT ck_notifications_source_type CHECK (source_type IS NULL OR source_type IN ('appointment', 'ticket', 'campaign', 'thread', 'follow_up', 'retry', 'template_test', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_retry_of') THEN
    ALTER TABLE notifications ADD CONSTRAINT fk_notifications_retry_of FOREIGN KEY (retry_of_notification_id) REFERENCES notifications(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created_id ON notifications (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status_created ON notifications (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_to ON notifications (tenant_id, to_address);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_branch_created ON notifications (tenant_id, branch_id, created_at DESC) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_source ON notifications (tenant_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_retry_of ON notifications (retry_of_notification_id) WHERE retry_of_notification_id IS NOT NULL;

-- ── provider status callbacks (append-only) ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_delivery_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  notification_id       UUID,
  provider_message_sid  TEXT NOT NULL,
  provider_status       TEXT NOT NULL,
  error_code            TEXT,
  applied               BOOLEAN NOT NULL DEFAULT false,   -- did it move the ledger row (false = duplicate / out of order / unknown status)
  signature_verified    BOOLEAN NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_delivery_events UNIQUE (tenant_id, provider_message_sid, provider_status)
);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_events_notification ON notification_delivery_events (tenant_id, notification_id, received_at);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_events_tenant_received ON notification_delivery_events (tenant_id, received_at DESC);
CREATE OR REPLACE FUNCTION notification_delivery_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification delivery events are immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_notification_delivery_events_immutable ON notification_delivery_events;
CREATE TRIGGER trg_notification_delivery_events_immutable BEFORE UPDATE OR DELETE ON notification_delivery_events
  FOR EACH ROW EXECUTE FUNCTION notification_delivery_events_immutable();

-- ── consent history (append-only) ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_consent_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  address         TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('opt_out', 'opt_in')),
  source          TEXT NOT NULL CHECK (source IN ('inbound_stop', 'inbound_start', 'staff', 'phone_change', 'system', 'legacy_backfill')),
  purpose         TEXT NOT NULL DEFAULT 'all' CHECK (purpose IN ('all', 'marketing')),
  reason          TEXT,
  consent_note    TEXT,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_consent_events_addr ON notification_consent_events (tenant_id, channel, address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_consent_events_tenant_created ON notification_consent_events (tenant_id, created_at DESC);
CREATE OR REPLACE FUNCTION notification_consent_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification consent events are immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_notification_consent_events_immutable ON notification_consent_events;
CREATE TRIGGER trg_notification_consent_events_immutable BEFORE UPDATE OR DELETE ON notification_consent_events
  FOR EACH ROW EXECUTE FUNCTION notification_consent_events_immutable();
-- the opt-outs already on file get ONE labelled backfill event each (when they were recorded; how is unknown)
INSERT INTO notification_consent_events (tenant_id, channel, address, action, source, reason, created_at)
SELECT o.tenant_id, o.channel, o.address, 'opt_out', 'legacy_backfill', o.reason, o.opted_out_at
  FROM notification_opt_outs o
 WHERE NOT EXISTS (SELECT 1 FROM notification_consent_events e WHERE e.tenant_id = o.tenant_id AND e.channel = o.channel AND e.address = o.address);

-- ── authorized resend requests ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_retry_requests (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL,
  original_notification_id   UUID NOT NULL REFERENCES notifications(id),
  new_notification_id        UUID REFERENCES notifications(id),
  idempotency_key            TEXT NOT NULL,
  failure_category           TEXT NOT NULL,
  outcome                    TEXT NOT NULL CHECK (outcome IN ('sent', 'simulated', 'blocked', 'failed', 'refused')),
  refusal_code               TEXT,
  requested_by               UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_retry_key UNIQUE (tenant_id, idempotency_key)
);
-- one SUCCESSFUL resend per failed attempt: a second click (any key) can never text the customer twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_retry_success ON notification_retry_requests (tenant_id, original_notification_id) WHERE outcome IN ('sent', 'simulated');
CREATE INDEX IF NOT EXISTS idx_notification_retry_original ON notification_retry_requests (tenant_id, original_notification_id, created_at DESC);

-- ── one OPEN messaging incident per rule + channel ──────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_alerts_messaging_open ON owner_alerts (tenant_id, (metadata->>'dedupeKey'))
  WHERE category = 'messaging_failure' AND status IN ('new', 'acknowledged', 'in_progress');
