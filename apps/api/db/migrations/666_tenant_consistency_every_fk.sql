-- 666_tenant_consistency_every_fk.sql — B-12 (Oct 20 2026): the same-tenant guard on EVERY tenant→tenant foreign key.
--
-- 450 / 539 attached enforce_tenant_consistency() (a BEFORE INSERT OR UPDATE OF tenant_id, <fk> trigger that refuses a row
-- naming a parent owned by another salon) to 33 hand-picked (table, column) pairs. The remaining single-column foreign
-- keys between two tenant tables — 113 on the Oct 20 schema (deal_services.deal_id, gift_card_adjustments.gift_card_id,
-- pos_queue_items.requested_technician_id, payments.settlement_batch_id, …) — relied on service-layer scoping alone.
--
-- This migration enumerates them FROM THE CATALOG and creates one trigger per uncovered pair, named
-- trg_tc_<child>__<column> (DROP IF EXISTS first, so a re-run is a no-op). Rules of the function are unchanged:
-- NULL tenant on either side is not a mismatch; a missing parent is not this trigger's business; only the FK column and
-- tenant_id fire it. Existing rows are not checked (a trigger guards writes; the IDOR sweep and
-- apps/api/scripts/db-integrity-sweep.mjs report existing crosses). apps/api/src/common/tenant-consistency.pgtest asserts
-- "no uncovered pair" on the migrated schema, so a tenant FK added later without its trigger fails the battery.
--
-- EXCLUDED BY DESIGN — the Tenant Safety Community (`community_*`, modules/safety): the one surface where salons share
-- across tenants. `community_posts` has no tenant_id (origin salon is a separate column); a salon's comment row carries
-- the COMMENTING salon's tenant_id and replies to another salon's comment (`community_comments.parent_id`), and an
-- evidence access is logged under the ACCESSING salon (`community_evidence_access_log.evidence_id`). Those two pairs
-- are the only community FKs between tenant tables; the test pins that they stay trigger-free.
DROP TRIGGER IF EXISTS trg_tc_community_comments__parent_id ON community_comments;               -- draft of this migration
DROP TRIGGER IF EXISTS trg_tc_community_evidence_access_log__evidence_id ON community_evidence_access_log;
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    WITH tenant_tables AS (
      SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ),
    fks AS (
      SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.connamespace = 'public'::regnamespace
    ),
    cand AS (
      SELECT * FROM fks
      WHERE child IN (SELECT t FROM tenant_tables) AND parent IN (SELECT t FROM tenant_tables) AND col <> 'tenant_id'
        AND child NOT LIKE 'community\_%'          -- cross-salon by design (see header)
    ),
    covered AS (
      SELECT replace(tgrelid::regclass::text, 'public.', '') AS child,
             (regexp_match(pg_get_triggerdef(pg_trigger.oid), 'enforce_tenant_consistency\(''[a-z_]+'', ''([a-z_]+)''\)'))[1] AS col
      FROM pg_trigger
      WHERE NOT tgisinternal AND pg_get_triggerdef(pg_trigger.oid) LIKE '%enforce_tenant_consistency%'
    )
    SELECT child, col, parent FROM cand WHERE (child, col) NOT IN (SELECT child, col FROM covered) ORDER BY child, col
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_tc_' || r.child || '__' || r.col, r.child);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF tenant_id, %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency(%L, %L)',
      'trg_tc_' || r.child || '__' || r.col, r.col, r.child, r.parent, r.col);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '666: same-tenant triggers created on % foreign-key column(s)', n;
END $$;
