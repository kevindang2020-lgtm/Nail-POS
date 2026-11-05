-- 325_bank_accounts_deposits.sql — the bank side of AI Deposit Reconciliation. Existing tables cover the POS/
-- processor side (payment_settlements, partner_payouts, chargebacks, revenue_adjustments); this adds the bank
-- layer so settlements/payouts can be reconciled against real bank deposits. Money is integer cents. SECURITY:
-- full account numbers are NEVER stored — only a masked display value + last4. Tenant isolation is enforced by
-- tenant_id on every row and tenant-scoped queries in the repo.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  nickname           TEXT NOT NULL,
  bank_name          TEXT,
  account_type       TEXT NOT NULL DEFAULT 'checking',   -- checking | savings | other
  account_last4      TEXT,                                -- last 4 only; full number never stored
  currency           TEXT NOT NULL DEFAULT 'USD',
  status             TEXT NOT NULL DEFAULT 'active',      -- active | inactive
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bank_accounts_tenant ON bank_accounts (tenant_id, status);

CREATE TABLE IF NOT EXISTS bank_deposits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  branch_id               UUID,
  bank_account_id         UUID NOT NULL,
  amount_cents            BIGINT NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'USD',
  deposit_date            DATE,
  posted_at               TIMESTAMPTZ,
  description             TEXT,
  reference               TEXT,                            -- bank reference / descriptor
  external_bank_txn_id    TEXT,                            -- external bank transaction id (idempotency)
  source                  TEXT NOT NULL DEFAULT 'manual',  -- manual | csv_import | bank_feed
  status                  TEXT NOT NULL DEFAULT 'posted',  -- pending | posted | returned
  matched_settlement_id   UUID,                            -- payment_settlements.id when reconciled
  reconciliation_status   TEXT NOT NULL DEFAULT 'unmatched', -- unmatched | matched | matched_with_tolerance
  import_batch_id         UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bank_deposits_tenant ON bank_deposits (tenant_id, deposit_date);
CREATE INDEX IF NOT EXISTS ix_bank_deposits_account ON bank_deposits (tenant_id, bank_account_id);
-- Idempotency: a given external bank transaction is imported at most once per tenant+account.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_deposits_external
  ON bank_deposits (tenant_id, bank_account_id, external_bank_txn_id)
  WHERE external_bank_txn_id IS NOT NULL;
