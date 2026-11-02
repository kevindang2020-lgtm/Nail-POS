-- 045_customer_deals.sql — salon promotions shown in the customer app (Home → Deals). Tenant scoped, read-only for the
-- customer (created by the salon). Only active, in-window rows are surfaced.
CREATE TABLE IF NOT EXISTS customer_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  code TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_deals_active ON customer_deals (tenant_id, active, sort_order);
