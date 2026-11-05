-- 196_billing_payment_attempts.sql — software-billing payment attempts (tenant → AI PowerSalon). Separate from the
-- merchant `payment_attempts` table (which is customer→salon and requires branch/ticket). Idempotency_key is UNIQUE so a
-- retried charge is never double-submitted; a recovered payment links back to the failed obligation (invoice + the
-- status it recovered from).
CREATE TABLE IF NOT EXISTS billing_payment_attempts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           UUID NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL,
  amount_cents         BIGINT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  provider             TEXT NOT NULL DEFAULT 'fiserv',
  idempotency_key      TEXT NOT NULL UNIQUE,
  recovered_from_status TEXT,
  attempt_number       INTEGER NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_payment_attempts_invoice ON billing_payment_attempts (invoice_id, created_at DESC);
