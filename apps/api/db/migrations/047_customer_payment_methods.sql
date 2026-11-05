-- 047_customer_payment_methods.sql — saved cards for the customer app (Profile → Payment Methods) and wallet top-ups.
-- Stores a gateway TOKEN only (CardSecure/CardPointe token in production; a test instrument in sandbox) plus display
-- fields (brand, last4, expiry). The raw card number (PAN) is NEVER stored. Tenant + customer scoped.
CREATE TABLE IF NOT EXISTS customer_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  gateway TEXT NOT NULL DEFAULT 'cardpointe',
  token TEXT NOT NULL,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  cardholder_name TEXT,
  zip_code TEXT,
  card_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_payment_methods_owner ON customer_payment_methods (tenant_id, customer_id, created_at);
