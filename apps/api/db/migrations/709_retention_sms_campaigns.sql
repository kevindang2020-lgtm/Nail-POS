-- 709_retention_sms_campaigns.sql — Customer Retention mandate (Oct 29 2026) §10–§15: consent-checked win-back SMS as
-- ONE confirmed batch of INDIVIDUAL texts. There was no table for it: `campaigns` is the marketing planner (an audience
-- label + counters, no recipients, nothing sends), and a per-recipient record is what makes "one SMS per selected
-- customer, never twice" provable. Additive only; no existing table changes.
--
--   retention_sms_campaigns   one row per preview → confirmation: the immutable message body (+ sha256), the audience
--                             snapshot (filters / selection), the counts and exclusion reasons, who previewed and who
--                             confirmed, the request idempotency key. status: draft (a preview, expires) → queued →
--                             sending → completed | partial | failed; or expired / canceled before confirmation.
--   retention_sms_recipients  one row per selected customer: the destination it will go to, the eligibility verdict
--                             (eligible or the exclusion reason) and the send lifecycle
--                             excluded | queued → submitting → sent | blocked | failed | unknown, the notifications
--                             ledger row / provider SID it produced (delivery status comes from that ledger row, which
--                             the signed Twilio callback updates — never double counted). UNIQUE (campaign, customer) and
--                             (campaign, destination): a customer is texted at most once per campaign, even under two
--                             profiles that share a phone.
-- Delivery is the durable job queue (jobs, migration 519): one `retention.sms.send` job per recipient, idempotency key =
-- the recipient id, enqueued in the confirming transaction. A recipient found mid-send after a crash ('submitting') is
-- marked 'unknown' and NEVER re-sent (the provider may have accepted it) — spec §11 / §15.
CREATE TABLE IF NOT EXISTS retention_sms_campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id             UUID,
  status                TEXT NOT NULL DEFAULT 'draft',
  label                 TEXT,
  body                  TEXT NOT NULL,
  body_sha256           TEXT NOT NULL,
  segments_per_message  INTEGER NOT NULL DEFAULT 1,
  audience_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_count        INTEGER NOT NULL DEFAULT 0,
  eligible_count        INTEGER NOT NULL DEFAULT 0,
  excluded_count        INTEGER NOT NULL DEFAULT 0,
  excluded_reasons_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  queued_count          INTEGER NOT NULL DEFAULT 0,
  sender_from           TEXT,
  created_by_user_id    UUID,
  confirmed_by_user_id  UUID,
  idempotency_key       TEXT,
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT now() + interval '20 minutes',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retention_sms_campaigns_status_check CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'partial', 'failed', 'expired', 'canceled')),
  CONSTRAINT retention_sms_campaigns_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 640)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_sms_campaigns_idem ON retention_sms_campaigns (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retention_sms_campaigns_tenant_created ON retention_sms_campaigns (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS retention_sms_recipients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES retention_sms_campaigns(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL,
  customer_id           UUID NOT NULL,
  destination           TEXT,
  eligibility           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'excluded',
  notification_id       UUID,
  provider_id           TEXT,
  error                 TEXT,
  queued_at             TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retention_sms_recipients_status_check CHECK (status IN ('excluded', 'queued', 'submitting', 'sent', 'blocked', 'failed', 'unknown')),
  CONSTRAINT retention_sms_recipients_eligibility_check CHECK (eligibility IN ('eligible', 'no_phone', 'invalid_phone', 'no_consent', 'opted_out', 'recently_contacted', 'never_visited', 'not_found', 'duplicate_destination'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_sms_recipients_customer ON retention_sms_recipients (campaign_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_sms_recipients_destination ON retention_sms_recipients (campaign_id, destination) WHERE destination IS NOT NULL AND eligibility = 'eligible';
CREATE INDEX IF NOT EXISTS idx_retention_sms_recipients_tenant_customer ON retention_sms_recipients (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_sms_recipients_provider ON retention_sms_recipients (provider_id) WHERE provider_id IS NOT NULL;

-- the retention list orders by last settled visit per customer; this is the index that ordering reads
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_customer_settled ON tickets (tenant_id, customer_id, created_at DESC) WHERE status IN ('closed', 'paid');
