-- 797_invoice_credits.sql — Invoices guide (Nov 4 2026) §13 "Void and corrections": an issued invoice with posted payments
-- is never voided or zeroed; it is corrected with an audited CREDIT NOTE. A credit note lowers what the invoice asks for.
-- When it lowers it below what the customer already paid, the overpaid part is returned to the customer as a recorded
-- REFUND (cash / check / external card / bank transfer — a record, not a card charge) in the same entry.
--   balance = total − Σ credit_cents − (Σ payments − Σ refund_cents)
-- An invoice credited in full (Σ credit_cents = total) is 'credited'. Entries are immutable, like invoice_payments.
CREATE TABLE IF NOT EXISTS invoice_credits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  credit_number         TEXT NOT NULL,
  credit_cents          BIGINT NOT NULL CHECK (credit_cents > 0),
  refund_cents          BIGINT NOT NULL DEFAULT 0 CHECK (refund_cents >= 0 AND refund_cents <= credit_cents),
  refund_method         TEXT CHECK (refund_method IS NULL OR refund_method IN ('cash', 'check', 'card_external', 'bank_transfer', 'other')),
  refund_reference      TEXT,
  reason                TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  issued_on             DATE NOT NULL,
  idempotency_key       TEXT NOT NULL,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_credits_refund_method_chk CHECK (refund_cents = 0 OR refund_method IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_credits_idem ON invoice_credits (tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_credits_number ON invoice_credits (tenant_id, credit_number);
CREATE INDEX IF NOT EXISTS idx_invoice_credits_invoice ON invoice_credits (tenant_id, invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_credits_tenant_issued ON invoice_credits (tenant_id, issued_on);

CREATE OR REPLACE FUNCTION invoice_credits_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'invoice credit notes are immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_invoice_credits_immutable ON invoice_credits;
CREATE TRIGGER trg_invoice_credits_immutable BEFORE UPDATE OR DELETE ON invoice_credits
  FOR EACH ROW EXECUTE FUNCTION invoice_credits_immutable();

-- the credit note's invoice must belong to the same salon (the trigger every tenant FK carries)
DROP TRIGGER IF EXISTS trg_tc_invoice_credits__invoice_id ON invoice_credits;
CREATE TRIGGER trg_tc_invoice_credits__invoice_id BEFORE INSERT OR UPDATE OF tenant_id, invoice_id ON invoice_credits
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('invoices', 'invoice_id');

-- 'credited' joins the invoice status vocabulary (538)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_status_vocab;
SELECT schema_apply_check('invoices', 'chk_invoices_status_vocab', 'status IN (''cancelled'', ''credited'', ''draft'', ''failed'', ''open'', ''paid'', ''partially_paid'', ''past_due'', ''pending'', ''refunded'', ''sent'', ''uncollectible'', ''void'', ''voided'')', '797_invoice_credits.sql');
