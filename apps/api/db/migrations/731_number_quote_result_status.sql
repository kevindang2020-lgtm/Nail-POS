-- 731_number_quote_result_status.sql — state-machine sweep (Oct 30 2026, check:state-transitions W1).
-- EXPAND-ONLY and idempotent. tenant_number_purchase_quotes.result_status was NULL until the purchase finished, so the
-- one-shot outcome write could not run through a state machine (a machine has no "from nothing" move). A quote now
-- starts as 'quoted'; confirming it moves it once to 'purchased' or 'failed' (TENANT_NUMBER_PURCHASE_QUOTE in
-- modules/communications/src/communications-lifecycles.ts) and a finished outcome is never overwritten.
--   + 'quoted' in the CHECK (NULL stays allowed so a rolling deploy's older writer still works)
--   + DEFAULT 'quoted'
--   bounded backfill: existing quotes without an outcome become 'quoted' (their consumed_at keeps "in progress" meaning)
-- Nothing is dropped except the CHECK it widens (re-added in the same statement block). No money or number is touched.

ALTER TABLE tenant_number_purchase_quotes DROP CONSTRAINT IF EXISTS ck_tnpq_result;
ALTER TABLE tenant_number_purchase_quotes ADD CONSTRAINT ck_tnpq_result
  CHECK (result_status IS NULL OR result_status = ANY (ARRAY['quoted'::text, 'purchased'::text, 'failed'::text]));
ALTER TABLE tenant_number_purchase_quotes ALTER COLUMN result_status SET DEFAULT 'quoted';

UPDATE tenant_number_purchase_quotes SET result_status = 'quoted'
 WHERE id IN (SELECT q.id FROM tenant_number_purchase_quotes q WHERE q.result_status IS NULL LIMIT 50000);
