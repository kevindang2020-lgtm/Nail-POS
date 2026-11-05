-- 540_loyalty_ledger_truth.sql — BUILD_PLAN Phase 10 (Constitution 1 §19–§21, §32, §111 line 7 "duplicates merged"; audit bugs
-- 3 and 4). The loyalty LEDGER becomes the source of truth for points; `customer_loyalty_profiles.points_balance` stays as
-- the materialised balance that every screen reads, and it always equals sum(delta) of the customer's ledger rows.
--
-- Before: four writers changed balances (the payment consumer, skip-line earn, customer-app redeem, checkout reversal)
-- and `PATCH /customers/:id/loyalty` OVERWROTE the balance with no ledger row and no lock; the consumer wrote no ledger
-- row at all; a customer could end up with two profiles (SELECT … FOR UPDATE locks nothing when no row exists yet).
-- After: every change goes through LoyaltyLedgerService (modules/customers/src/loyalty) under a per-customer advisory
-- lock, as ONE ledger row carrying the balance after it. This migration:
--   1. completes the ledger's columns (expand): entry_type, delta, balance_after, reason, source_table/source_id,
--      actor_user_id, request_id; legacy rows are mapped from type/amount/running_balance/description/actor_id;
--   2. keeps the legacy columns filled from the new ones (and vice versa) with a BEFORE INSERT trigger, so the old
--      readers keep working until a later contract step drops them;
--   3. makes a business source unique: (tenant, source_table, source_id, entry_type) — a payment earns once, a void
--      reverses once, a redemption debits once;
--   4. merges duplicate profiles (one per tenant + customer; the oldest survives, balances and totals summed) and, when
--      migration 538 had to defer the profile unique index because of them, applies it now;
--   5. seeds ONE `adjust` row per profile whose ledger sum differs from its balance ("opening balance"), so
--      sum(delta) = points_balance holds for every profile from here on.

-- 1. expand ---------------------------------------------------------------------------------------------------------
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS entry_type     text;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS delta          bigint;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS balance_after  bigint;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS reason         text;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS source_table   text;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS source_id      uuid;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS actor_user_id  uuid;
ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS request_id     text;

-- legacy `type` → the five entry types
CREATE OR REPLACE FUNCTION loyalty_entry_type_of(p_type text, p_amount bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_type IN ('earn', 'redeem', 'adjust', 'reverse', 'merge') THEN p_type
    WHEN p_type LIKE 'earn%' THEN 'earn'
    WHEN p_type LIKE 'redeem%' THEN 'redeem'
    WHEN p_type LIKE '%revers%' OR p_type LIKE 'refund%' OR p_type LIKE 'void%' THEN 'reverse'
    WHEN p_type LIKE 'merge%' THEN 'merge'
    ELSE 'adjust'
  END $$;

UPDATE loyalty_ledger SET
  entry_type    = coalesce(entry_type, loyalty_entry_type_of(type, amount)),
  delta         = coalesce(delta, amount),
  balance_after = coalesce(balance_after, running_balance),
  reason        = coalesce(reason, description),
  actor_user_id = coalesce(actor_user_id, actor_id)
WHERE entry_type IS NULL OR delta IS NULL OR balance_after IS NULL;

-- 2. both column sets stay filled whichever set a writer used ------------------------------------------------------
CREATE OR REPLACE FUNCTION loyalty_ledger_fill_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.delta           := coalesce(NEW.delta, NEW.amount);
  NEW.amount          := coalesce(NEW.amount, NEW.delta);
  NEW.balance_after   := coalesce(NEW.balance_after, NEW.running_balance);
  NEW.running_balance := coalesce(NEW.running_balance, NEW.balance_after);
  NEW.entry_type      := coalesce(NEW.entry_type, loyalty_entry_type_of(NEW.type, NEW.delta));
  NEW.type            := coalesce(NEW.type, NEW.entry_type);
  NEW.reason          := coalesce(NEW.reason, NEW.description);
  NEW.description     := coalesce(NEW.description, NEW.reason);
  NEW.actor_user_id   := coalesce(NEW.actor_user_id, NEW.actor_id);
  NEW.actor_id        := coalesce(NEW.actor_id, NEW.actor_user_id);
  NEW.reference_id    := coalesce(NEW.reference_id, NEW.source_id);
  NEW.source          := coalesce(NEW.source, NEW.source_table, 'ledger');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_loyalty_ledger_fill_columns ON loyalty_ledger;
CREATE TRIGGER trg_loyalty_ledger_fill_columns BEFORE INSERT ON loyalty_ledger FOR EACH ROW EXECUTE FUNCTION loyalty_ledger_fill_columns();

ALTER TABLE loyalty_ledger ALTER COLUMN entry_type SET NOT NULL;
ALTER TABLE loyalty_ledger ALTER COLUMN delta SET NOT NULL;
ALTER TABLE loyalty_ledger ALTER COLUMN balance_after SET NOT NULL;
ALTER TABLE loyalty_ledger DROP CONSTRAINT IF EXISTS loyalty_ledger_entry_type_chk;
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_entry_type_chk CHECK (entry_type IN ('earn', 'redeem', 'adjust', 'reverse', 'merge'));
-- an adjustment always says why (the PATCH /customers/:id/loyalty rule, held by the database too)
ALTER TABLE loyalty_ledger DROP CONSTRAINT IF EXISTS loyalty_ledger_adjust_reason_chk;
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_adjust_reason_chk CHECK (entry_type <> 'adjust' OR length(btrim(coalesce(reason, ''))) > 0) NOT VALID;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM loyalty_ledger WHERE entry_type = 'adjust' AND length(btrim(coalesce(reason, ''))) = 0;
  IF n = 0 THEN EXECUTE 'ALTER TABLE loyalty_ledger VALIDATE CONSTRAINT loyalty_ledger_adjust_reason_chk';
  ELSE PERFORM schema_defer_constraint('loyalty_ledger_adjust_reason_chk', 'loyalty_ledger', 'check_validation', '540_loyalty_ledger_truth.sql',
         format('%s adjust rows without a reason', n), n, 'ALTER TABLE loyalty_ledger VALIDATE CONSTRAINT loyalty_ledger_adjust_reason_chk');
  END IF; END $$;

-- the customer history + the reconcile job read by (tenant, customer) in time order
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_tenant_customer_created ON loyalty_ledger (tenant_id, customer_id, created_at);

-- 3. one ledger row per business source --------------------------------------------------------------------------
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM loyalty_ledger WHERE source_id IS NOT NULL
     GROUP BY tenant_id, source_table, source_id, entry_type HAVING count(*) > 1) d;
  IF n = 0 THEN EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_ledger_source ON loyalty_ledger (tenant_id, source_table, source_id, entry_type) WHERE source_id IS NOT NULL';
  ELSE PERFORM schema_defer_constraint('uq_loyalty_ledger_source', 'loyalty_ledger', 'unique', '540_loyalty_ledger_truth.sql',
         format('%s duplicate source groups', n), n,
         'CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_ledger_source ON loyalty_ledger (tenant_id, source_table, source_id, entry_type) WHERE source_id IS NOT NULL');
       EXECUTE 'CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_source ON loyalty_ledger (tenant_id, source_table, source_id, entry_type) WHERE source_id IS NOT NULL';
  END IF; END $$;

-- 4. duplicate profiles (bug 4): one per (tenant, customer) — the oldest keeps the id, the others' points are added in -
WITH ranked AS (
  SELECT id, tenant_id, customer_id,
         row_number() OVER (PARTITION BY tenant_id, customer_id ORDER BY created_at, id) AS rn
    FROM customer_loyalty_profiles
), extra AS (
  SELECT k.id AS keep_id, sum(p.points_balance) AS pb, sum(p.total_earned_points) AS te, sum(p.total_redeemed_points) AS tr
    FROM ranked r
    JOIN customer_loyalty_profiles p ON p.id = r.id
    JOIN ranked k ON k.tenant_id = r.tenant_id AND k.customer_id = r.customer_id AND k.rn = 1
   WHERE r.rn > 1
   GROUP BY k.id
)
UPDATE customer_loyalty_profiles c
   SET points_balance = c.points_balance + e.pb, total_earned_points = c.total_earned_points + e.te,
       total_redeemed_points = c.total_redeemed_points + e.tr, updated_at = now()
  FROM extra e WHERE c.id = e.keep_id;
DELETE FROM customer_loyalty_profiles p USING (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, customer_id ORDER BY created_at, id) AS rn FROM customer_loyalty_profiles
) r WHERE p.id = r.id AND r.rn > 1;

-- 538 (agent B) defers the (tenant, customer) unique when duplicates exist; they are gone now — apply it and close it.
DO $$ DECLARE d record; BEGIN
  IF to_regclass('schema_deferred_constraints') IS NULL THEN RETURN; END IF;
  FOR d IN SELECT id, retry_sql FROM schema_deferred_constraints
            WHERE table_name = 'customer_loyalty_profiles' AND kind = 'unique' AND resolved_at IS NULL AND retry_sql IS NOT NULL LOOP
    EXECUTE d.retry_sql;
    UPDATE schema_deferred_constraints SET resolved_at = now(), resolved_by = '540_loyalty_ledger_truth.sql' WHERE id = d.id;
  END LOOP;
END $$;
-- and when 538 did not create one under any name, this one holds the rule (no-op when a unique on the pair exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
     WHERE t.relname = 'customer_loyalty_profiles' AND i.indisunique AND i.indpred IS NULL
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY (i.indkey))
           = ARRAY['customer_id', 'tenant_id']
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_loyalty_profiles_tenant_customer ON customer_loyalty_profiles (tenant_id, customer_id)';
  END IF;
END $$;

-- 5. opening balance: every profile's ledger sums to its balance ----------------------------------------------------
INSERT INTO loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, reason, source_table, source_id, type, source)
SELECT p.tenant_id, p.branch_id, p.customer_id, 'adjust', p.points_balance - coalesce(l.s, 0), p.points_balance,
       'opening balance (migration 540: ledger becomes the source of truth)', 'customer_loyalty_profiles', p.id, 'opening_balance', 'migration'
  FROM customer_loyalty_profiles p
  LEFT JOIN (SELECT tenant_id, customer_id, sum(delta) AS s FROM loyalty_ledger GROUP BY tenant_id, customer_id) l
         ON l.tenant_id = p.tenant_id AND l.customer_id = p.customer_id
 WHERE p.points_balance <> coalesce(l.s, 0)
   AND NOT EXISTS (SELECT 1 FROM loyalty_ledger x WHERE x.tenant_id = p.tenant_id AND x.source_table = 'customer_loyalty_profiles'
                     AND x.source_id = p.id AND x.entry_type = 'adjust');

-- the daily reconcile job's alert is one per profile per day (owner_alerts carries the profile in metadata)
CREATE INDEX IF NOT EXISTS idx_owner_alerts_loyalty_reconcile ON owner_alerts (tenant_id, category, created_at) WHERE category = 'loyalty_reconcile';

-- daily summary tables (bug 2): one row per tenant + branch + day (+ service / technician), so the hourly writer upserts.
DO $$ DECLARE r record; n int; BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('tenant_daily_sales_summary',      'uq_tenant_daily_sales_summary',      'tenant_id, branch_id, summary_date'),
      ('tenant_daily_booking_summary',    'uq_tenant_daily_booking_summary',    'tenant_id, branch_id, summary_date'),
      ('tenant_daily_customer_summary',   'uq_tenant_daily_customer_summary',   'tenant_id, branch_id, summary_date'),
      ('tenant_daily_review_summary',     'uq_tenant_daily_review_summary',     'tenant_id, branch_id, summary_date'),
      ('tenant_daily_service_summary',    'uq_tenant_daily_service_summary',    'tenant_id, branch_id, summary_date, service_id'),
      ('tenant_daily_technician_summary', 'uq_tenant_daily_technician_summary', 'tenant_id, branch_id, summary_date, technician_id')
    ) AS v(tbl, idx, cols) LOOP
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I GROUP BY %s HAVING count(*) > 1) d', r.tbl, r.cols) INTO n;
    IF n = 0 THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (%s)', r.idx, r.tbl, r.cols);
    ELSE
      PERFORM schema_defer_constraint(r.idx, r.tbl, 'unique', '540_loyalty_ledger_truth.sql', format('%s duplicate day groups', n), n,
        format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (%s)', r.idx, r.tbl, r.cols));
    END IF;
  END LOOP;
END $$;
