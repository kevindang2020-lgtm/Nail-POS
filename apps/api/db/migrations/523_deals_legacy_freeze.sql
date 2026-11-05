-- 523_deals_legacy_freeze.sql — BUILD_PLAN Phase 5, the CONTRACT step (first half) of the deals consolidation.
-- After 522 every read and write goes through the one `deals` domain (the salon-promotions and tenant-promotions services
-- are compatibility adapters over it; the customer app and the AI receptionist read deals). The three legacy stores are
-- now READ-ONLY: a write is refused by the database, so nothing can quietly fork the data again. Their rows stay for one
-- release as the rollback source; dropping the tables is the second half of the contract (a later migration).
CREATE OR REPLACE FUNCTION deals_legacy_store_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is frozen: promotional pricing lives in deals (BUILD_PLAN Phase 5)', TG_TABLE_NAME USING ERRCODE = 'read_only_sql_transaction';
END $$;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['salon_promotions','tenant_promotions','tenant_promotion_redemptions','customer_deals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_frozen ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_frozen BEFORE INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION deals_legacy_store_frozen()', t);
  END LOOP;
END $$;
