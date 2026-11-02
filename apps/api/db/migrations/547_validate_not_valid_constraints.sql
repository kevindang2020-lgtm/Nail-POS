-- 547_validate_not_valid_constraints.sql — BUILD_PLAN Phase 10 (Constitution 1 §40, §88, §111 "no dangerous migration
-- remains unresolved").
--
-- Phases 7–9 added foreign keys and CHECKs `NOT VALID` (new rows only) so a deploy never failed on old data — and nothing
-- ever validated them afterwards: 54 constraints on Oct 8 2026, all still enforcing only new writes. This validates every
-- NOT VALID constraint in the public schema, one at a time, each in its own subtransaction:
--   * it validates → done (VALIDATE takes SHARE UPDATE EXCLUSIVE: reads and writes continue);
--   * existing rows break it → the constraint STAYS NOT VALID (still enforced on new writes) and the fact is recorded in
--     schema_deferred_constraints with the exact retry statement, so the Super Admin Database page lists it and
--     scripts/db-validate-constraints.mjs (or the page's "retry") validates it once the data is fixed.
-- Only the SQLSTATE is recorded, never the error detail (which can quote row contents). A fresh database records nothing.
-- Idempotent: a re-run finds nothing NOT VALID (or only the deferred ones, whose ledger row is updated in place).
DO $$
DECLARE r record; v_sql text;
BEGIN
  FOR r IN
    SELECT c.conname, cl.relname AS tbl, c.contype
      FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'public' AND NOT c.convalidated AND c.contype IN ('f', 'c')
     ORDER BY cl.relname, c.conname
  LOOP
    v_sql := format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.tbl, r.conname);
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN others THEN
      PERFORM schema_defer_constraint(r.conname, r.tbl,
        CASE r.contype WHEN 'f' THEN 'foreign_key_validation' ELSE 'check_validation' END,
        '547_validate_not_valid_constraints.sql',
        format('existing rows violate it (SQLSTATE %s); still enforced for new rows', SQLSTATE), NULL, v_sql);
    END;
  END LOOP;
END $$;
