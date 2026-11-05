-- 042_customer_wallet_ledger.sql — customer store-credit ("wallet") as an APPEND-ONLY, integer-cent ledger.
-- The balance is always SUM(amount_cents) over a (tenant_id, customer_id) — there is no mutable balance column, so it
-- can't drift. Money is integer cents. Scoped per tenant: a customer who visits two salons has two independent wallets;
-- Tenant A funds never mix with Tenant B. Postings are idempotent via a unique (tenant_id, idempotency_key) so a retried
-- top-up/payment can never double-post. amount_cents is signed: credits (top_up/refund/promo) are > 0, debits (payment)
-- are < 0; adjustment/reversal may be either sign. Rows are never updated or deleted (corrections are new reversal rows).
CREATE TABLE IF NOT EXISTS customer_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('top_up','refund','adjustment','payment','reversal','promo')),
  currency TEXT NOT NULL DEFAULT 'USD',
  reference TEXT,
  idempotency_key TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_ledger_balance ON customer_wallet_ledger (tenant_id, customer_id, created_at);
-- One posting per idempotency key per tenant → retried top-ups / payments never double-credit or double-debit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_wallet_ledger_idem ON customer_wallet_ledger (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
