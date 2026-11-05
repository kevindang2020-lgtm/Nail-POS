-- 017_checkout_payments.sql — AIPowerSalon Checkout & Payment workflow. Idempotent.
-- Builds on 015 (payments money cols, customer_display_*, checkout_settings). Adds payment attempts
-- with idempotency, receipt delivery logs, and the ticket checkout/payment columns + indexes.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS station_label TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subtotal_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS surcharge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS total_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS locked_total_cents INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ready_checkout_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS processor_transaction_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  ticket_id          UUID NOT NULL,
  amount_cents       INTEGER NOT NULL,
  method             TEXT NOT NULL,
  processor          TEXT,
  status             TEXT NOT NULL DEFAULT 'processing',
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS receipt_delivery_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID NOT NULL,
  ticket_id   UUID NOT NULL,
  channel     TEXT NOT NULL,            -- sms | email | app | print
  destination TEXT,
  status      TEXT NOT NULL DEFAULT 'sent',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_checkout_ready
  ON tickets (tenant_id, branch_id, status, ready_checkout_at);
CREATE INDEX IF NOT EXISTS idx_tickets_checkout_paid
  ON tickets (tenant_id, branch_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_ticket
  ON payments (tenant_id, branch_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_ticket
  ON payment_attempts (tenant_id, branch_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_receipt_delivery_ticket
  ON receipt_delivery_logs (tenant_id, branch_id, ticket_id);
