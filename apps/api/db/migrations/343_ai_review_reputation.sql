-- 322_ai_review_reputation.sql — extends the existing `reviews` table (reuse-don't-duplicate) and adds the reputation
-- layer. Additive + reversible; tenant-scoped throughout. AI usage/cost reuse the existing ai_usage_logs/ai_usage_cost.

-- === extend the existing reviews table with reputation columns ===
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source              TEXT NOT NULL DEFAULT 'internal';   -- google|facebook|yelp|internal|survey|sms|email|app|support|manual
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS external_review_id  TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS appointment_id      UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name       TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_url        TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_date         TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_status     TEXT NOT NULL DEFAULT 'review_received';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS sentiment           TEXT;                                -- positive|neutral|negative|mixed
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS severity            TEXT;                                -- low|medium|high|critical
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ai_confidence       NUMERIC(4,3);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS escalation_status   TEXT NOT NULL DEFAULT 'none';        -- none|flagged|escalated|resolved
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS assigned_user_id    UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS resolution_status   TEXT NOT NULL DEFAULT 'open';        -- open|in_progress|resolved|no_action
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_spam             BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ;
-- dedupe an external review per (tenant, source, external id); partial so internal (null external id) rows are unconstrained
CREATE UNIQUE INDEX IF NOT EXISTS reviews_source_external_uniq ON reviews (tenant_id, source, external_review_id) WHERE external_review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reviews_tenant_status ON reviews (tenant_id, response_status, created_at);
CREATE INDEX IF NOT EXISTS reviews_tenant_severity ON reviews (tenant_id, severity) WHERE severity IN ('high', 'critical');

-- === structured AI analysis (one row per analysis run; auditable model/prompt/version) ===
CREATE TABLE IF NOT EXISTS review_analysis (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL, branch_id UUID, review_id UUID NOT NULL,
  sentiment         TEXT, severity TEXT, categories JSONB NOT NULL DEFAULT '[]', serious_signals JSONB NOT NULL DEFAULT '[]',
  escalation_required BOOLEAN NOT NULL DEFAULT false, auto_response_eligible BOOLEAN NOT NULL DEFAULT false,
  is_spam           BOOLEAN NOT NULL DEFAULT false, injection_suspected BOOLEAN NOT NULL DEFAULT false,
  confidence        NUMERIC(4,3), model_name TEXT, model_version TEXT, prompt_version TEXT,
  analysis_source   TEXT NOT NULL DEFAULT 'deterministic', processing_status TEXT NOT NULL DEFAULT 'done',
  analyzed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_analysis_review ON review_analysis (tenant_id, review_id, analyzed_at);

-- === response drafts + versions ===
CREATE TABLE IF NOT EXISTS review_response_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL, branch_id UUID, review_id UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft_generated',   -- draft_generated|awaiting_approval|approved|rejected|needs_revision|published|publish_failed|no_response_required
  tone          TEXT, current_text TEXT, current_version INT NOT NULL DEFAULT 1,
  is_auto       BOOLEAN NOT NULL DEFAULT false,
  created_by_ai BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS review_response_drafts_review_uniq ON review_response_drafts (tenant_id, review_id);
CREATE TABLE IF NOT EXISTS review_response_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL, draft_id UUID NOT NULL, review_id UUID NOT NULL,
  version       INT NOT NULL, text TEXT NOT NULL, edited_by_user_id UUID, is_ai_generated BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_response_versions_draft ON review_response_versions (tenant_id, draft_id, version);

-- === approvals + publications (audited) ===
CREATE TABLE IF NOT EXISTS review_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL, review_id UUID NOT NULL, draft_id UUID NOT NULL,
  action        TEXT NOT NULL,           -- requested|approved|rejected|needs_revision
  actor_user_id UUID, reason TEXT, version INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_approvals_review ON review_approvals (tenant_id, review_id, created_at);
CREATE TABLE IF NOT EXISTS review_publications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL, review_id UUID NOT NULL, draft_id UUID NOT NULL,
  published_by_user_id UUID, result TEXT NOT NULL,  -- published|failed
  external_response_id TEXT, error TEXT, is_auto BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_publications_review ON review_publications (tenant_id, review_id, created_at);

-- === escalations, assignments, notes, recovery ===
CREATE TABLE IF NOT EXISTS review_escalations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL, branch_id UUID, review_id UUID NOT NULL,
  severity      TEXT NOT NULL, signals JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open', -- open|acknowledged|resolved
  assigned_user_id UUID, acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_escalations_open ON review_escalations (tenant_id, status, severity, created_at);
CREATE TABLE IF NOT EXISTS review_internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, review_id UUID NOT NULL,
  author_user_id UUID, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_internal_notes_review ON review_internal_notes (tenant_id, review_id, created_at);
CREATE TABLE IF NOT EXISTS review_recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, review_id UUID NOT NULL,
  action_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'recommended', -- recommended|approved|executed|declined
  created_by_user_id UUID, external_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_recovery_actions_review ON review_recovery_actions (tenant_id, review_id);

-- === review requests (post-visit) + campaigns + events ===
CREATE TABLE IF NOT EXISTS review_request_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, branch_id UUID,
  name TEXT NOT NULL, channel TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, branch_id UUID,
  customer_id UUID, appointment_id UUID, campaign_id UUID, channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|sent|delivered|failed|opted_out|converted
  idempotency_key TEXT NOT NULL, scheduled_for TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS review_requests_idem ON review_requests (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS review_requests_status ON review_requests (tenant_id, status, scheduled_for);
CREATE TABLE IF NOT EXISTS review_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, request_id UUID NOT NULL,
  event TEXT NOT NULL, detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_request_events_req ON review_request_events (tenant_id, request_id, created_at);

-- === reputation snapshots (analytics/trends) ===
CREATE TABLE IF NOT EXISTS reputation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, branch_id UUID,
  snapshot_date DATE NOT NULL, avg_rating NUMERIC(3,2), review_count INT NOT NULL DEFAULT 0,
  positive_pct NUMERIC(5,2), neutral_pct NUMERIC(5,2), negative_pct NUMERIC(5,2),
  response_rate NUMERIC(5,2), avg_response_minutes INT, serious_complaint_count INT NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reputation_snapshots_uniq ON reputation_snapshots (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_date);

-- === settings (tri-state tenant/branch) + versioned config history ===
CREATE TABLE IF NOT EXISTS tenant_ai_reputation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('tenant','branch')), branch_id UUID,
  enabled BOOLEAN, config JSONB, version INT NOT NULL DEFAULT 1, updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_ai_reputation_settings_scope ON tenant_ai_reputation_settings
  (tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE IF NOT EXISTS ai_reputation_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, level TEXT NOT NULL, branch_id UUID,
  version INT NOT NULL, config JSONB, enabled BOOLEAN, changed_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reputation_config_versions_scope ON ai_reputation_config_versions (tenant_id, level, version);
