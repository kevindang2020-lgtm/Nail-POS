-- 760_customer_search_center.sql — Customer Search Complete Build Guide (Nov 1 2026).
-- Additive only. Rollback: DROP TABLE customer_search_health_runs; DROP INDEX ix_customers_tenant_created;
-- DROP INDEX ix_customers_tenant_email_lower. No existing row is read or rewritten.
--
-- 1. Check Customer Search System runs are recorded (evidence + a 30-second rate limit per salon). A run never changes a
--    customer, booking, ticket or loyalty row; it only records what it observed.
-- 2. Two read indexes on the canonical customers table (Customer Search keeps no copy of customers): the directory's
--    newest-created-first order with a stable id tie-break, and exact email lookup. Name search uses migration 694's
--    vi_fold trigram index; exact phone uses the existing (tenant_id, normalized_phone) index.

CREATE TABLE IF NOT EXISTS customer_search_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('READY', 'WARNING', 'FAILED', 'UNKNOWN')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_search_health_recent ON customer_search_health_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_customers_tenant_created ON customers (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_customers_tenant_email_lower ON customers (tenant_id, lower(email)) WHERE email IS NOT NULL;
