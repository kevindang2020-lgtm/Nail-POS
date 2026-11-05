-- 177_tenant_entitlement_overrides.sql — tenant-specific overrides, stored SEPARATELY from plan defaults (plan_limits /
-- plan_features) and from the live usage counter (tenant_usage_limits). The effective limit/feature for a tenant is
-- override (if present and unexpired) else the plan default. Overrides never mutate the base plan. Money/limits as BIGINT.

CREATE TABLE IF NOT EXISTS tenant_plan_limit_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  metric         text NOT NULL,                 -- one of the 13 limit metrics
  limit_value    bigint,                         -- NULL = unlimited override
  enforcement    text NOT NULL DEFAULT 'hard',   -- soft|hard
  reason         text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,                    -- NULL = no expiry
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_tenant_limit_overrides_tenant ON tenant_plan_limit_overrides (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  feature_key    text NOT NULL,
  state          text NOT NULL,                  -- enabled|disabled
  reason         text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_feature_overrides_tenant ON tenant_feature_overrides (tenant_id);
