-- 034_checkout_persistence.sql
-- Persist the checkout per-ticket working state and payment idempotency that previously lived in-process in the
-- Kysely adapter. This makes an in-flight checkout survive a server restart and makes card-payment retries truly
-- idempotent at the database layer (the processor already dedupes on its side via the same key).
--
-- tickets: the chosen tip, the chosen payment method, and a "locked" total (the amount shown to the customer at the
--          moment they were asked to pay — frozen so a late settings/tip change can't move the figure mid-payment).
-- payments: the idempotency key (card flow) + the change due (cash flow). A partial UNIQUE index dedupes payments by
--           (tenant, idempotency_key) so a retried card charge can never create a second payment row.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS chosen_payment_method TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS locked_total_cents INTEGER;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS change_due_cents INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_idem_uq
  ON payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
