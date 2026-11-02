-- 173_worker_transfer_requests.sql — controlled worker branch-transfer requests (§30).
-- A worker's branch assignment is reassigned through a REVIEWED request, not a silent edit: the request is recorded
-- first (status 'requested'); the actual move (users.branch_id update) happens only on explicit approval, and every
-- state change is audited. Same-tenant branch moves only — cross-tenant worker moves (§31) are a separate process.
CREATE TABLE IF NOT EXISTS worker_transfer_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_branch_id       UUID REFERENCES branches (id) ON DELETE SET NULL,
  to_branch_id         UUID NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','approved','rejected','cancelled')),
  reason               TEXT NOT NULL,
  requested_by_user_id UUID,
  reviewed_by_user_id  UUID,
  reviewed_at          TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_transfer_requests_user ON worker_transfer_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_worker_transfer_requests_status ON worker_transfer_requests (status);
CREATE INDEX IF NOT EXISTS idx_worker_transfer_requests_tenant ON worker_transfer_requests (tenant_id);
