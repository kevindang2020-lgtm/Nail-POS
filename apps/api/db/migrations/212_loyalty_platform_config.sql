-- 176_loyalty_platform_config.sql — platform-wide Loyalty configuration for the Super Admin controls (points/reward
-- limits, expiration rules, enabled program types, per-plan feature flags) + reusable default templates. This configures
-- PLATFORM loyalty CAPABILITIES only; it never touches tenant point balances, tiers, earn/redeem history, or redemptions.
-- Singleton config row (scope 'platform'); tenant overrides can be added later via scope = tenant UUID.
CREATE TABLE IF NOT EXISTS loyalty_platform_config (
  scope       TEXT PRIMARY KEY DEFAULT 'platform',   -- 'platform' or a tenant UUID string (future)
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  program_type   TEXT NOT NULL DEFAULT 'points',      -- points | tiered | visit_based | spend_based
  structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_loyalty_templates_active ON loyalty_templates (active, created_at DESC);
