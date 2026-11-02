-- 322_invoices.sql — salon-issued customer invoices (bill-later / documented charges), distinct from
-- immediate checkout. An invoice has a lifecycle (draft -> sent -> paid, or void) and line items. Money
-- is integer cents. Separate from platform billing_invoices (subscription) and hardware_payment_invoices.
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID,
  customer_id       UUID,
  invoice_number    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | paid | void
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  subtotal_cents    BIGINT NOT NULL DEFAULT 0,
  tax_cents         BIGINT NOT NULL DEFAULT 0,
  total_cents       BIGINT NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by_user_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices (tenant_id, status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID NOT NULL,
  tenant_id         UUID NOT NULL,
  description       TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price_cents  BIGINT NOT NULL DEFAULT 0,
  line_total_cents  BIGINT NOT NULL DEFAULT 0,
  position          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);
