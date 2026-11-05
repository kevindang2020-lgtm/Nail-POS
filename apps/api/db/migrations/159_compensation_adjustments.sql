-- 159_compensation_adjustments.sql — append-only ledger for refund/void/chargeback reversals (§21) and manual
-- adjustments (§24). The immutable compensation snapshot (157) is NEVER edited; corrections live here as SIGNED entries
-- (negative for reversals). Reports/payroll sum snapshot + ledger. Chargebacks land as 'pending_review' exceptions;
-- a refund after a paid period targets a FUTURE period (targets_future_period = true) and stays 'pending' until approved.
-- Tenant/branch scoped; no rows seeded. Money is integer cents.
CREATE TABLE IF NOT EXISTS compensation_adjustments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  technician_id          UUID,
  ticket_id              UUID,
  service_line_id        UUID,
  period_id              UUID,
  category               TEXT NOT NULL,
  amount_cents           BIGINT NOT NULL,             -- signed
  reason                 TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','applied','pending_review')),
  source                 TEXT NOT NULL CHECK (source IN ('refund','void','chargeback','manual')),
  targets_future_period  BOOLEAN NOT NULL DEFAULT false,
  requested_by           UUID,
  approved_by            UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_adj_tenant_tech ON compensation_adjustments (tenant_id, technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_adj_ticket      ON compensation_adjustments (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_comp_adj_status      ON compensation_adjustments (tenant_id, status, created_at DESC);
