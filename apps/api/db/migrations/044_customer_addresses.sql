-- 044_customer_addresses.sql — saved addresses for the customer app (Profile → My Addresses). Tenant + customer scoped;
-- one row may be flagged is_default. CRUD is performed by the customer app for their own addresses only.
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  label TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_owner ON customer_addresses (tenant_id, customer_id, created_at);
