// migration-sql.mjs — the rules every migration replayer shares (BUILD_PLAN Phase 10, Constitution 1 §69–71).
// Used by scripts/migrate.mjs (production), packages/testing (PGlite replays for pgtests), restore-verify and the
// schema-introspection scripts, so a migration behaves the same everywhere.

/** `-- migrate: no-transaction` within the first five lines marks a file that must run OUTSIDE a transaction, one
 *  statement at a time (CREATE INDEX CONCURRENTLY, VALIDATE CONSTRAINT on a busy table). */
export function isNoTransaction(sql) {
  return /^--\s*migrate:\s*no-transaction\b/im.test(String(sql).split('\n').slice(0, 5).join('\n'));
}

/** Split a no-transaction file into statements. Such files hold plain statements only (no $$ bodies): a `;` at the end
 *  of a line ends a statement; comment-only chunks are dropped. Every statement must be idempotent (IF NOT EXISTS …)
 *  because a failure part-way leaves the earlier ones applied and the file is re-run next time. */
export function splitStatements(sql) {
  if (/\$\$/.test(sql)) throw new Error('a no-transaction migration cannot contain $$ bodies (DO / CREATE FUNCTION) — put those in an ordinary migration');
  return String(sql).split(/;[ \t]*\r?\n/).map((s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim()).filter(Boolean);
}

/** The index name of a `CREATE UNIQUE INDEX CONCURRENTLY [IF NOT EXISTS] name` statement, else null. Phase 15 C: such a
 *  build is SKIPPED by scripts/migrate.mjs when schema_deferred_constraints holds an OPEN row of that name — the
 *  transactional pre-flight before it (e.g. 567) found duplicates on this database and deferred the index; building it
 *  anyway would fail the deploy. db-validate-constraints.mjs builds it once the data is fixed. */
export function concurrentUniqueIndexName(stmt) {
  const m = /^CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)/i.exec(String(stmt).trim());
  return m ? m[1].replace(/"/g, '') : null;
}

/** PGlite replays every file through one multi-statement exec, which is an implicit transaction — CONCURRENTLY is
 *  refused there. A fresh in-memory database has nobody to block, so the plain form is exactly equivalent. */
export function pgliteCompatible(sql) {
  return String(sql).replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, 'CREATE $1INDEX').replace(/\bDROP\s+INDEX\s+CONCURRENTLY\b/gi, 'DROP INDEX');
}

/** Apply one migration file to a PGlite instance (or anything with `exec(sql)`), honouring both rules above. */
export async function applyMigrationToPglite(db, sql) {
  if (isNoTransaction(sql)) { for (const stmt of splitStatements(pgliteCompatible(sql))) await db.exec(stmt); }
  else await db.exec(pgliteCompatible(sql));
}

/** Deliberate migration RENAMES (old ledger filename → new filename). migrate.mjs rewrites the ledger row once;
 *  db-preflight.mjs treats an old name whose new file exists as healthy. (Moved here from migrate.mjs, Phase 10.) */
export const MIGRATION_RENAMES = Object.freeze({
  // 017 number-collision fix: the settings/integrations migration was renamed to sort uniquely after
  // 017_checkout_payments.sql (016 → 017_checkout_payments → 017a_pos_settings_integrations → 018 …).
  '017_pos_settings_integrations.sql': '017a_pos_settings_integrations.sql',
  // Monorepo merge (2026-06-26): the pos-pipeline branch shipped these three under 126/127/128, which
  // collided with the admin-arc branch's 126-129. They create/alter disjoint tables, so they were renumbered
  // to append after 129. These aliases keep any DB that already applied the old numbers from re-running them.
  '126_pos_kpi_daily_snapshots.sql': '130_pos_kpi_daily_snapshots.sql',
  '127_ticket_line_kind.sql': '131_ticket_line_kind.sql',
  '128_queue_requested_technician.sql': '132_queue_requested_technician.sql',
  // Monorepo merge (2026-06-26b): fold-in of user-prefs (files__5_) and help-center (files__4_) arcs.
  '133_user_login_alert_prefs.sql': '138_user_login_alert_prefs.sql',
  '134_user_notification_prefs.sql': '139_user_notification_prefs.sql',
  '135_tenant_backup_requests.sql': '140_tenant_backup_requests.sql',
  '136_user_ui_prefs.sql': '141_user_ui_prefs.sql',
  '130_help_knowledge_base.sql': '142_help_knowledge_base.sql',
  '131_video_tutorials.sql': '143_video_tutorials.sql',
  '132_help_article_engagement.sql': '144_help_article_engagement.sql',
  '133_support_tickets.sql': '145_support_tickets.sql',
  '134_ai_support_conversations.sql': '146_ai_support_conversations.sql',
  '135_status_and_updates.sql': '147_status_and_updates.sql',
  '136_support_sessions.sql': '148_support_sessions.sql',
  // Tech-assignment merge (2026-06-26c): the POS↔Tech gap-closure branch (G1–G5 + serving-pause Phase A) numbered
  // its migrations 137–140, which collided with the already-merged 137 (webhook_deliveries) / 138–141 (user-prefs) /
  // 140 (tenant_backup_requests). They alter disjoint tables, so they were renumbered to append after 152.
  '137_tech_queue_paused_status.sql': '153_tech_queue_paused_status.sql',
  '138_tech_queue_acceptance_deadline.sql': '154_tech_queue_acceptance_deadline.sql',
  '139_tech_queue_version.sql': '155_tech_queue_version.sql',
  '140_serving_pause_durable.sql': '156_serving_pause_durable.sql',
  // Seven-package merge (2026-07-02): the general-settings arc (package 1) shipped 172-178, colliding with the
  // plans/billing arc's 172-200 (canonical base). Renumbered to append after 200. Disjoint tables.
  '172_checkout_locks.sql': '201_checkout_locks.sql',
  '173_platform_settings.sql': '202_platform_settings.sql',
  '174_legal_documents.sql': '203_legal_documents.sql',
  '175_maintenance.sql': '204_maintenance.sql',
  '176_business_categories.sql': '205_business_categories.sql',
  '177_tenant_presets.sql': '206_tenant_presets.sql',
  '178_tenant_locale.sql': '207_tenant_locale.sql',
  // Seven-package merge (2026-07-02): onboarding/queue/settlements/loyalty/automation/support arc (package 4)
  // shipped 172-180; renumbered to 208-216 after the general-settings arc. Disjoint tables.
  '172_onboarding.sql': '208_onboarding.sql',
  '173_onboarding_stage_entered_at.sql': '209_onboarding_stage_entered_at.sql',
  '174_queue_metrics_snapshots.sql': '210_queue_metrics_snapshots.sql',
  '175_settlements_deposits.sql': '211_settlements_deposits.sql',
  '176_loyalty_platform_config.sql': '212_loyalty_platform_config.sql',
  '177_loyalty_suspicious_cases.sql': '213_loyalty_suspicious_cases.sql',
  '178_loyalty_calculation_corrections.sql': '214_loyalty_calculation_corrections.sql',
  '179_automation_rules.sql': '215_automation_rules.sql',
  '180_support_ticket_csat.sql': '216_support_ticket_csat.sql',
  // Seven-package merge (2026-07-02): reports/oversight/revenue-residuals/integrations arc (package 2) shipped
  // 172-189; its 176_service_templates and 188/189 billing invoice/credit-note migrations were superseded by the
  // canonical base's fuller implementations (183-186 service templates; 195-200 billing) and are intentionally
  // NOT ported. The remaining fifteen were renumbered to 217-231. Disjoint tables.
  '172_super_admin_report_definitions.sql': '217_super_admin_report_definitions.sql',
  '173_super_admin_scheduled_reports.sql': '218_super_admin_scheduled_reports.sql',
  '174_platform_request_metrics.sql': '219_platform_request_metrics.sql',
  '175_appointment_change_log.sql': '220_appointment_change_log.sql',
  '177_revenue_residuals.sql': '221_revenue_residuals.sql',
  '178_residual_statements.sql': '222_residual_statements.sql',
  '179_processor_reconciliations.sql': '223_processor_reconciliations.sql',
  '180_partner_payouts.sql': '224_partner_payouts.sql',
  '181_tenant_incentives.sql': '225_tenant_incentives.sql',
  '182_revenue_adjustments.sql': '226_revenue_adjustments.sql',
  '183_revenue_export_jobs.sql': '227_revenue_export_jobs.sql',
  '184_integration_connections.sql': '228_integration_connections.sql',
  '185_integration_sync.sql': '229_integration_sync.sql',
  '186_integration_webhook_events.sql': '230_integration_webhook_events.sql',
  '187_integration_reliability.sql': '231_integration_reliability.sql',
  // Seven-package merge (2026-07-02): customer-data/product-catalog/campaigns/AI-insights/devices/system-status
  // arc (package 3) shipped 172-191; renumbered to 232-251. Its platform_announcements schema is the canonical one
  // (the communications arc's simpler variant was superseded). Disjoint tables otherwise.
  '172_customer_legal_holds.sql': '232_customer_legal_holds.sql',
  '173_customer_imports.sql': '233_customer_imports.sql',
  '174_customer_deletion_requests.sql': '234_customer_deletion_requests.sql',
  '175_product_master.sql': '235_product_master.sql',
  '176_product_imports.sql': '236_product_imports.sql',
  '177_product_distribution.sql': '237_product_distribution.sql',
  '178_product_barcodes.sql': '238_product_barcodes.sql',
  '179_platform_announcements.sql': '239_platform_announcements.sql',
  '180_campaign_compliance.sql': '240_campaign_compliance.sql',
  '181_campaign_deliveries.sql': '241_campaign_deliveries.sql',
  '182_campaign_templates.sql': '242_campaign_templates.sql',
  '183_campaign_metric_snapshots.sql': '243_campaign_metric_snapshots.sql',
  '184_ai_insights.sql': '244_ai_insights.sql',
  '185_ai_providers.sql': '245_ai_providers.sql',
  '186_device_management.sql': '246_device_management.sql',
  '187_system_status.sql': '247_system_status.sql',
  '188_status_post_incident_reports.sql': '248_status_post_incident_reports.sql',
  '189_status_health_snapshots.sql': '249_status_health_snapshots.sql',
  '190_status_communications.sql': '250_status_communications.sql',
  '191_status_recovery_and_impact.sql': '251_status_recovery_and_impact.sql',
  // Seven-package merge (2026-07-02): workforce-transfers/promotions/AI-reports/security arc (package 6) shipped
  // 172-189; renumbered to 252-269. Its richer 11-state branch lifecycle engine replaced the base's 6-action one.
  '172_branch_transfer_requests.sql': '252_branch_transfer_requests.sql',
  '173_worker_transfer_requests.sql': '253_worker_transfer_requests.sql',
  '174_worker_cross_tenant_transfer_requests.sql': '254_worker_cross_tenant_transfer_requests.sql',
  '175_payroll_sync_events.sql': '255_payroll_sync_events.sql',
  '176_super_admin_saved_views.sql': '256_super_admin_saved_views.sql',
  '177_promotions.sql': '257_promotions.sql',
  '178_promotion_decisions.sql': '258_promotion_decisions.sql',
  '179_ai_report_runs.sql': '259_ai_report_runs.sql',
  '180_ai_report_schedules.sql': '260_ai_report_schedules.sql',
  '181_ai_report_deliveries.sql': '261_ai_report_deliveries.sql',
  '182_ai_report_templates.sql': '262_ai_report_templates.sql',
  '183_ai_narrative_provenance.sql': '263_ai_narrative_provenance.sql',
  '184_ip_block_rules.sql': '264_ip_block_rules.sql',
  '185_security_incidents.sql': '265_security_incidents.sql',
  '186_security_policies.sql': '266_security_policies.sql',
  '187_emergency_lockdowns.sql': '267_emergency_lockdowns.sql',
  '188_privileged_access_grants.sql': '268_privileged_access_grants.sql',
  '189_data_retention_rules.sql': '269_data_retention_rules.sql',
  // Seven-package merge (2026-07-02): users/booking-monitor/merchant-accounts/communications/reminders/audit arc
  // (package 7) shipped 172-196; renumbered to 270-293. Its 181_platform_announcements was superseded by the
  // campaigns arc's richer schema (239) + the additive 294 reconciliation, so it maps to 294 (already-applied
  // p7 databases skip the union migration's ADDs harmlessly on next run — every statement is IF NOT EXISTS).
  '172_user_invitations.sql': '270_user_invitations.sql',
  '173_access_requests.sql': '271_access_requests.sql',
  '174_scheduled_reports.sql': '272_scheduled_reports.sql',
  '175_booking_checkin_events.sql': '273_booking_checkin_events.sql',
  '176_booking_checkin_retry_attempts.sql': '274_booking_checkin_retry_attempts.sql',
  '177_merchant_rate_schedules.sql': '275_merchant_rate_schedules.sql',
  '178_merchant_risk_reviews.sql': '276_merchant_risk_reviews.sql',
  '179_merchant_funding_profiles.sql': '277_merchant_funding_profiles.sql',
  '180_merchant_account_alerts.sql': '278_merchant_account_alerts.sql',
  '181_platform_announcements.sql': '294_platform_announcements_reconcile.sql',
  '182_tenant_messaging_limits.sql': '279_tenant_messaging_limits.sql',
  '183_message_templates.sql': '280_message_templates.sql',
  '184_communication_providers.sql': '281_communication_providers.sql',
  '185_reminder_templates.sql': '282_reminder_templates.sql',
  '186_reminder_timing_defaults.sql': '283_reminder_timing_defaults.sql',
  '187_reminder_tenant_overrides.sql': '284_reminder_tenant_overrides.sql',
  '188_reminder_flow_state.sql': '285_reminder_flow_state.sql',
  '189_reminder_channel_config.sql': '286_reminder_channel_config.sql',
  '190_reminder_plan_features.sql': '287_reminder_plan_features.sql',
  '191_audit_legal_holds.sql': '288_audit_legal_holds.sql',
  '192_audit_investigations.sql': '289_audit_investigations.sql',
  '193_audit_evidence_packs.sql': '290_audit_evidence_packs.sql',
  '194_audit_tamper_controls.sql': '291_audit_tamper_controls.sql',
  '195_audit_export_flags.sql': '292_audit_export_flags.sql',
  '196_audit_retention_policies.sql': '293_audit_retention_policies.sql',
  // Developer/pilot migration renames (432-437 renumbered to 472-478)
  '432_tenant_default_commission_percent.sql': '472_tenant_default_commission_percent.sql',
  '433_user_avatar_url.sql': '473_user_avatar_url.sql',
  '434_loyalty_ledger.sql': '474_loyalty_ledger.sql',
  '435_skill_request_and_schedule.sql': '475_skill_request_and_schedule.sql',
  '436_inventory_branch_overrides.sql': '476_inventory_branch_overrides.sql',
  '436_inventory_discounts_updates.sql': '477_inventory_discounts_updates.sql',
  '437_cash_drawer_registers.sql': '478_cash_drawer_registers.sql',
});
