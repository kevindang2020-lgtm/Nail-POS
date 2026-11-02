-- 104_platform_branding.sql — platform branding overrides (single-row). Logo asset stays LOCKED in code/assets;
-- only colour/tagline overrides are stored here. Platform-scoped (no tenant_id). Audited via audit_logs.
CREATE TABLE IF NOT EXISTS platform_branding (
  id          INT PRIMARY KEY DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_branding_singleton CHECK (id = 1)
);
