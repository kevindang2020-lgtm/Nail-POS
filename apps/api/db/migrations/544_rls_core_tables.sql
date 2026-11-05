-- 544_rls_core_tables.sql — Constitution 1 §6 / Constitution 12: row-level security extended from `customers` (458/517) to
-- the core money, POS and identity tables, with a STRICT mode and an explicit cross-tenant marker.
--
-- The session settings (written by packages/database/src/tenant-session.ts — and only when DB_TENANT_RLS=1):
--   app.tenant_id = '<uuid>'  a salon's request: only that salon's rows are visible / writable.
--   app.tenant_id = '*'       deliberate cross-tenant work: Super Admin, runAcrossTenants(reason), workers and code that
--                             runs outside any request (schedulers, start-up). Every row.
--   app.tenant_id = '' / unset  a request that carries NO tenant. Permissive by default (what 458 shipped), and matches
--                             NOTHING when app.tenant_strict = 'on' (DB_TENANT_RLS_STRICT=1) — fail closed.
--   anything else (not a uuid) matches nothing.
-- With DB_TENANT_RLS unset nothing is ever set: the setting is '' / unset, not strict, every policy admits every row —
-- this migration changes no query result until the flag is turned on.
--
-- Performance (Constitution 1 audit bug 9): the policy compares `tenant_id = app_session_tenant()` — a STABLE sql
-- function returning uuid — so the tenant_id index is usable (458's `tenant_id::text = …` defeated it).
-- FORCE applies the policy to the table owner too (the app role usually owns the tables). A superuser and a role with
-- BYPASSRLS are never subject to RLS — the live trial (apps/api/scripts/live-rls-trial.mjs) runs as a plain role.

CREATE OR REPLACE FUNCTION app_session_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN current_setting('app.tenant_id', true)::uuid END
$$;

CREATE OR REPLACE FUNCTION app_session_unrestricted() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(current_setting('app.tenant_id', true), '') = '*'
      OR (coalesce(current_setting('app.tenant_id', true), '') = ''
          AND coalesce(current_setting('app.tenant_strict', true), '') <> 'on')
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'tickets', 'ticket_service_lines', 'payments', 'payment_refunds', 'pos_tech_appointments',
                           'pos_queue_items', 'customer_loyalty_profiles', 'loyalty_ledger', 'appointments', 'users']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_session_unrestricted() OR tenant_id = app_session_tenant()) '
                   'WITH CHECK (app_session_unrestricted() OR tenant_id = app_session_tenant())', t);
  END LOOP;
END $$;
