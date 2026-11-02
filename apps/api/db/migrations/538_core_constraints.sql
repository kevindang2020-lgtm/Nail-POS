-- 538_core_constraints.sql — BUILD_PLAN Phase 10 (Constitution 1 §33 keys, §34 foreign keys, §35 unique rules, §38 CHECK
-- constraints, §70 large-table-safe migrations, §111 "core relationships are enforced").
--
-- Every constraint here goes through ONE pre-flight pattern (the helpers below), so no deploy can fail on existing data:
--   * a CHECK or FOREIGN KEY is added NOT VALID (new writes are checked from now on, existing rows are not scanned under
--     an exclusive lock), then the helper COUNTS the existing rows that break it: zero → VALIDATE CONSTRAINT here; more
--     than zero → the constraint stays NOT VALID and a row in schema_deferred_constraints (534) records the count and the
--     exact VALIDATE statement. scripts/db-validate-constraints.mjs (and the Super Admin Database page) retries it once
--     the data is fixed.
--   * a UNIQUE index counts the duplicate groups first: zero → the unique index; otherwise → a NON-unique index with the
--     same columns (reads keep their index) plus a deferral row whose retry_sql creates the unique one.
-- A fresh database (tests, a new environment) has no rows, so it applies everything and defers NOTHING — asserted by
-- apps/api/src/common/core-constraints.pgtest.vitest.spec.ts. Reasons hold counts only, never row contents.
--
-- The helpers are generic (single-column FK, any CHECK expression, any unique column list) so later migrations reuse them.

CREATE OR REPLACE FUNCTION schema_apply_check(p_table text, p_name text, p_expr text, p_migration text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; ok boolean;
BEGIN
  IF to_regclass(p_table) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_table::regclass AND conname = p_name) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_table, p_name, p_expr);
  END IF;
  SELECT convalidated INTO ok FROM pg_constraint WHERE conrelid = p_table::regclass AND conname = p_name;
  IF ok THEN RETURN; END IF;
  EXECUTE format('SELECT count(*) FROM %I WHERE NOT (%s)', p_table, p_expr) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name);
  ELSE
    PERFORM schema_defer_constraint(p_name, p_table, 'check_validation', p_migration, format('%s existing row(s) break the check', n), n::int,
      format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION schema_apply_fk(p_table text, p_name text, p_column text, p_ref_table text, p_ref_column text, p_on_delete text, p_migration text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; ok boolean;
BEGIN
  IF to_regclass(p_table) IS NULL OR to_regclass(p_ref_table) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_table::regclass AND conname = p_name) THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (%I) ON DELETE %s NOT VALID', p_table, p_name, p_column, p_ref_table, p_ref_column, p_on_delete);
  END IF;
  SELECT convalidated INTO ok FROM pg_constraint WHERE conrelid = p_table::regclass AND conname = p_name;
  IF ok THEN RETURN; END IF;
  EXECUTE format('SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.%I = c.%I)', p_table, p_column, p_ref_table, p_ref_column, p_column) INTO n;
  IF n = 0 THEN
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name);
  ELSE
    PERFORM schema_defer_constraint(p_name, p_table, 'foreign_key_validation', p_migration, format('%s orphan row(s) name a missing %s', n, p_ref_table), n::int,
      format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name));
  END IF;
END $$;

-- p_cols is the index column list as SQL (expressions allowed), p_where an optional partial-index predicate.
CREATE OR REPLACE FUNCTION schema_apply_unique(p_table text, p_name text, p_cols text, p_where text, p_fallback text, p_migration text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; w text := coalesce(nullif(p_where, ''), 'true'); pred text := CASE WHEN coalesce(p_where, '') = '' THEN '' ELSE ' WHERE ' || p_where END;
BEGIN
  IF to_regclass(p_table) IS NULL OR to_regclass(p_name) IS NOT NULL THEN RETURN; END IF;
  EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I WHERE %s GROUP BY %s HAVING count(*) > 1) d', p_table, w, p_cols) INTO n;
  IF n = 0 THEN
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (%s)%s', p_name, p_table, p_cols, pred);
  ELSE
    PERFORM schema_defer_constraint(p_name, p_table, 'unique', p_migration, format('%s duplicate group(s)', n), n::int,
      format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (%s)%s', p_name, p_table, p_cols, pred));
    IF p_fallback IS NOT NULL THEN EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (%s)%s', p_fallback, p_table, p_cols, pred); END IF;
  END IF;
END $$;

DO $$ BEGIN
  -- ── Core foreign keys (§34). None of these existed. ON DELETE NO ACTION for money and service rows (nothing in the
  -- product hard-deletes a ticket, payment or customer — they are voided/archived); customers follow their salon the
  -- way branches/users already do (CASCADE), and a salon that still has tickets therefore cannot be hard-deleted.
  PERFORM schema_apply_fk('payments', 'fk_payments_ticket', 'ticket_id', 'tickets', 'id', 'NO ACTION', '538_core_constraints.sql');
  PERFORM schema_apply_fk('payment_refunds', 'fk_payment_refunds_payment', 'payment_id', 'payments', 'id', 'NO ACTION', '538_core_constraints.sql');
  PERFORM schema_apply_fk('tickets', 'fk_tickets_customer', 'customer_id', 'customers', 'id', 'NO ACTION', '538_core_constraints.sql');
  PERFORM schema_apply_fk('ticket_service_lines', 'fk_ticket_service_lines_ticket', 'ticket_id', 'tickets', 'id', 'NO ACTION', '538_core_constraints.sql');
  PERFORM schema_apply_fk('customers', 'fk_customers_tenant', 'tenant_id', 'tenants', 'id', 'CASCADE', '538_core_constraints.sql');

  -- ── Unique rules (§35) that only existed in application code (or not at all).
  -- One staff/customer login per email and per phone inside a salon (login looks users up by tenant + phone/email).
  -- Platform users (tenant_id NULL) are not covered: NULLs never collide in a unique index (decided; PG14 floor).
  PERFORM schema_apply_unique('users', 'uq_users_tenant_email_ci', 'tenant_id, lower(email)', 'email IS NOT NULL', 'idx_users_tenant_email_ci', '538_core_constraints.sql');
  PERFORM schema_apply_unique('users', 'uq_users_tenant_phone', 'tenant_id, normalized_phone', 'normalized_phone IS NOT NULL', 'idx_users_tenant_phone_nn', '538_core_constraints.sql');
  -- One loyalty profile per customer (the loyalty ledger and every reader already assume it).
  PERFORM schema_apply_unique('customer_loyalty_profiles', 'uq_customer_loyalty_profiles_customer', 'tenant_id, customer_id', NULL, 'idx_customer_loyalty_profiles_customer', '538_core_constraints.sql');
  -- A processor event is APPLIED once. Rows the webhook could not process (unknown merchant, bad signature) are an
  -- audit trail of delivery attempts and legitimately repeat, so the rule covers processed rows only.
  PERFORM schema_apply_unique('payment_gateway_events', 'uq_payment_gateway_events_processed', 'processor_type, event_id', 'event_id IS NOT NULL AND processed_at IS NOT NULL', 'idx_payment_gateway_events_processed', '538_core_constraints.sql');
  -- One delivery log per provider message id.
  PERFORM schema_apply_unique('sms_delivery_logs', 'uq_sms_delivery_logs_provider_sid', 'provider_sid', 'provider_sid IS NOT NULL', 'idx_sms_delivery_logs_provider_sid', '538_core_constraints.sql');

  -- ── Value rules (§38).
  PERFORM schema_apply_check('booking_holds', 'chk_booking_holds_window', 'end_time > start_time', '538_core_constraints.sql');
  PERFORM schema_apply_check('pos_tech_appointments', 'chk_pos_tech_appointments_times', $c$start_time ~ '^\d{2}:\d{2}$' AND end_time ~ '^\d{2}:\d{2}$' AND end_time > start_time$c$, '538_core_constraints.sql');
  -- Stock counters are counts of bottle rows (inventory-core countsFromUnits) — never negative, even for a product that
  -- allows selling below zero (that is a sale-time override, not a negative count).
  PERFORM schema_apply_check('inventory_location_stock', 'chk_inventory_location_stock_nonneg',
    'quantity_on_hand >= 0 AND quantity_available >= 0 AND quantity_reserved >= 0 AND quantity_unopened >= 0 AND quantity_open >= 0 AND quantity_low >= 0 AND quantity_empty >= 0 AND quantity_damaged >= 0', '538_core_constraints.sql');

  -- ── status vocabularies (§38): 64 of the 102 text `status` columns that had no CHECK. Each allowed set is the union of
  -- the CREATE TABLE's documented values, every literal a write path stores, the TypeScript union the dynamic writes are
  -- typed by, and every literal a reader compares the column to (scratchpad scan, Oct 8 2026). The 38 columns whose
  -- vocabulary could not be proven from code are listed in the Phase 10 report, not guessed here.
  PERFORM schema_apply_check('access_requests', 'chk_access_requests_status_vocab', 'status IN (''approved'', ''cancelled'', ''expired'', ''rejected'', ''submitted'', ''under_review'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ai_receptionist_agents', 'chk_ai_receptionist_agents_status_vocab', 'status IN (''archived'', ''draft'', ''error'', ''live'', ''paused'', ''ready'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ai_receptionist_follow_ups', 'chk_ai_receptionist_follow_ups_status_vocab', 'status IN (''assigned'', ''closed'', ''in_progress'', ''open'', ''resolved'', ''waiting'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('automation_exceptions', 'chk_automation_exceptions_status_vocab', 'status IN (''active'', ''expired'', ''pending_review'', ''revoked'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('automation_executions', 'chk_automation_executions_status_vocab', 'status IN (''active'', ''cancelled'', ''disabled'', ''failed'', ''partial'', ''resolved'', ''retrying'', ''skipped'', ''success'', ''suppressed'', ''timed_out'', ''waiting'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('automation_failures', 'chk_automation_failures_status_vocab', 'status IN (''abandoned'', ''resolved'', ''retrying'', ''waiting'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('automation_rules', 'chk_automation_rules_status_vocab', 'status IN (''active'', ''approved'', ''archived'', ''disabled'', ''draft'', ''error'', ''paused'', ''pending_review'', ''retired'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('bank_accounts', 'chk_bank_accounts_status_vocab', 'status IN (''active'', ''inactive'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('bank_webhook_endpoints', 'chk_bank_webhook_endpoints_status_vocab', 'status IN (''active'', ''disabled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('booking_holds', 'chk_booking_holds_status_vocab', 'status IN (''active'', ''converted'', ''expired'', ''held'', ''locked'', ''pending'', ''released'', ''sent'', ''started'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('bundles', 'chk_bundles_status_vocab', 'status IN (''active'', ''archived'', ''inactive'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('campaigns', 'chk_campaigns_status_vocab', 'status IN (''cancelled'', ''completed'', ''draft'', ''in_progress'', ''scheduled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('communication_messages', 'chk_communication_messages_status_vocab', 'status IN (''delivered'', ''failed'', ''read'', ''sent'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('communication_threads', 'chk_communication_threads_status_vocab', 'status IN (''closed'', ''missed'', ''open'', ''pending'', ''replied'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('community_post_versions', 'chk_community_post_versions_status_vocab', 'status IN (''archived'', ''corrected'', ''disputed'', ''evidence_requested'', ''incident_draft'', ''insufficient_information'', ''manager_approval'', ''moderation_review'', ''privacy_scan'', ''published_evidence_reviewed'', ''published_multiple_reports'', ''published_official_report'', ''published_unverified'', ''rejected'', ''removed'', ''resolved'', ''returned_for_correction'', ''sensitive_data_detected'', ''tenant_review'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('customer_deletion_requests', 'chk_customer_deletion_requests_status_vocab', 'status IN (''approved'', ''cancelled'', ''executed'', ''rejected'', ''requested'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('customer_import_jobs', 'chk_customer_import_jobs_status_vocab', 'status IN (''approved'', ''completed'', ''failed'', ''pending'', ''processing'', ''rejected'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('customer_import_rows', 'chk_customer_import_rows_status_vocab', 'status IN (''failed'', ''imported'', ''invalid'', ''valid'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('customer_legal_holds', 'chk_customer_legal_holds_status_vocab', 'status IN (''active'', ''released'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('customer_memberships', 'chk_customer_memberships_status_vocab', 'status IN (''active'', ''archived'', ''canceled'', ''canceling'', ''cancelled'', ''comped'', ''completed'', ''expired'', ''failed'', ''grace'', ''past_due'', ''paused'', ''pending'', ''succeeded'', ''suspended'', ''trial'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('integration_credential_references', 'chk_integration_credential_references_status_vocab', 'status IN (''active'', ''revoked'', ''rotated'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('integration_oauth_states', 'chk_integration_oauth_states_status_vocab', 'status IN (''consumed'', ''expired'', ''pending'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('inventory_counts', 'chk_inventory_counts_status_vocab', 'status IN (''cancelled'', ''in_progress'', ''reconciled'', ''submitted'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('inventory_technician_reports', 'chk_inventory_technician_reports_status_vocab', 'status IN (''approved'', ''automatically_processed'', ''corrected'', ''pending'', ''rejected'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('inventory_transfers', 'chk_inventory_transfers_status_vocab', 'status IN (''cancelled'', ''completed'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('invoices', 'chk_invoices_status_vocab', 'status IN (''cancelled'', ''draft'', ''failed'', ''open'', ''paid'', ''partially_paid'', ''past_due'', ''pending'', ''refunded'', ''sent'', ''uncollectible'', ''void'', ''voided'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('legal_document_versions', 'chk_legal_document_versions_status_vocab', 'status IN (''approved'', ''archived'', ''draft'', ''published'', ''retired'', ''scheduled'', ''superseded'', ''under_review'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('membership_plans', 'chk_membership_plans_status_vocab', 'status IN (''active'', ''archived'', ''disabled'', ''draft'', ''inactive'', ''paused'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ocr_duplicate_matches', 'chk_ocr_duplicate_matches_status_vocab', 'status IN (''exact'', ''likely'', ''possible'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ocr_jobs', 'chk_ocr_jobs_status_vocab', 'status IN (''failed'', ''queued'', ''running'', ''succeeded'', ''timed_out'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ocr_postings', 'chk_ocr_postings_status_vocab', 'status IN (''failed'', ''pending'', ''posted'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('ocr_validation_results', 'chk_ocr_validation_results_status_vocab', 'status IN (''blocked'', ''needs_review'', ''valid'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('overage_charges', 'chk_overage_charges_status_vocab', 'status IN (''active'', ''void'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('payment_attempts', 'chk_payment_attempts_status_vocab', 'status IN (''cancelled'', ''created'', ''declined'', ''failed'', ''pending'', ''processing'', ''refunded'', ''settled'', ''succeeded'', ''void'', ''voided'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('payment_refunds', 'chk_payment_refunds_status_vocab', 'status IN (''cancelled'', ''failed'', ''pending'', ''processing'', ''refunded'', ''reserved'', ''voided'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('payment_settlements', 'chk_payment_settlements_status_vocab', 'status IN (''failed'', ''needs_review'', ''not_applicable'', ''pending'', ''posted'', ''returned'', ''settled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('payments', 'chk_payments_status_vocab', 'status IN (''approved'', ''cancelled'', ''captured'', ''completed'', ''created'', ''declined'', ''expired'', ''failed'', ''not_configured'', ''open'', ''partial'', ''partially_refunded'', ''pending'', ''processing'', ''refunded'', ''requires_action'', ''settled'', ''succeeded'', ''voided'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('payroll_periods', 'chk_payroll_periods_status_vocab', 'status IN (''draft'', ''finalized'', ''paid'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('plan_add_ons', 'chk_plan_add_ons_status_vocab', 'status IN (''active'', ''archived'', ''inactive'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('promotions', 'chk_promotions_status_vocab', 'status IN (''active'', ''approved'', ''archived'', ''cancelled'', ''completed'', ''disabled'', ''draft'', ''expired'', ''inactive'', ''paused'', ''pending_approval'', ''rejected'', ''scheduled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('purchase_orders', 'chk_purchase_orders_status_vocab', 'status IN (''approved'', ''cancelled'', ''closed'', ''draft'', ''ordered'', ''partial'', ''received'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('reception_copilot_learning_suggestions', 'chk_reception_copilot_learning_suggestions_status_vocab', 'status IN (''approved'', ''dismissed'', ''open'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('reception_copilot_sessions', 'chk_reception_copilot_sessions_status_vocab', 'status IN (''active'', ''ended'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('reconciliation_exceptions', 'chk_reconciliation_exceptions_status_vocab', 'status IN (''escalated'', ''in_review'', ''open'', ''reopened'', ''resolved'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('reconciliation_periods', 'chk_reconciliation_periods_status_vocab', 'status IN (''closed'', ''open'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('referral_redemptions', 'chk_referral_redemptions_status_vocab', 'status IN (''pending'', ''rewarded'', ''void'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('review_escalations', 'chk_review_escalations_status_vocab', 'status IN (''acknowledged'', ''open'', ''resolved'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('review_recovery_actions', 'chk_review_recovery_actions_status_vocab', 'status IN (''approved'', ''declined'', ''executed'', ''recommended'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('service_categories', 'chk_service_categories_status_vocab', 'status IN (''active'', ''archived'', ''inactive'', ''merged'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('service_template_categories', 'chk_service_template_categories_status_vocab', 'status IN (''active'', ''archived'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('service_templates', 'chk_service_templates_status_vocab', 'status IN (''draft'', ''published'', ''retired'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('sessions', 'chk_sessions_status_vocab', 'status IN (''active'', ''cancelled'', ''completed'', ''expired'', ''inactive'', ''locked'', ''revoked'', ''suspended'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('social_posts', 'chk_social_posts_status_vocab', 'status IN (''archived'', ''draft'', ''posted'', ''scheduled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('subscription_changes', 'chk_subscription_changes_status_vocab', 'status IN (''applied'', ''cancelled'', ''completed'', ''failed'', ''pending'', ''rejected'', ''scheduled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('subscription_plan_versions', 'chk_subscription_plan_versions_status_vocab', 'status IN (''active'', ''scheduled'', ''superseded'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('subscription_plans', 'chk_subscription_plans_status_vocab', 'status IN (''active'', ''archived'', ''deprecated'', ''draft'', ''grandfathered'', ''inactive'', ''scheduled'', ''superseded'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tech_dm_reports', 'chk_tech_dm_reports_status_vocab', 'status IN (''open'', ''resolved'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tech_dm_threads', 'chk_tech_dm_threads_status_vocab', 'status IN (''active'', ''blocked_by_customer'', ''blocked_by_technician'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tenant_add_ons', 'chk_tenant_add_ons_status_vocab', 'status IN (''active'', ''cancelled'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tenant_messaging_credentials', 'chk_tenant_messaging_credentials_status_vocab', 'status IN (''configured'', ''not_configured'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tenant_trials', 'chk_tenant_trials_status_vocab', 'status IN (''active'', ''cancelled'', ''converted'', ''expired'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tenant_webhook_deliveries', 'chk_tenant_webhook_deliveries_status_vocab', 'status IN (''dead'', ''delivered'', ''failed'', ''pending'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('tenant_webhooks', 'chk_tenant_webhooks_status_vocab', 'status IN (''active'', ''disabled'', ''paused'')', '538_core_constraints.sql');
  PERFORM schema_apply_check('user_invitations', 'chk_user_invitations_status_vocab', 'status IN (''accepted'', ''cancelled'', ''expired'', ''pending'')', '538_core_constraints.sql');
END $$;
