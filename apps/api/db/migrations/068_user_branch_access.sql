-- 068_user_branch_access.sql — Owner Multi-Salon: assign an OWNER (or manager/viewer) to a SUBSET of a tenant's
-- branches. When an owner has rows here, the Owner App restricts every query to exactly these branch_ids; when an
-- owner has NO rows, the legacy "owner sees the whole tenant" behavior is preserved (documented fallback).
CREATE TABLE IF NOT EXISTS user_branch_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT,
  access_level TEXT NOT NULL DEFAULT 'owner',          -- owner | manager | viewer | report_only
  is_primary_owner BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_uba_tenant ON user_branch_access (tenant_id);
CREATE INDEX IF NOT EXISTS idx_uba_branch ON user_branch_access (branch_id);
CREATE INDEX IF NOT EXISTS idx_uba_user ON user_branch_access (user_id);
CREATE INDEX IF NOT EXISTS idx_uba_tenant_user ON user_branch_access (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_uba_tenant_branch ON user_branch_access (tenant_id, branch_id);
