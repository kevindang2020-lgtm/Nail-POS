-- 611_payroll_payouts_and_exports.sql — Payroll mandate §78–§84 (Oct 12 2026, wave 2).
--
--   payroll_payouts — what was actually PAID to a technician for an approved period (§78: earned ≠ paid). One row per
--     payment (cash, check, direct deposit, an external provider run, other). Status PENDING → PROCESSING → PAID /
--     FAILED / CANCELED (lowercase vocabulary, machine PAYROLL_PAYOUT in modules/workforce payroll.dto.ts). §149: the
--     service refuses a payout that would take Σ(non-failed, non-canceled) above the line's payable_cents — under the
--     period row lock, so two cashiers recording at once cannot overpay. idempotency_key (per tenant) makes a retried
--     "record payout" one row. Never deleted (§125): a mistake is CANCELED and a new row is written.
--     Not a customer card payment (§81) — it never touches payments / payment_refunds.
--   payroll_exports — the audit of every payroll export (§83): who, which period, format, when, how many rows, and the
--     sha256 of the exact bytes handed out. The file itself is NOT stored and never gets a public URL (§84): the bytes
--     go back on the authorized response only.
-- EXPAND-ONLY, idempotent. Writer: modules/workforce payroll (payroll-payouts.ts, payroll-export.ts).
CREATE TABLE IF NOT EXISTS payroll_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  period_id        UUID NOT NULL,
  technician_id    UUID NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  method           TEXT NOT NULL CHECK (method IN ('cash', 'check', 'direct_deposit', 'external_provider', 'other')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'canceled')),
  reference        TEXT,
  note             TEXT,
  failure_reason   TEXT,
  idempotency_key  TEXT,
  paid_at          TIMESTAMPTZ,
  created_by       UUID,
  updated_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_payouts_tenant_idem ON payroll_payouts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_payouts_period   ON payroll_payouts (tenant_id, period_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payouts_tech     ON payroll_payouts (tenant_id, technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_payouts_status   ON payroll_payouts (tenant_id, status);

CREATE TABLE IF NOT EXISTS payroll_exports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  period_id      UUID NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('csv', 'xlsx')),
  row_count      INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL,
  period_status  TEXT NOT NULL,
  period_version INTEGER NOT NULL,
  exported_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_exports_period ON payroll_exports (tenant_id, period_id, created_at DESC);
