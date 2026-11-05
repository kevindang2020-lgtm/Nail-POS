-- 386_payment_signatures.sql — cardholder signature captured on the customer-display iPad for a card payment. Idempotent.
--
-- Feature: "payCard signature" (customer-display capture). After a card charge is APPROVED (checkout.payCard or the
-- terminal-capture path records a payments row with method='card', status='approved'), the paired iPad presents a
-- signature pad; the cardholder signs; the display POSTs the drawn signature which lands here, one row per payment.
--
-- Honesty/money rules (same as the rest of the pay path):
--   • This table NEVER affects whether money was captured — the gateway already captured on approval. A missing
--     signature does not un-capture or void anything; it only means the display hasn't advanced to the receipt yet.
--   • One signature per payment: UNIQUE (tenant_id, payment_id) makes the capture idempotent (a double-submit / SSE
--     race can't write two rows), so re-POSTing the same signature is a no-op.
--   • Tenant + branch are stored server-derived from the payment/session, never from the client.
--   • The signature is stored as a PNG data URL (the exact bytes the canvas produced); no PII beyond the drawn mark.
CREATE TABLE IF NOT EXISTS payment_signatures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      UUID NOT NULL,
  payment_id     UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  ticket_id      UUID,
  signature_png  TEXT NOT NULL,          -- 'data:image/png;base64,....' produced by the display's <canvas>.toDataURL
  captured_on    TEXT NOT NULL DEFAULT 'customer_display' CHECK (captured_on IN ('customer_display')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_id)
);
CREATE INDEX IF NOT EXISTS ix_payment_signatures_ticket ON payment_signatures (tenant_id, branch_id, ticket_id);
