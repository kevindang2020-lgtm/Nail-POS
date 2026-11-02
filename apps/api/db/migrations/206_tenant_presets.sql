-- 177_tenant_presets.sql
-- Named default-setting bundles applied to new tenants/branches/onboarding. One default preset per scope.
CREATE TABLE IF NOT EXISTS tenant_presets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  scope         text NOT NULL DEFAULT 'tenant',   -- tenant|branch|onboarding
  category_slug text,
  description   text,
  settings      jsonb NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  is_default    boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preset_scope ON tenant_presets (scope, active, name);
-- At most one default preset per scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_preset_default ON tenant_presets (scope) WHERE is_default = true;
