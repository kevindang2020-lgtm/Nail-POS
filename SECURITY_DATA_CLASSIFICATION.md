# SECURITY_DATA_CLASSIFICATION.md — Constitution 12 §7–14

**Generated from the real schema (637 tables) on September 22, 2026 and guarded by `data-classification.pgtest.vitest.spec.ts`,**
which fails when a new secret-shaped column lands without `_enc`/`_hash`/`_ciphertext`, or when a table's class here disagrees with the
generator's rules. Regenerate with `node scripts/classify-schema.mjs` (the generator is the rules below, applied to `information_schema`).

| Class | Tables | Tenant-scoped | What | Requirements (encryption · logging · AI · export · retention) |
|---|---|---|---|---|
| **SECURITY_SECRET** | 24 | 18 | Passwords, MFA seeds, provider/payment credentials, signing secrets, API-key hashes, session/reset tokens. | Never in UI, logs, AI, exports. Hashed (passwords, tokens, API keys) or AES-256-GCM (`*_enc`, `*_ciphertext`). Retention: with the owning record; tokens expire. |
| **PAYMENT_RESTRICTED** | 55 | 45 | Processor references, merchant configuration, settlements, bank/funding data, refunds, payouts. | Tenant-scoped; bank fields encrypted; never full PAN/CVV (none exist); logs may carry ids/amounts only; AI: never raw; export: finance permission only; retention: financial (7 years). |
| **HIGHLY_SENSITIVE** | 89 | 71 | Voice recordings, transcripts, private notes, compensation/payroll/earnings, evidence, identity recovery. | Tenant-scoped; access by explicit permission; logs: ids only; AI: minimised, never transcripts by default; export: step-up + audit; retention: configurable, recordings not indefinite. |
| **CONFIDENTIAL** | 116 | 103 | Customer/employee identities and contact data, appointments, tickets, messages, reviews. | Tenant-scoped; phone/email masked in logs; AI: only what a task needs; export: customer-data permission; retention: business record. |
| **INTERNAL** | 347 | 246 | Platform configuration, metrics summaries, feature definitions, catalogs, job/state tables. | Not customer data; logging allowed; export by Super Admin. |
| **PUBLIC** | 6 | 1 | Status page, product updates, public catalog templates. | No restrictions. |

## Secret-bearing columns (SECURITY_SECRET) — every one hashed or encrypted

- `ai_providers`: `api_key_ciphertext`, `api_key_fingerprint`, `api_key_masked`
- `bank_webhook_endpoints`: `signing_secret`
- `communication_providers`: `credential_enc`
- `customer_display_devices`: `device_token_hash`
- `customer_display_sessions`: `public_token_hash`
- `customer_identities`: `password_hash`
- `gift_card_claim_tokens`: `token_hash`
- `gift_card_presentation_tokens`: `token_hash`
- `go_checkin_devices`: `device_token_hash`
- `go_checkin_sessions`: `session_token_hash`
- `integration_credential_references`: `secret_enc`
- `integration_oauth_states`: `code_verifier_enc`
- `merchant_funding_profiles`: `bank_account_enc`, `routing_number_enc`
- `mfa_factors`: `secret_enc`
- `password_reset_tokens`: `token_hash`
- `refresh_tokens`: `token_hash`
- `tenant_api_keys`: `secret_hash`
- `tenant_messaging_credentials`: `auth_token_enc`, `auth_token_last4`
- `tenant_payment_config`: `api_password_enc`, `api_username_enc`, `bolt_api_key_enc`, `webhook_secret_enc`
- `tenant_webhooks`: `signing_secret_enc`
- `ticket_deletion_codes`: `code_enc`
- `user_invitations`: `token_hash`
- `users`: `password_hash`, `temp_password_hash`, `temporary_password_hash`
- `voice_integration_keys`: `secret_hash`

**Known exception (finding M6, fixed in Phase 7):** `bank_webhook_endpoints.signing_secret` is a plaintext column — the only secret in the schema
without `_enc`. The guard test carries it as an explicit allowlist entry that shrinks to nothing when Phase 7 lands.

## Tables by class

### PAYMENT_RESTRICTED (55)
`bank_accounts`, `bank_deposits`, `cash_drawer_sessions`, `chargebacks`, `checkout_settings`, `customer_payment_methods`, `dispute_funds_events`, `gift_card_adjustments`, `gift_card_clearing_entries`, `gift_card_deliveries`, `gift_card_designs`, `gift_card_fraud_flags`, `gift_card_program_members`, `gift_card_programs`, `gift_card_recipients`, `gift_card_redemption_holds`, `gift_card_settlement_batches`, `gift_card_stock`, `gift_card_transactions`, `gift_cards`, `hardware_card_volume`, `hardware_payment_invoices`, `hardware_payment_methods`, `inventory_brands`, `inventory_products`, `loyalty_calculation_corrections`, `merchant_account_alerts`, `merchant_pricing_plans`, `merchant_rate_schedules`, `merchant_risk_reviews`, `ocr_documents`, `onboarding_records`, `overview_monthly_snapshots`, `partner_payouts`, `payment_gateway_events`, `payment_refunds`, `payment_settlements`, `payments`, `payroll_lines`, `platform_branding`, `pos_messaging_sender`, `product_master`, `residual_statement_lines`, `residual_statements`, `revenue_agreement_versions`, `revenue_records`, `settlement_notes`, `tech_portfolio_photos`, `technician_timecard_adjustments`, `tenant_a2p_registrations`, `tenant_applications`, `tenant_daily_sales_summary`, `tenant_incentives`, `ticket_compensation_snapshots`, `website_leads`

### HIGHLY_SENSITIVE (89)
`access_requests`, `account_deletion_requests`, `ai_feedback`, `ai_narrative_model_versions`, `ai_price_versions`, `ai_receptionist_follow_ups`, `alert_notes`, `audit_evidence_custody`, `audit_evidence_packs`, `audit_export_flags`, `automation_exceptions`, `automation_rule_versions`, `before_after_sets`, `billing_invoice_lines`, `billing_invoices`, `branches`, `bundles`, `call_deletion_events`, `call_redaction_events`, `call_transcript_intelligence`, `call_transcript_segments`, `call_transcripts`, `campaign_template_versions`, `campaign_templates`, `cash_drawer_movements`, `cash_payment_confirmations`, `community_appeals`, `community_disputes`, `community_evidence`, `compensation_adjustments`, `compensation_agreements`, `compensation_policies`, `compensation_policy_versions`, `customer_allergies`, `customer_deletion_requests`, `customer_legal_holds`, `customer_preferences`, `customer_privacy_requests`, `customers`, `dispute_evidence`, `emergency_lockdown_events`, `fee_schedules`, `global_tech_delete_requests`, `hardware_package_notes`, `hardware_packages`, `hardware_reconciliation_runs`, `inventory_counts`, `inventory_service_recipes`, `inventory_technician_reports`, `inventory_transfers`, `inventory_units`, `invoice_lines`, `invoices`, `lead_follow_ups`, `loyalty_point_earnings`, `membership_plans`, `money_protection_investigation_notes`, `ocr_reviews`, `onboarding_notes`, `payroll_periods`, `payroll_sync_events`, `pos_queue_items`, `pos_tech_appointments`, `pos_tech_queue_tickets`, `privileged_access_grant_events`, `processor_reconciliations`, `product_distributions`, `purchase_orders`, `reception_copilot_learning_suggestions`, `reconciliation_exceptions`, `reconciliation_periods`, `review_internal_notes`, `service_product_recipes`, `tech_cash_handoffs`, `technician_blocked_times`, `technician_help_requests`, `technician_skill_change_requests`, `tenant_tap_to_pay_onboarding`, `tenant_warnings`, `ticket_service_lines`, `tickets`, `video_tutorials`, `voice_call_outcomes`, `voice_gateway_idempotency`, `voice_improvement_suggestions`, `voice_prompt_versions`, `voice_transcription_settings`, `worker_cross_tenant_transfer_requests`, `worker_transfer_requests`

### CONFIDENTIAL (116)
`ai_customer_profile_settings`, `ai_support_messages`, `appointment_availability_recommendations`, `appointment_change_log`, `appointment_reminder_attempts`, `appointment_reminders_sent`, `appointment_reschedules`, `appointment_waitlist`, `audit_logs`, `booking_checkin_retry_attempts`, `booking_verification_sessions`, `booking_verified_phones`, `call_intelligence_events`, `communication_messages`, `customer_addresses`, `customer_blocks`, `customer_deals`, `customer_favorite_salons`, `customer_favorite_techs`, `customer_follows`, `customer_global_links`, `customer_identity_conflicts`, `customer_identity_links`, `customer_import_jobs`, `customer_import_rows`, `customer_loyalty_profiles`, `customer_memberships`, `customer_merge_logs`, `customer_notifications`, `customer_phone_update_sessions`, `customer_phone_verifications`, `customer_phones`, `customer_recon_runs`, `customer_recon_tenant_stats`, `customer_referrals`, `customer_social_profiles`, `customer_tags`, `customer_wallet_ledger`, `global_customers`, `global_tech_profiles`, `hardware_autopay_consents`, `inventory_vendors`, `login_attempts`, `message_template_versions`, `message_templates`, `nail_showcase_customer_score_snapshots`, `notification_opt_outs`, `notifications`, `pos_booking_integrations`, `pos_message_templates`, `pos_tech_appointments_audit`, `reminder_template_versions`, `review_analysis`, `review_approvals`, `review_escalations`, `review_publications`, `review_recovery_actions`, `review_request_campaigns`, `review_request_events`, `review_requests`, `review_response_drafts`, `review_response_versions`, `reviews`, `scheduled_reports`, `service_follow_up_tasks`, `sessions`, `sms_delivery_logs`, `sms_reconciliation_findings`, `sms_usage_records`, `sms_verification_packages`, `super_admin_support_sessions`, `support_access_sessions`, `support_ticket_attachments`, `support_ticket_events`, `support_ticket_messages`, `support_tickets`, `tech_dm_messages`, `technician_app_settings`, `technician_audit_logs`, `technician_classifications`, `technician_clock_pins`, `technician_guarantee_policies`, `technician_notifications`, `technician_permissions`, `technician_schedules`, `technician_services`, `technician_shifts`, `technician_skills`, `technician_status_events`, `technician_statuses`, `technician_tier_plans`, `technicians`, `tenant_checkin_settings`, `tenant_customer_phone_settings`, `tenant_daily_customer_summary`, `tenant_daily_review_summary`, `tenant_daily_technician_summary`, `tenant_location_map_history`, `tenant_messaging_limits`, `tenant_messaging_numbers`, `tenant_sms_billing_cycles`, `tenant_sms_package_changes`, `tenant_sms_subscriptions`, `tenants`, `ticket_change_requests`, `ticket_number_counters`, `ticket_revisions`, `ticket_tip_allocations`, `unmatched_customer_records`, `user_avatars`, `user_branch_access`, `user_login_alert_prefs`, `user_notification_prefs`, `user_permissions`, `user_roles`, `user_ui_prefs`

### PUBLIC (6)
`business_categories`, `product_updates`, `public_check_in_sessions`, `service_templates`, `status_components`, `status_incidents`

### INTERNAL (347)
Everything not listed above: configuration, catalogs, metrics summaries, job state, platform tables. Full list: the generator's output.

## Rules the generator applies (so the class is reproducible)
1. Any column matching `_enc$|_ciphertext$|password_hash|secret_hash|token_hash|_secret$|totp|api_key|auth_token|private_key` → **SECURITY_SECRET**.
2. Else a table or column matching `card|pan|cvv|last4|brand|processor_(reference|transaction)|merchant|settlement|bank|routing|refund|payout` → **PAYMENT_RESTRICTED**.
3. Else a table matching `transcript|recording|voice|compensation|payroll|earning|notes|evidence|bank` or a column matching `notes|transcript|recording|ssn|tax_id|dob` → **HIGHLY_SENSITIVE**.
4. Else any PII column (`phone|email|address|street|zip|first/last/full_name|ip_address|user_agent`) or a table matching `customer|appointment|ticket|user|technician|employee|message|sms|email|review` → **CONFIDENTIAL**.
5. Else status page / product updates / public catalog → **PUBLIC**; everything else **INTERNAL**.
Tenant-scoped = the table has a `tenant_id` column (484 of 637).
