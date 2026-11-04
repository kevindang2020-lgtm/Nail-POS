-- 798_invoice_deliveries.sql — Invoices guide (Nov 4 2026) §14 "Email and SMS": sending an issued invoice to the customer
-- through the salon's configured sender (TenantMessenger — opt-outs, credits and the notifications ledger are enforced
-- there). One row per attempt, claimed BEFORE the provider call (submitting → submitted / blocked / failed / simulated),
-- so a retry with the same key never sends twice. "Submitted" is not "delivered": delivery is read from the notifications
-- ledger row the provider's signed status callback moves (notification_id). The destination is the invoice's bill-to
-- snapshot as it was sent — never inferred.
CREATE TABLE IF NOT EXISTS invoice_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  channel          TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  destination      TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('submitting', 'submitted', 'simulated', 'blocked', 'failed', 'unknown')),
  reason           TEXT,
  provider_id      TEXT,
  notification_id  UUID,
  idempotency_key  TEXT NOT NULL,
  created_by       UUID,
  updated_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_deliveries_idem ON invoice_deliveries (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_invoice_deliveries_invoice ON invoice_deliveries (tenant_id, invoice_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_tc_invoice_deliveries__invoice_id ON invoice_deliveries;
CREATE TRIGGER trg_tc_invoice_deliveries__invoice_id BEFORE INSERT OR UPDATE OF tenant_id, invoice_id ON invoice_deliveries
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('invoices', 'invoice_id');
