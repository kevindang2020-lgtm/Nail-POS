-- migrate: no-transaction
-- 537_tenant_leading_indexes.sql — BUILD_PLAN Phase 10 (Constitution 1 §36 "every tenant-owned table has an index that
-- starts with tenant_id", §57 index strategy, §70 large-table-safe migrations).
--
-- Measured Oct 8 2026: 81 tables carry tenant_id but had NO index whose first column is tenant_id, so every tenant-filtered
-- read of them was a sequential scan (cheap today, a full-table read per request at 10,000 salons). One index per table:
-- (tenant_id, <the column that table's reads filter or sort by after the tenant>) — the parent id for child tables, the
-- status for work queues, the time column for logs/events, else created_at.
-- 77 here: the four tenant_daily_*_summary tables get their tenant-leading index from 540 (C: UNIQUE (tenant_id,
-- branch_id, summary_date …) or its non-unique fallback), so a second, near-identical index is not added for them.
--
-- CONCURRENTLY so a production table is never write-locked while the index builds; that needs this file to run OUTSIDE a
-- transaction, one statement at a time (scripts/migrate.mjs honours the header above). Every statement is IF NOT EXISTS,
-- and an INVALID index left by an interrupted build is dropped by the runner before the retry. PGlite (pgtests) replays
-- the plain form. The EXPLAIN proof is apps/api/src/common/tenant-indexes.pgtest.vitest.spec.ts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_insight_feedback_tenant_lead ON ai_insight_feedback (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_report_schedules_tenant_lead ON ai_report_schedules (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_support_messages_tenant_lead ON ai_support_messages (tenant_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_export_flags_tenant_lead ON audit_export_flags (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_investigations_tenant_lead ON audit_investigations (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_before_after_sets_tenant_lead ON before_after_sets (tenant_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_invoice_lines_tenant_lead ON billing_invoice_lines (tenant_id, invoice_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_payment_attempts_tenant_lead ON billing_payment_attempts (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_compliance_flags_tenant_lead ON campaign_compliance_flags (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_delivery_rollups_tenant_lead ON campaign_delivery_rollups (tenant_id, subject_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_comments_tenant_lead ON community_comments (tenant_id, post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_evidence_tenant_lead ON community_evidence (tenant_id, post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_evidence_access_log_tenant_lead ON community_evidence_access_log (tenant_id, evidence_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_post_updates_tenant_lead ON community_post_updates (tenant_id, post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_similar_experiences_tenant_lead ON community_similar_experiences (tenant_id, post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_allergies_tenant_lead ON customer_allergies (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_blocks_tenant_lead ON customer_blocks (tenant_id, blocker_user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_display_pairings_tenant_lead ON customer_display_pairings (tenant_id, device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_follows_tenant_lead ON customer_follows (tenant_id, follower_customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_identity_conflicts_tenant_lead ON customer_identity_conflicts (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_import_rows_tenant_lead ON customer_import_rows (tenant_id, job_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_merge_logs_tenant_lead ON customer_merge_logs (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_preferences_tenant_lead ON customer_preferences (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_recon_tenant_stats_tenant_lead ON customer_recon_tenant_stats (tenant_id, run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_social_profiles_tenant_lead ON customer_social_profiles (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_analytics_events_tenant_lead ON deal_analytics_events (tenant_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_approvals_tenant_lead ON deal_approvals (tenant_id, deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_redemption_holds_tenant_lead ON deal_redemption_holds (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_saves_tenant_lead ON deal_saves (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_services_tenant_lead ON deal_services (tenant_id, deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_versions_tenant_lead ON deal_versions (tenant_id, deal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_maintenance_tenant_lead ON device_maintenance (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_sessions_tenant_lead ON device_sessions (tenant_id, branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_shipments_tenant_lead ON device_shipments (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_display_ad_device_settings_tenant_lead ON display_ad_device_settings (tenant_id, device_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_display_ad_report_batches_tenant_lead ON display_ad_report_batches (tenant_id, received_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispute_evidence_tenant_lead ON dispute_evidence (tenant_id, chargeback_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispute_funds_events_tenant_lead ON dispute_funds_events (tenant_id, chargeback_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispute_outcomes_tenant_lead ON dispute_outcomes (tenant_id, chargeback_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dispute_status_events_tenant_lead ON dispute_status_events (tenant_id, chargeback_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hardware_package_devices_tenant_lead ON hardware_package_devices (tenant_id, hardware_package_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hardware_payment_transactions_tenant_lead ON hardware_payment_transactions (tenant_id, hardware_payment_plan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hardware_reconciliation_runs_tenant_lead ON hardware_reconciliation_runs (tenant_id, billing_month);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_help_article_views_tenant_lead ON help_article_views (tenant_id, viewed_on);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integration_credential_references_tenant_lead ON integration_credential_references (tenant_id, connection_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_lines_tenant_lead ON invoice_lines (tenant_id, invoice_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ip_block_rules_tenant_lead ON ip_block_rules (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_login_attempts_tenant_lead ON login_attempts (tenant_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nail_photo_consent_tenant_lead ON nail_photo_consent (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nail_showcase_customer_score_snapshots_tenant_lead ON nail_showcase_customer_score_snapshots (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nail_showcase_photos_tenant_lead ON nail_showcase_photos (tenant_id, post_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nail_showcase_reports_tenant_lead ON nail_showcase_reports (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_delivery_logs_tenant_lead ON notification_delivery_logs (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_onboarding_records_tenant_lead ON onboarding_records (tenant_id, current_stage);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partner_payouts_tenant_lead ON partner_payouts (tenant_id, period_start);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processed_events_tenant_lead ON processed_events (tenant_id, processed_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_promotion_redemptions_tenant_lead ON promotion_redemptions (tenant_id, promotion_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_assignment_candidates_tenant_lead ON queue_assignment_candidates (tenant_id, recommendation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_queue_metrics_snapshots_tenant_lead ON queue_metrics_snapshots (tenant_id, captured_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_adjustments_tenant_lead ON revenue_adjustments (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_agreements_tenant_lead ON revenue_agreements (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_audit_log_tenant_lead ON revenue_audit_log (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_request_campaigns_tenant_lead ON review_request_campaigns (tenant_id, branch_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_tenant_lead ON sessions (tenant_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_session_events_tenant_lead ON support_session_events (tenant_id, request_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_ticket_events_tenant_lead ON support_ticket_events (tenant_id, ticket_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_ticket_messages_tenant_lead ON support_ticket_messages (tenant_id, ticket_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tech_portfolio_photos_tenant_lead ON tech_portfolio_photos (tenant_id, global_tech_profile_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_technician_status_events_tenant_lead ON technician_status_events (tenant_id, technician_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_ai_packages_tenant_lead ON tenant_ai_packages (tenant_id, package);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_api_key_uses_tenant_lead ON tenant_api_key_uses (tenant_id, used_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscriptions_tenant_lead ON tenant_subscriptions (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_trials_tenant_lead ON tenant_trials (tenant_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_deletion_codes_tenant_lead ON ticket_deletion_codes (tenant_id, ticket_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_revisions_tenant_lead ON ticket_revisions (tenant_id, ticket_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_video_progress_tenant_lead ON video_progress (tenant_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_challenges_tenant_lead ON webauthn_challenges (tenant_id, user_id);
-- payments.settlement_batch_id (BUILD_PLAN Phase 10, §19): the column is added here so its index can be built CONCURRENTLY
-- (payments is the hottest money table); the foreign key to payment_settlements is added NOT VALID + pre-flight in 539.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS settlement_batch_id uuid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_settlement_batch ON payments (tenant_id, settlement_batch_id) WHERE settlement_batch_id IS NOT NULL;
