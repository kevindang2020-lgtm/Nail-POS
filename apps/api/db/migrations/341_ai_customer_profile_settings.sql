-- 320_ai_customer_profile_settings.sql — per-scope settings for the AI Customer Profile Assistant.
-- One row per (tenant, level, scope target). `enabled` is a tri-state kill switch (NULL = inherit); when FALSE at any
-- level the assistant is disabled for that scope (§65 emergency controls). `tunables` holds numeric threshold overrides
-- as JSONB (NULL = inherit). Tenant-scoped; branch_id/user_id are NULL except at their own level. No customer data here.
CREATE TABLE IF NOT EXISTS ai_customer_profile_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('tenant','branch','user')),
  branch_id   UUID,                                   -- set only when level = 'branch'
  user_id     UUID,                                   -- set only when level = 'user'
  enabled     BOOLEAN,                                -- NULL = inherit; FALSE = disable this scope
  tunables    JSONB,                                  -- NULL = inherit; partial ProfileTunables override
  updated_by_user_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one settings row per scope target
CREATE UNIQUE INDEX IF NOT EXISTS ai_customer_profile_settings_scope
  ON ai_customer_profile_settings (tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ai_customer_profile_settings_tenant ON ai_customer_profile_settings (tenant_id);
