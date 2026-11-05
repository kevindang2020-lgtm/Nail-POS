# MIGRATION_RECONCILIATION.md — canonical migration history after the seven-package merge

## The problem
All seven packages share migrations **0–171 byte-for-byte** and then each continued the chain independently from
`172_*.sql`, producing 7-way filename collisions across 172–200 (126 divergent files in total).

## The resolution
The canonical base (package 5) **keeps its numbering 172–200 unchanged** (it is the longest chain and its numbers
are referenced by its own tests/fixtures). Every other arc was appended after 200 in port order, preserving each
arc's internal order; every rename is recorded in the `RENAMED` ledger inside `apps/api/scripts/migrate.mjs`, which
rewrites the `schema_migrations` row old→new exactly once, so a database that already applied an arc under its
original numbers is never re-run. Three arc migrations were **not** ported because fuller implementations of the
same feature exist in the canonical chain (details in MERGE_DECISIONS §3):

- p2 `176_service_templates.sql` — superseded by base 183–186.
- p2 `188_billing_invoices.sql`, `189_billing_credit_notes.sql` — superseded by base 195–200.
- p7 `181_platform_announcements.sql` — superseded by 239 (p3's schema); its columns arrive via the additive
  reconciliation migration **294**, and the ledger maps the old filename to 294 so p7-origin databases skip cleanly
  (every statement in 294 is `IF NOT EXISTS`/additive).

**Final chain: 296 migration files** (0–200 base incl. the 017a and renamed-legacy entries + 201–294 ported/reconciled), applied in filename
order, one transaction each, by `node apps/api/scripts/migrate.mjs`.

## Renumbering map (old → new, by source package)

| Original filename | Canonical filename | Source |
|---|---|---|
| 172_checkout_locks.sql | **201_checkout_locks.sql** | p1 |
| 173_platform_settings.sql | **202_platform_settings.sql** | p1 |
| 174_legal_documents.sql | **203_legal_documents.sql** | p1 |
| 175_maintenance.sql | **204_maintenance.sql** | p1 |
| 176_business_categories.sql | **205_business_categories.sql** | p1 |
| 177_tenant_presets.sql | **206_tenant_presets.sql** | p1 |
| 178_tenant_locale.sql | **207_tenant_locale.sql** | p1 |
| 172_onboarding.sql | **208_onboarding.sql** | p4 |
| 173_onboarding_stage_entered_at.sql | **209_onboarding_stage_entered_at.sql** | p4 |
| 174_queue_metrics_snapshots.sql | **210_queue_metrics_snapshots.sql** | p4 |
| 175_settlements_deposits.sql | **211_settlements_deposits.sql** | p4 |
| 176_loyalty_platform_config.sql | **212_loyalty_platform_config.sql** | p4 |
| 177_loyalty_suspicious_cases.sql | **213_loyalty_suspicious_cases.sql** | p4 |
| 178_loyalty_calculation_corrections.sql | **214_loyalty_calculation_corrections.sql** | p4 |
| 179_automation_rules.sql | **215_automation_rules.sql** | p4 |
| 180_support_ticket_csat.sql | **216_support_ticket_csat.sql** | p4 |
| 172_super_admin_report_definitions.sql | **217_super_admin_report_definitions.sql** | p2 |
| 173_super_admin_scheduled_reports.sql | **218_super_admin_scheduled_reports.sql** | p2 |
| 174_platform_request_metrics.sql | **219_platform_request_metrics.sql** | p2 |
| 175_appointment_change_log.sql | **220_appointment_change_log.sql** | p2 |
| 177_revenue_residuals.sql | **221_revenue_residuals.sql** | p2 |
| 178_residual_statements.sql | **222_residual_statements.sql** | p2 |
| 179_processor_reconciliations.sql | **223_processor_reconciliations.sql** | p2 |
| 180_partner_payouts.sql | **224_partner_payouts.sql** | p2 |
| 181_tenant_incentives.sql | **225_tenant_incentives.sql** | p2 |
| 182_revenue_adjustments.sql | **226_revenue_adjustments.sql** | p2 |
| 183_revenue_export_jobs.sql | **227_revenue_export_jobs.sql** | p2 |
| 184_integration_connections.sql | **228_integration_connections.sql** | p2 |
| 185_integration_sync.sql | **229_integration_sync.sql** | p2 |
| 186_integration_webhook_events.sql | **230_integration_webhook_events.sql** | p2 |
| 187_integration_reliability.sql | **231_integration_reliability.sql** | p2 |
| 172_customer_legal_holds.sql | **232_customer_legal_holds.sql** | p3 |
| 173_customer_imports.sql | **233_customer_imports.sql** | p3 |
| 174_customer_deletion_requests.sql | **234_customer_deletion_requests.sql** | p3 |
| 175_product_master.sql | **235_product_master.sql** | p3 |
| 176_product_imports.sql | **236_product_imports.sql** | p3 |
| 177_product_distribution.sql | **237_product_distribution.sql** | p3 |
| 178_product_barcodes.sql | **238_product_barcodes.sql** | p3 |
| 179_platform_announcements.sql | **239_platform_announcements.sql** | p3 |
| 180_campaign_compliance.sql | **240_campaign_compliance.sql** | p3 |
| 181_campaign_deliveries.sql | **241_campaign_deliveries.sql** | p3 |
| 182_campaign_templates.sql | **242_campaign_templates.sql** | p3 |
| 183_campaign_metric_snapshots.sql | **243_campaign_metric_snapshots.sql** | p3 |
| 184_ai_insights.sql | **244_ai_insights.sql** | p3 |
| 185_ai_providers.sql | **245_ai_providers.sql** | p3 |
| 186_device_management.sql | **246_device_management.sql** | p3 |
| 187_system_status.sql | **247_system_status.sql** | p3 |
| 188_status_post_incident_reports.sql | **248_status_post_incident_reports.sql** | p3 |
| 189_status_health_snapshots.sql | **249_status_health_snapshots.sql** | p3 |
| 190_status_communications.sql | **250_status_communications.sql** | p3 |
| 191_status_recovery_and_impact.sql | **251_status_recovery_and_impact.sql** | p3 |
| 172_branch_transfer_requests.sql | **252_branch_transfer_requests.sql** | p6 |
| 173_worker_transfer_requests.sql | **253_worker_transfer_requests.sql** | p6 |
| 174_worker_cross_tenant_transfer_requests.sql | **254_worker_cross_tenant_transfer_requests.sql** | p6 |
| 175_payroll_sync_events.sql | **255_payroll_sync_events.sql** | p6 |
| 176_super_admin_saved_views.sql | **256_super_admin_saved_views.sql** | p6 |
| 177_promotions.sql | **257_promotions.sql** | p6 |
| 178_promotion_decisions.sql | **258_promotion_decisions.sql** | p6 |
| 179_ai_report_runs.sql | **259_ai_report_runs.sql** | p6 |
| 180_ai_report_schedules.sql | **260_ai_report_schedules.sql** | p6 |
| 181_ai_report_deliveries.sql | **261_ai_report_deliveries.sql** | p6 |
| 182_ai_report_templates.sql | **262_ai_report_templates.sql** | p6 |
| 183_ai_narrative_provenance.sql | **263_ai_narrative_provenance.sql** | p6 |
| 184_ip_block_rules.sql | **264_ip_block_rules.sql** | p6 |
| 185_security_incidents.sql | **265_security_incidents.sql** | p6 |
| 186_security_policies.sql | **266_security_policies.sql** | p6 |
| 187_emergency_lockdowns.sql | **267_emergency_lockdowns.sql** | p6 |
| 188_privileged_access_grants.sql | **268_privileged_access_grants.sql** | p6 |
| 189_data_retention_rules.sql | **269_data_retention_rules.sql** | p6 |
| 172_user_invitations.sql | **270_user_invitations.sql** | p7 |
| 173_access_requests.sql | **271_access_requests.sql** | p7 |
| 174_scheduled_reports.sql | **272_scheduled_reports.sql** | p7 |
| 175_booking_checkin_events.sql | **273_booking_checkin_events.sql** | p7 |
| 176_booking_checkin_retry_attempts.sql | **274_booking_checkin_retry_attempts.sql** | p7 |
| 177_merchant_rate_schedules.sql | **275_merchant_rate_schedules.sql** | p7 |
| 178_merchant_risk_reviews.sql | **276_merchant_risk_reviews.sql** | p7 |
| 179_merchant_funding_profiles.sql | **277_merchant_funding_profiles.sql** | p7 |
| 180_merchant_account_alerts.sql | **278_merchant_account_alerts.sql** | p7 |
| 182_tenant_messaging_limits.sql | **279_tenant_messaging_limits.sql** | p7 |
| 183_message_templates.sql | **280_message_templates.sql** | p7 |
| 184_communication_providers.sql | **281_communication_providers.sql** | p7 |
| 185_reminder_templates.sql | **282_reminder_templates.sql** | p7 |
| 186_reminder_timing_defaults.sql | **283_reminder_timing_defaults.sql** | p7 |
| 187_reminder_tenant_overrides.sql | **284_reminder_tenant_overrides.sql** | p7 |
| 188_reminder_flow_state.sql | **285_reminder_flow_state.sql** | p7 |
| 189_reminder_channel_config.sql | **286_reminder_channel_config.sql** | p7 |
| 190_reminder_plan_features.sql | **287_reminder_plan_features.sql** | p7 |
| 191_audit_legal_holds.sql | **288_audit_legal_holds.sql** | p7 |
| 192_audit_investigations.sql | **289_audit_investigations.sql** | p7 |
| 193_audit_evidence_packs.sql | **290_audit_evidence_packs.sql** | p7 |
| 194_audit_tamper_controls.sql | **291_audit_tamper_controls.sql** | p7 |
| 195_audit_export_flags.sql | **292_audit_export_flags.sql** | p7 |
| 196_audit_retention_policies.sql | **293_audit_retention_policies.sql** | p7 |
| 181_platform_announcements.sql | **294_platform_announcements_reconcile.sql** | p7 |
## Content changes made to migrations (all verified on live Postgres 16 from a clean database)

1. **Clean-DB guards on five base seed migrations** — each previously assumed the demo tenants
   (`e167929e…`, `d45202a2…`) existed and violated FKs on a fresh database:
   - `184_service_templates_seed.sql`: deployment seed now JOINs `tenants` (no-op on clean DBs).
   - `188_dispute_seed.sql`, `189_membership_programs_seed.sql`, `195_billing_subscriptions.sql` (fixture block),
     `198_billing_webhooks.sql` (fixture block): early-return guard with a NOTICE when demo rows are absent.
   The DDL portions always apply; only fixtures are skipped on clean databases.
2. **`257_promotions.sql` / `258_promotion_decisions.sql`** (orig p6 177/178): tables renamed
   `tenant_promotions` / `tenant_promotion_redemptions` because the platform-billing domain already owns
   `promotions`/`promotion_redemptions` (base 178). Six code files updated to match; route paths unchanged.
3. **`294_platform_announcements_reconcile.sql`** (new): additive union of the Communications columns onto the
   canonical announcements table + widened status/channel/priority/target_scope CHECKs (named constraints).

## Verification
- Full chain applied **from a dropped-and-recreated database**: 296/296 OK (see TEST_REPORT.md for the run).
- Re-run is a no-op (`0 applied, 296 already present`) — ledger idempotency confirmed.
- Money columns spot-checked as BIGINT integer cents across the ported tables; tenant keys present on all
  tenant-scoped tables; unique indexes verified for idempotency keys (announcements, redemptions, payment attempts).

## Deep-scan addition (2026-07-03)
- **295_support_ticket_attachments.sql** (new, additive): metadata table for Support Center ticket attachments. File bytes live behind the MediaStorage port in a private root, never in this table; storage_key is never exposed by any read shape. Brings the chain to 296.
