-- 181_campaign_deliveries.sql
-- Message-delivery model for Marketing & Campaigns. Two tables:
--  * campaign_delivery_rollups — per-campaign attempted/delivered/opted_out counts, so Delivery Rate and Opt-out Rate
--    become real (delivery = delivered ÷ attempted; opt-out = opted_out ÷ delivered).
--  * campaign_delivery_failures — categorized failures with SAFE masked destinations and provider responses (never
--    raw contact info or credentials), retry-eligibility, and resolution status. Spans tenant campaigns and platform
--    announcements via (subject_type, subject_id) without collapsing the boundary.
CREATE TABLE IF NOT EXISTS campaign_delivery_rollups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('tenant_campaign','platform_announcement')),
  subject_id    TEXT NOT NULL,
  tenant_id     UUID,
  attempted     INTEGER NOT NULL DEFAULT 0,
  delivered     INTEGER NOT NULL DEFAULT 0,
  opted_out     INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (attempted >= 0 AND delivered >= 0 AND opted_out >= 0 AND delivered <= attempted)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_rollup_subject ON campaign_delivery_rollups (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS campaign_delivery_failures (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type       TEXT NOT NULL CHECK (subject_type IN ('tenant_campaign','platform_announcement')),
  subject_id         TEXT NOT NULL,
  tenant_id          UUID,
  channel            TEXT,
  provider           TEXT,
  failure_category   TEXT NOT NULL CHECK (failure_category IN
    ('invalid_phone_email','opted_out','spam_reported','blocked_destination','provider_rejection','channel_error','rate_limit','network_failure','expired_token','other')),
  masked_destination TEXT,                 -- e.g. j***@e***.com or +1******89 (never full contact info)
  provider_response  TEXT,                 -- safe provider status text only
  attempt_count      INTEGER NOT NULL DEFAULT 1,
  retryable          BOOLEAN NOT NULL DEFAULT false,
  resolution_status  TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','retrying','suppressed','resolved')),
  first_failure_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_delivery_failures_subject  ON campaign_delivery_failures (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS ix_delivery_failures_category ON campaign_delivery_failures (failure_category);
CREATE INDEX IF NOT EXISTS ix_delivery_failures_tenant   ON campaign_delivery_failures (tenant_id);
