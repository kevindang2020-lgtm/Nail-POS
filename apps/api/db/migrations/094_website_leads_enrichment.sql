-- 094_website_leads_enrichment.sql — upgrade the existing website_leads table (060) to the rich Super-Admin Website Leads
-- surface: lead scoring, a source channel, sales-rep assignment, scheduled follow-up, and qualification fields. Plus an
-- activity feed (notes / status changes / conversions / intake in one stream) and scheduled follow-ups. Additive only —
-- existing rows and the basic /platform/leads endpoints keep working.

ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS contact_name              TEXT;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS source                    TEXT;     -- channel: website_form/live_chat/instagram/facebook_ads/google_ads/referral/manual/phone/email
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS lead_score                INTEGER;  -- 0..100, null = unscored
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS assigned_to_user_id       UUID;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS next_follow_up_at         TIMESTAMPTZ;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS current_pos               TEXT;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS technician_count          INTEGER;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS monthly_card_volume_cents BIGINT;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS archived_at               TIMESTAMPTZ;

-- Broaden the status set (keep the legacy values so existing rows stay valid).
ALTER TABLE website_leads DROP CONSTRAINT IF EXISTS website_leads_status_check;
ALTER TABLE website_leads ADD CONSTRAINT website_leads_status_check CHECK (status IN (
  'new','contacted','qualified','converted','unqualified','lost','spam','archived',
  'demo_scheduled','converted_to_application'
));

CREATE INDEX IF NOT EXISTS idx_website_leads_status_created   ON website_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_leads_source           ON website_leads (source);
CREATE INDEX IF NOT EXISTS idx_website_leads_assigned         ON website_leads (assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_website_leads_next_follow_up   ON website_leads (next_follow_up_at);

-- One activity stream: note, status_change, assigned, converted, follow_up_scheduled, score_changed, created, ...
CREATE TABLE IF NOT EXISTS lead_activities (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            UUID NOT NULL REFERENCES website_leads(id) ON DELETE CASCADE,
  activity_type      TEXT NOT NULL,
  title              TEXT,
  message            TEXT,
  created_by_user_id UUID,
  metadata_json      JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead    ON lead_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activities_recent  ON lead_activities (created_at DESC);

-- Scheduled follow-ups (separate from the activity log so they have a due/complete lifecycle).
CREATE TABLE IF NOT EXISTS lead_follow_ups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID NOT NULL REFERENCES website_leads(id) ON DELETE CASCADE,
  assigned_to_user_id UUID,
  due_at              TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_lead ON lead_follow_ups (lead_id, due_at);
