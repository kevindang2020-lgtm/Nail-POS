-- 517_tenant_checks_use_the_index.sql — Phase 1 of BUILD_PLAN_2026-10-06 (Constitution 1 audit, Oct 6 2026).
--
-- 1. The tenant-consistency trigger (migration 450) looked up the parent row with `WHERE id::text = $1`. Casting the KEY
--    to text means Postgres cannot use the primary-key index: every insert into tickets, payments, appointments, queue
--    items, refunds, payment intents, customers, technicians, gift cards and memberships read the WHOLE parent table
--    (customers / tickets / technicians / branches / payments), once per checked column. Harmless on a dev database,
--    a full table scan per write at 10,000 salons. Every parent `id` and every checked child column is a UUID, so the
--    value is cast instead of the key: `WHERE id = $1::uuid` is an index lookup. Behaviour is otherwise identical.
CREATE OR REPLACE FUNCTION enforce_tenant_consistency() RETURNS trigger AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_column    text := TG_ARGV[1];
  ref_id       text := to_jsonb(NEW) ->> fk_column;
  parent_tenant uuid;
BEGIN
  IF NEW.tenant_id IS NULL OR ref_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1::uuid', parent_table) INTO parent_tenant USING ref_id;
  IF parent_tenant IS NOT NULL AND parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant reference refused: %.% names a % row owned by another tenant', TG_TABLE_NAME, fk_column, parent_table
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 2. The customers row-level-security policy (migration 458) compared `tenant_id::text` with the setting — the same
--    defeat of the tenant_id index on every customer query once DB_TENANT_RLS is turned on. The setting is cast instead.
--    Semantics unchanged: no tenant set ('' or unset) is permissive (Super Admin, workers); a set tenant sees only its rows.
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
