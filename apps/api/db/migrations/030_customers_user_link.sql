-- 030_customers_user_link.sql — link a customer record to a login user (the customer-app identity).
-- Nullable so existing front-desk-created customers (no login) are unaffected; unique per tenant so one user maps to at
-- most one customer within a tenant. This is the decided answer to the previously-open `customers.user_id` question.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_user ON customers (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers (user_id) WHERE user_id IS NOT NULL;
