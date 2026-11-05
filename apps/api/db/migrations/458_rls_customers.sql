-- 458_rls_customers.sql — Postgres ROW-LEVEL SECURITY, first table: customers (Constitution 12 defence in depth).
--
-- The policy admits a row only when it belongs to the session's tenant (app.tenant_id), OR when no tenant is set.
-- The app sets app.tenant_id per request ONLY when DB_TENANT_RLS=1 (packages/database tenant-session.ts); with the flag
-- off the setting is never set, every query sees what it saw before, and this migration changes nothing. Workers, Super
-- Admin and migrations run with no tenant and stay unrestricted — cross-tenant is their job.
-- FORCE applies the policy to the table OWNER too (the app role usually owns the tables; without FORCE it would bypass).
-- One table first, deliberately: measure it with the flag on before extending to the other tenant tables.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR tenant_id::text = current_setting('app.tenant_id', true));
