-- 174_worker_cross_tenant_transfer_requests.sql — controlled cross-tenant worker transfers (§31).
-- HIGHER RISK than a same-tenant branch move (173). A cross-tenant transfer is NEVER a silent tenant swap: it is a
-- reviewed REQUEST (status 'requested') that, on approval, only RECORDS the decision. It does NOT provision access,
-- create the destination employment record, move appointments/payroll/commissions/tips/customer data, or expose the
-- source tenant's confidential records to the destination. Actual provisioning (new destination employment, access
-- activation at the effective time, old-access disable, rollback on failure) is a separate execution step performed
-- against live infrastructure — intentionally out of scope for this request/approval log.
CREATE TABLE IF NOT EXISTS worker_cross_tenant_transfer_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_tenant_id       UUID REFERENCES tenants (id) ON DELETE SET NULL,
  to_tenant_id         UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  to_branch_id         UUID REFERENCES branches (id) ON DELETE SET NULL,
  effective_date       DATE,
  status               TEXT NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','approved','rejected','cancelled')),
  reason               TEXT NOT NULL,
  requested_by_user_id UUID,
  reviewed_by_user_id  UUID,
  reviewed_at          TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT worker_cross_tenant_distinct CHECK (from_tenant_id IS NULL OR from_tenant_id <> to_tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_worker_cross_transfer_user ON worker_cross_tenant_transfer_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_worker_cross_transfer_status ON worker_cross_tenant_transfer_requests (status);
CREATE INDEX IF NOT EXISTS idx_worker_cross_transfer_to_tenant ON worker_cross_tenant_transfer_requests (to_tenant_id);
