-- 784_ai_receptionist_settings_versions.sql — AI Receptionist Settings guide (Nov 3 2026). Additive only.
-- A save used to overwrite the row with no version and no history. Now: a row version (a save made from an older screen is
-- refused instead of silently overwriting someone else's change) and one history row per saved version (before / after /
-- changed keys / who), so a change can be compared and restored.
-- Rollback: DROP TABLE ai_receptionist_settings_history; ALTER TABLE ai_receptionist_settings DROP COLUMN version;
ALTER TABLE ai_receptionist_settings ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ai_receptionist_settings_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID NOT NULL,
  version        INTEGER NOT NULL,
  settings       JSONB NOT NULL,
  before         JSONB,
  changed_keys   TEXT[] NOT NULL DEFAULT '{}',
  actor_user_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, version)
);
CREATE INDEX IF NOT EXISTS ix_air_settings_history ON ai_receptionist_settings_history (tenant_id, branch_id, created_at DESC);
