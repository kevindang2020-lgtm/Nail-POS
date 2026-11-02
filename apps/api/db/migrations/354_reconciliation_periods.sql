-- 328_reconciliation_periods.sql — accounting periods for AI Deposit Reconciliation. Closing a period is gated
-- by a guard (in the service) that blocks closure over unresolved material exceptions. Tenant-isolated.
CREATE TABLE IF NOT EXISTS reconciliation_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  label               TEXT NOT NULL,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',   -- open | closed
  closed_by_user_id   UUID,
  closed_at           TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recon_periods_tenant ON reconciliation_periods (tenant_id, period_end DESC);
