-- 539_versions_consistency_ids_settlement.sql — BUILD_PLAN Phase 10 (Constitution 1 §40 optimistic concurrency, §29–32
-- tenant consistency, §33 id types, §19 payments ↔ settlements). Uses the pre-flight helpers from 538.

-- ── 1. Optimistic concurrency (§40). The two mutable tables the audit found without a version column.
--    inventory_location_stock: every UPDATE bumps the version (the recompute upsert and the per-location overrides),
--    and the overrides route honours expectedVersion (409 VERSION_CONFLICT on a stale write).
--    technician_schedules: a schedule is a SET of rows replaced as a whole; the repository writes version = previous + 1
--    on every row and refuses a stale expectedVersion (409) under a lock on the technician.
ALTER TABLE inventory_location_stock ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE technician_schedules ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN NEW.version := coalesce(OLD.version, 0) + 1; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_location_stock_version ON inventory_location_stock;
CREATE TRIGGER trg_inventory_location_stock_version BEFORE UPDATE ON inventory_location_stock FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- ── 2. Tenant consistency (§29–32): the triggers of 450/517 extended to five more parent links. Same function, same
--    rules (NULL is not a mismatch; a missing parent is left to the foreign keys). Each one is also a Constitution 11
--    integrity INVARIANT (apps/api/src/observability/integrity-checks.ts) so detection and prevention stay identical.
--    payment_refunds → payments already had its trigger (450: trg_tc_refund_payment).
--    gift_card_transactions are checked against the CARD only: a shared-program redemption books the ledger row at the
--    issuing salon (checkout.kysely.repository) while its ticket_id belongs to the redeeming salon — by design.
DROP TRIGGER IF EXISTS trg_tc_ticket_line_ticket ON ticket_service_lines;
CREATE TRIGGER trg_tc_ticket_line_ticket BEFORE INSERT OR UPDATE OF tenant_id, ticket_id ON ticket_service_lines FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('tickets', 'ticket_id');
DROP TRIGGER IF EXISTS trg_tc_gift_card_txn_card ON gift_card_transactions;
CREATE TRIGGER trg_tc_gift_card_txn_card BEFORE INSERT OR UPDATE OF tenant_id, gift_card_id ON gift_card_transactions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('gift_cards', 'gift_card_id');
DROP TRIGGER IF EXISTS trg_tc_loyalty_ledger_customer ON loyalty_ledger;
CREATE TRIGGER trg_tc_loyalty_ledger_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON loyalty_ledger FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_loyalty_profile_customer ON customer_loyalty_profiles;
CREATE TRIGGER trg_tc_loyalty_profile_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON customer_loyalty_profiles FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
DROP TRIGGER IF EXISTS trg_tc_deal_redemption_deal ON deal_redemptions;
CREATE TRIGGER trg_tc_deal_redemption_deal BEFORE INSERT OR UPDATE OF tenant_id, deal_id ON deal_redemptions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('deals', 'deal_id');

-- ── 3. Id types (§33): text salon/branch/user ids → uuid, where every stored value is a UUID (pre-flight) and every
--    writer stores one (checked in code, Oct 8 2026). Otherwise a 'type_change' deferral. A table estimated above
--    250,000 rows is deferred too: text → uuid rewrites the table under an exclusive lock, which belongs in a
--    maintenance window, not in a deploy. Columns deliberately left as text (non-UUID values by design: 'super_admin',
--    register 'main', 'g_<place id>', 'term_<code>'; or text joins / '' for platform users in other modules) are listed
--    in the Phase 10 report.
CREATE OR REPLACE FUNCTION schema_apply_uuid_type(p_table text, p_column text, p_migration text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; est real; dtype text; retry text := format('ALTER TABLE %I ALTER COLUMN %I TYPE uuid USING %I::uuid', p_table, p_column, p_column);
BEGIN
  SELECT data_type INTO dtype FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = p_table AND column_name = p_column;
  IF dtype IS NULL OR dtype = 'uuid' THEN RETURN; END IF;
  SELECT reltuples INTO est FROM pg_class WHERE oid = p_table::regclass;
  IF coalesce(est, 0) > 250000 THEN
    PERFORM schema_defer_constraint(format('uuid_%s_%s', p_table, p_column), p_table, 'type_change', p_migration, format('about %s rows: rewrite in a maintenance window', est::bigint), NULL, retry);
    RETURN;
  END IF;
  EXECUTE format($q$SELECT count(*) FROM %I WHERE %I IS NOT NULL AND %I !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$q$, p_table, p_column, p_column) INTO n;
  IF n > 0 THEN
    PERFORM schema_defer_constraint(format('uuid_%s_%s', p_table, p_column), p_table, 'type_change', p_migration, format('%s value(s) are not UUIDs', n), n::int, retry);
    RETURN;
  END IF;
  BEGIN
    EXECUTE retry;
  EXCEPTION WHEN others THEN
    PERFORM schema_defer_constraint(format('uuid_%s_%s', p_table, p_column), p_table, 'type_change', p_migration, format('ALTER refused (%s)', SQLSTATE), NULL, retry);
  END;
END $$;

DO $$ BEGIN
  PERFORM schema_apply_uuid_type('admin_commission_auth_codes', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('commission_change_audit_logs', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('commission_change_audit_logs', 'branch_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('payment_terminal_leases', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_booking_integrations', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_display_devices', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_display_devices', 'branch_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_message_templates', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_messaging_sender', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_project_status_checks', 'tenant_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('pos_tech_appointments', 'overbook_by_user_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('reception_copilot_feedback', 'receptionist_user_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('reception_copilot_recommendations', 'receptionist_user_id', '539_versions_consistency_ids_settlement.sql');
  PERFORM schema_apply_uuid_type('reception_copilot_sessions', 'receptionist_user_id', '539_versions_consistency_ids_settlement.sql');

  -- ── 4. Payments ↔ settlement batch (§19). The column and its index were added in 537 (CONCURRENTLY, no write lock on
  --    payments); here the foreign key to the settlement batch (payment_settlements, migrations 038/211), NOT VALID +
  --    pre-flight. SET NULL: a settlement batch row is never deleted by the product, but if one were, the payment stays.
  --    Written by the processor webhook (payment-webhook.service.ts) when a settlement event names its transactions.
  PERFORM schema_apply_fk('payments', 'fk_payments_settlement_batch', 'settlement_batch_id', 'payment_settlements', 'id', 'SET NULL', '539_versions_consistency_ids_settlement.sql');
END $$;
