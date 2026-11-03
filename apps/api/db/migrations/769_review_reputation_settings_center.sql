-- 769_review_reputation_settings_center.sql — Review & Reputation Settings guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE review_reputation_settings_health_runs; DROP TRIGGER trg_ai_reputation_config_versions_append_only
-- ON ai_reputation_config_versions; ALTER TABLE ai_reputation_config_versions DROP COLUMN event_type, before, changed_keys, reason, actor_role.
--
-- The settings stay in tenant_ai_reputation_settings (migration 343: tenant / branch layers over the platform defaults,
-- resolved by resolveSettings — the one resolver drafting and the checkout review-request hook read). Its version column
-- already existed but nothing checked it. The existing ai_reputation_config_versions log becomes the History:
--   • event_type / before / changed_keys / reason / actor_role — so a change can be explained (who, role, what moved, why);
--     rows written before this migration read as 'settings_changed' with no "before".
--   • append-only — a recorded change can no longer be edited or deleted.
--   • review_reputation_settings_health_runs — the read-only "Check Reputation Settings" run's evidence.

ALTER TABLE ai_reputation_config_versions ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'settings_changed';
ALTER TABLE ai_reputation_config_versions ADD COLUMN IF NOT EXISTS before JSONB;
ALTER TABLE ai_reputation_config_versions ADD COLUMN IF NOT EXISTS changed_keys TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ai_reputation_config_versions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE ai_reputation_config_versions ADD COLUMN IF NOT EXISTS actor_role TEXT;
DO $$ BEGIN
  ALTER TABLE ai_reputation_config_versions ADD CONSTRAINT ai_reputation_config_versions_event_type_chk
    CHECK (event_type IN ('settings_changed', 'assistant_enabled', 'assistant_disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ai_reputation_config_versions ADD CONSTRAINT ai_reputation_config_versions_reason_len_chk CHECK (reason IS NULL OR length(reason) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_ai_reputation_config_versions_recent ON ai_reputation_config_versions (tenant_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION ai_reputation_config_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_reputation_config_versions is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_ai_reputation_config_versions_append_only ON ai_reputation_config_versions;
CREATE TRIGGER trg_ai_reputation_config_versions_append_only BEFORE UPDATE OR DELETE ON ai_reputation_config_versions
  FOR EACH ROW EXECUTE FUNCTION ai_reputation_config_versions_append_only();

CREATE TABLE IF NOT EXISTS review_reputation_settings_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_review_reputation_settings_health_recent ON review_reputation_settings_health_runs (tenant_id, created_at DESC);
