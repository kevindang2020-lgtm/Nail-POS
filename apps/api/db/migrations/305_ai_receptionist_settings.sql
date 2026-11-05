-- 305_ai_receptionist_settings.sql — receptionist-level runtime settings, one row per (tenant, branch) scope. This
-- holds ONLY settings that are specific to the AI receptionist and don't already live elsewhere (enable flag,
-- default language, after-hours behavior, call-recording consent, interruption/silence behavior, max call duration).
-- Booking rules and notification preferences are NOT stored here — those remain their existing source of truth and
-- the Settings UI links out to them. Stored as JSONB so the shape can evolve without a migration per key.

CREATE TABLE IF NOT EXISTS ai_receptionist_settings (
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',  -- sentinel = tenant-wide
  settings           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id)
);
