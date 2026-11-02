-- 429_sms_reconciliation_findings.sql — §58/§59 (Jul 29, 2026, sms-packages P6).
-- Nightly reconciliation FILES what it finds; it never fixes counters or invoices silently (§58). §59 dedupe is
-- structural: at most ONE OPEN finding per (tenant, cycle, type) — a recurring issue updates that row's details
-- night after night instead of minting 100 identical tasks. Resolution is a human act, recorded.
CREATE TABLE IF NOT EXISTS sms_reconciliation_findings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date      DATE NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  cycle_id      UUID REFERENCES tenant_sms_billing_cycles (id),
  finding_type  TEXT NOT NULL CHECK (finding_type IN (
                  'counter_ledger_mismatch',      -- cycle counters disagree with the ledger recount
                  'unbilled_usage_no_package',    -- real verification traffic, no package assigned (§32 package missing)
                  'hard_limit_reached'            -- tenant is stopped at their allowance (§32 limit alert)
                )),
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_recon_open
  ON sms_reconciliation_findings (tenant_id, finding_type, cycle_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sms_recon_status ON sms_reconciliation_findings (status, run_date);
