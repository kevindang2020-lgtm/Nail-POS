-- 739_campaign_center.sql — Campaign Center Complete Build Guide (30 Oct 2026). ADDITIVE ONLY: no column is dropped or
-- rewritten, and the existing rows (e.g. "spring into glow": audience 50 / sent 0 / completed) are left exactly as they are —
-- the read model EXPLAINS them instead (audience_source NULL = a hand-typed estimate; no send ledger rows = never sent).
--
--   campaigns + goal / description / deal / message / approval / completion facts
--     audience_source      NULL (legacy) or 'manual_estimate' = the number typed in the old form, NOT a selected audience;
--                          'segment_snapshot' = campaign_recipients rows exist for snapshot_version
--     content_hash         sha-256 of what would be sent (channel, subject, body, deal, audience snapshot version); computed by
--                          the app on every edit. approved_content_hash must equal it for Launch — an edit after approval
--                          silently voids the approval (guide §14 "edited-after-approval invalidation").
--     completed_at         stamped once when the campaign enters 'completed' (machine move)
--   campaign_recipients    the audience SNAPSHOT (guide §16 "Audience snapshot"): one row per selected customer per snapshot,
--                          with the eligibility decision + exclusion reason at snapshot time. The send executor re-checks
--                          consent / opt-out live at send time; this table is never a send record.
--   campaign_health_runs   Check Campaign System (guide §12): read-only findings, who ran it, when — never sends anything.
--
-- The per-recipient SEND record stays ai_marketing_campaign_sends (320, unique tenant+campaign+customer+channel+version) and the
-- provider delivery status stays in notifications (provider_id ↔ provider_id); the plan the send sweep reads stays
-- ai_marketing_campaign_plans (321). No second messaging engine.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS goal                   TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description            TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deal_id                UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS message_body           TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_subject          TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS message_version        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_source        TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_draft_id      UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS snapshot_version       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_hash           TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS origin                 TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS submitted_by_user_id   UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS submitted_at           TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by_user_id    UUID;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_at            TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_content_hash  TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS completed_at           TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_campaigns_audience_source') THEN
    ALTER TABLE campaigns ADD CONSTRAINT ck_campaigns_audience_source CHECK (audience_source IS NULL OR audience_source IN ('manual_estimate', 'segment_snapshot'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_campaigns_origin') THEN
    ALTER TABLE campaigns ADD CONSTRAINT ck_campaigns_origin CHECK (origin IN ('manual', 'assistant', 'segments'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_campaigns_message_version') THEN
    ALTER TABLE campaigns ADD CONSTRAINT ck_campaigns_message_version CHECK (message_version >= 1);
  END IF;
END $$;

-- §07 default order created_at DESC, id DESC (stable); §06 date bases scheduled / started / completed
CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_created_id ON campaigns (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_completed ON campaigns (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_scheduled ON campaigns (tenant_id, scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id),
  snapshot_version     INTEGER NOT NULL CHECK (snapshot_version >= 1),
  customer_id          UUID NOT NULL,
  channel              TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  eligibility          TEXT NOT NULL,          -- eligible | no_consent | opted_out | no_phone | invalid_phone | no_email | invalid_email | never_visited | not_found | duplicate_destination
  destination_masked   TEXT,
  source_draft_id      UUID,                   -- segment_audience_drafts.id it was copied from
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, snapshot_version, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_campaign_recipients_tenant ON campaign_recipients (tenant_id, campaign_id, snapshot_version, eligibility);
CREATE INDEX IF NOT EXISTS ix_campaign_recipients_customer ON campaign_recipients (tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS campaign_health_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  branch_id            UUID,
  campaign_id          UUID,
  overall              TEXT NOT NULL CHECK (overall IN ('ready', 'attention_required', 'pending', 'failed', 'unknown')),
  findings_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  correlation_id       TEXT NOT NULL,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_campaign_health_runs_tenant ON campaign_health_runs (tenant_id, created_at DESC, id DESC);

-- per-campaign ledger reads: recipient search by customer, delivery history newest-first
CREATE INDEX IF NOT EXISTS ix_ai_mkt_sends_tenant_customer ON ai_marketing_campaign_sends (tenant_id, customer_id, created_at DESC);
