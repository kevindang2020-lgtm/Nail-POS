-- 180_campaign_compliance.sql
-- Messaging-compliance oversight for Marketing & Campaigns: flags (with a review lifecycle), a pause action outcome,
-- and platform campaign limits. Applies to BOTH tenant campaigns and platform announcements via (subject_type,
-- subject_id) — without collapsing the platform/tenant boundary. Pausing records an action, never silent deletion.
CREATE TABLE IF NOT EXISTS campaign_compliance_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('tenant_campaign','platform_announcement')),
  subject_id    TEXT NOT NULL,
  subject_name  TEXT,
  tenant_id     UUID,
  flag_type     TEXT NOT NULL CHECK (flag_type IN ('high_opt_out','spam_complaints','awaiting_review','abusive','rate_limit_exceeded')),
  severity      TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status        TEXT NOT NULL DEFAULT 'open'   CHECK (status IN ('open','reviewing','cleared','actioned')),
  action_taken  TEXT,                          -- e.g. 'paused'
  detail        TEXT,
  reason        TEXT,
  raised_by_user_id    UUID,
  resolved_by_user_id  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_compliance_flags_status  ON campaign_compliance_flags (status);
CREATE INDEX IF NOT EXISTS ix_compliance_flags_type    ON campaign_compliance_flags (flag_type);
CREATE INDEX IF NOT EXISTS ix_compliance_flags_subject ON campaign_compliance_flags (subject_type, subject_id);

-- Platform-level campaign limits (single active row; history preserved by inserting a new row).
CREATE TABLE IF NOT EXISTS campaign_limits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  max_sends_per_day     INTEGER,
  max_campaigns_per_day INTEGER,
  quiet_hours_start     INTEGER,               -- 0..23, local hour
  quiet_hours_end       INTEGER,               -- 0..23, local hour
  min_hours_between     INTEGER,
  active                BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_sends_per_day IS NULL OR max_sends_per_day >= 0),
  CHECK (max_campaigns_per_day IS NULL OR max_campaigns_per_day >= 0),
  CHECK (quiet_hours_start IS NULL OR (quiet_hours_start BETWEEN 0 AND 23)),
  CHECK (quiet_hours_end   IS NULL OR (quiet_hours_end   BETWEEN 0 AND 23))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_limits_active ON campaign_limits (active) WHERE active = true;
