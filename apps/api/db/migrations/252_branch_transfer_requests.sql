-- 172_branch_transfer_requests.sql — controlled branch-transfer requests (§33).
-- A branch transfer is a HIGH-RISK reviewed process, NOT a tenant dropdown edit. This table records the REQUEST and a
-- snapshot of the pre-transfer impact; the actual cross-tenant data move is a separate, reviewed/scheduled job and is
-- intentionally NOT performed when the request is created (historical/financial ownership is never silently rewritten).
CREATE TABLE IF NOT EXISTS branch_transfer_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            UUID NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  from_tenant_id       UUID NOT NULL,
  to_tenant_id         UUID NOT NULL,
  status               TEXT NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','approved','rejected','completed','failed','cancelled')),
  reason               TEXT NOT NULL,
  effective_date       DATE,
  impact_snapshot      JSONB,
  requested_by_user_id UUID,
  reviewed_by_user_id  UUID,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branch_transfer_requests_branch ON branch_transfer_requests (branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_transfer_requests_status ON branch_transfer_requests (status);
