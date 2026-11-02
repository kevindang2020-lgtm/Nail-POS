-- 013_workflow.sql — AIPowerSalon workflow tail (Queue / Tech Queue / Service Done / Checkout). Idempotent.
-- payments/receipts created only if your schema lacks them; otherwise just the read indexes apply.

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  ticket_id       UUID NOT NULL,
  method          TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  tip_cents       INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'completed',
  created_by_user_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  branch_id    UUID NOT NULL,
  ticket_id    UUID NOT NULL,
  payment_id   UUID,
  receipt_number TEXT NOT NULL,
  emailed_to   TEXT,
  total_cents  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_status_created2
  ON tickets (tenant_id, branch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch_created_method2
  ON payments (tenant_id, branch_id, created_at, method);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant_branch_ticket
  ON receipts (tenant_id, branch_id, ticket_id);
