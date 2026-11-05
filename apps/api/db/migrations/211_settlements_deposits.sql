-- 175_settlements_deposits.sql — extends the existing payment_settlements batch spine (migration 038) with the
-- reconciliation / deposit-matching fields the Super Admin "Settlements & Deposits" page needs, and adds an
-- append-only settlement_notes table for internal reconciliation notes. All new columns are nullable or defaulted so
-- existing settlement rows remain valid (they read as honest zeros / nulls until real ingestion populates them —
-- never fabricated). Money stays INTEGER CENTS to match payment_settlements. Nothing here mutates processor source data.

ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS refunds_cents          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS chargebacks_cents      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS adjustments_cents      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS transaction_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS expected_net_cents     INTEGER;              -- null → derive
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS actual_deposit_cents   INTEGER;              -- null = no deposit observed yet
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS expected_deposit_date  DATE;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS actual_deposit_date    DATE;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS funding_account_last4  TEXT;                 -- masked suffix ONLY, never full
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS reconciliation_status  TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS signed_difference_cents INTEGER;             -- signed: actual − expected, null when no actual
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS merchant_account_id    UUID;                 -- optional link to the merchant/gateway account

CREATE INDEX IF NOT EXISTS ix_settlements_tenant_branch   ON payment_settlements (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS ix_settlements_processor       ON payment_settlements (processor_type);
CREATE INDEX IF NOT EXISTS ix_settlements_status          ON payment_settlements (status);
CREATE INDEX IF NOT EXISTS ix_settlements_recon_status    ON payment_settlements (reconciliation_status);
CREATE INDEX IF NOT EXISTS ix_settlements_expected_date   ON payment_settlements (expected_deposit_date);
CREATE INDEX IF NOT EXISTS ix_settlements_actual_date     ON payment_settlements (actual_deposit_date);

-- Append-only internal reconciliation notes (never overwritten; edits are new rows). No bank/processor secrets stored.
CREATE TABLE IF NOT EXISTS settlement_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id    UUID NOT NULL,                 -- payment_settlements.id
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  category         TEXT NOT NULL DEFAULT 'general',
  body             TEXT NOT NULL,
  author_user_id   UUID,
  author_role      TEXT,
  support_case_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_settlement_notes_settlement ON settlement_notes (settlement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_settlement_notes_tenant     ON settlement_notes (tenant_id);
