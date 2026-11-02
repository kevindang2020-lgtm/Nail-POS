-- 767_customer_ai_settings_center.sql — Customer AI Settings guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE customer_ai_settings_health_runs, ai_customer_profile_settings_events;
-- ALTER TABLE ai_customer_profile_settings DROP COLUMN version.
--
-- The settings themselves stay in ai_customer_profile_settings (migration 341: tenant / branch / user layers over the code
-- defaults, resolved by resolveSettings). This adds what the Settings screen could not show or protect:
--   • ai_customer_profile_settings.version — optimistic concurrency for the salon-level row (a second tab cannot silently
--                                             overwrite the first).
--   • ai_customer_profile_settings_events  — append-only history of every change made through the POS: who, role, when,
--                                             before / after, reason, resulting version. (Before this, a change left only
--                                             a fire-and-forget audit line and the row's updated_at.)
--   • customer_ai_settings_health_runs     — the read-only Check Customer AI System run's evidence.

ALTER TABLE ai_customer_profile_settings ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ai_customer_profile_settings_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  level         TEXT NOT NULL CHECK (level IN ('tenant', 'branch', 'user')),
  branch_id     UUID,
  user_id       UUID,
  event_type    TEXT NOT NULL CHECK (event_type IN ('assistant_enabled', 'assistant_disabled', 'thresholds_changed', 'thresholds_reset')),
  before        JSONB NOT NULL DEFAULT '{}'::jsonb,
  after         JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_keys  TEXT[] NOT NULL DEFAULT '{}',
  reason        TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  version       INTEGER NOT NULL,
  actor_user_id UUID,
  actor_role    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_cp_settings_events_recent ON ai_customer_profile_settings_events (tenant_id, created_at DESC, id DESC);
CREATE OR REPLACE FUNCTION ai_customer_profile_settings_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_customer_profile_settings_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_ai_customer_profile_settings_events_append_only ON ai_customer_profile_settings_events;
CREATE TRIGGER trg_ai_customer_profile_settings_events_append_only BEFORE UPDATE OR DELETE ON ai_customer_profile_settings_events
  FOR EACH ROW EXECUTE FUNCTION ai_customer_profile_settings_events_append_only();

CREATE TABLE IF NOT EXISTS customer_ai_settings_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_ai_settings_health_recent ON customer_ai_settings_health_runs (tenant_id, created_at DESC);
