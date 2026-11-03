-- 773_checkout_upsell_settings_center.sql — Checkout Upsell Assistant Settings guide (Nov 2 2026). Additive only.
-- Rollback: DROP TABLE checkout_upsell_health_runs, ai_checkout_upsell_settings_history; DROP INDEX ix_upsell_recs_activity;
--           ALTER TABLE ai_checkout_upsell_settings DROP COLUMN version.
--
-- The settings table (migration 342) stays the one source of the salon's choices. This adds:
--   • version — the editor sends back the version it read; a stale save is refused (two managers saving at once);
--   • ai_checkout_upsell_settings_history — append-only before/after of every save (who, role, which keys);
--   • an index for the newest-first Suggestion Activity list;
--   • checkout_upsell_health_runs — the read-only "Check Checkout Upsell System" run's evidence.
ALTER TABLE ai_checkout_upsell_settings ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ai_checkout_upsell_settings_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  level           TEXT NOT NULL CHECK (level IN ('tenant', 'branch', 'device', 'user')),
  branch_id       UUID,
  device_id       UUID,
  user_id         UUID,
  version         INT NOT NULL,
  actor_user_id   UUID,
  actor_role      TEXT,
  before_enabled  BOOLEAN,
  after_enabled   BOOLEAN,
  before_tunables JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_tunables  JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_keys    TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_upsell_settings_history ON ai_checkout_upsell_settings_history (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_upsell_recs_activity ON ai_checkout_upsell_recommendations (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS checkout_upsell_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_upsell_health_recent ON checkout_upsell_health_runs (tenant_id, created_at DESC);
