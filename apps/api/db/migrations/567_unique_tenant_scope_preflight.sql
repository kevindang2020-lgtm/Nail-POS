-- 567_unique_tenant_scope_preflight.sql — BUILD_PLAN Phase 15 C (Constitution 1 §35 "a unique rule is tenant-scoped unless
-- the value is global by design", §69–71 "no deploy fails on existing data"; docs/UNIQUE_INDEX_TENANT_REVIEW.md).
--
-- The review of every non-PK unique index on a tenant table that does not include tenant_id (96 on Oct 10 2026) found ONE
-- that refuses a value two salons legitimately share:
--   payment_gateway_events  uq_payment_gateway_events_processed (processor_type, event_id) WHERE processed  (538)
-- The card-processor webhook's duplicate check reads (tenant, processor, event id) — a processor event id is only promised
-- unique inside one merchant's stream, and every salon is its own merchant with its own webhook secret — but the claim
-- index was platform-wide, so salon B's settlement / refund event carrying the same event id as one of salon A's was
-- answered "duplicate" and never applied (unique-tenant-scope.pgtest). It becomes (tenant_id, processor_type, event_id).
--
-- Two files, because the build must not write-lock a live webhook ledger and a CONCURRENTLY build cannot run inside a
-- transaction or a DO block:
--   567 (this file, one transaction) — the PRE-FLIGHT. Widening a unique key cannot create duplicates: while 538's index
--       exists and is valid, the tenant-scoped key is already unique and 568 builds it. Only if 538 itself was DEFERRED on
--       this database (its duplicates were never resolved) can the new key hold duplicates; then the new index is deferred
--       the Phase 10 way (schema_defer_constraint: the count, never row contents, and the exact retry statement) and 538's
--       open deferral is closed as superseded — retrying it would build the platform-wide rule this phase removes.
--   568 (no-transaction) — CREATE UNIQUE INDEX CONCURRENTLY the tenant-scoped index, then DROP INDEX CONCURRENTLY the old
--       one. scripts/migrate.mjs skips a CONCURRENTLY build whose index name has an OPEN deferral (the pre-flight above
--       said the data does not allow it yet); scripts/db-validate-constraints.mjs / the Super Admin Database page builds
--       it once the duplicates are resolved. A fresh database defers nothing.
DO $$
DECLARE n bigint; old_ok boolean;
BEGIN
  IF to_regclass('payment_gateway_events') IS NULL THEN RETURN; END IF;
  SELECT i.indisvalid AND i.indisunique INTO old_ok FROM pg_index i WHERE i.indexrelid = to_regclass('uq_payment_gateway_events_processed');
  IF coalesce(old_ok, false) OR to_regclass('uq_payment_gateway_events_tenant_processed') IS NOT NULL THEN
    n := 0;   -- the platform-wide key is unique, so the wider tenant-scoped key is too (no scan needed)
  ELSE
    SELECT count(*) INTO n FROM (SELECT 1 FROM payment_gateway_events WHERE event_id IS NOT NULL AND processed_at IS NOT NULL
      GROUP BY tenant_id, processor_type, event_id HAVING count(*) > 1) d;
  END IF;
  IF n > 0 THEN
    PERFORM schema_defer_constraint('uq_payment_gateway_events_tenant_processed', 'payment_gateway_events', 'unique', '567_unique_tenant_scope_preflight.sql',
      format('%s duplicate group(s)', n), n::int,
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_gateway_events_tenant_processed ON payment_gateway_events (tenant_id, processor_type, event_id) WHERE event_id IS NOT NULL AND processed_at IS NOT NULL');
  END IF;
  -- A PROCESSED event always belongs to a salon (the webhook resolves the merchant first; unknown merchants are recorded
  -- unprocessed). Said as a CHECK, because the tenant-scoped unique index treats NULL tenants as distinct (PG14 floor:
  -- no NULLS NOT DISTINCT) — without it a processed row with no tenant would escape the dedupe that 538 gave it.
  PERFORM schema_apply_check('payment_gateway_events', 'chk_payment_gateway_events_processed_tenant', 'processed_at IS NULL OR tenant_id IS NOT NULL', '567_unique_tenant_scope_preflight.sql');
  -- 538's deferral (if any) would rebuild the platform-wide rule: superseded by the tenant-scoped one above / in 568.
  UPDATE schema_deferred_constraints SET resolved_at = now(), resolved_by = 'superseded:567_unique_tenant_scope_preflight.sql'
   WHERE name = 'uq_payment_gateway_events_processed' AND table_name = 'payment_gateway_events' AND resolved_at IS NULL;
END $$;
