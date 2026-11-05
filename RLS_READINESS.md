# Row-level security readiness (Postgres RLS, `DB_TENANT_RLS`)

Row-level security keys every query to the REQUEST's salon. Code that legitimately reads another salon's rows inside a
tenant request — an owner's multi-salon portfolio, the customer app (a customer spans salons), shared gift-card programs,
global technician profiles, the deals marketplace, device-keyed kiosks — would silently see nothing once the flag is on.
Such code must run its cross-salon reads EXPLICITLY under `runAcrossTenants(reason, fn)` (packages/database) before RLS
covers the tables it touches.

## customers (migration 458) — reviewed statement by statement; ready for a STAGING trial
The file-level map flagged 16 files that touch `customers` from cross-salon areas. Read one by one, SIX methods read customers
ACROSS salons inside a tenant request (a145712 said four — the statement-level scan found two more), and all six now run
under `runAcrossTenants`:
- the owner portfolio — `loadPortfolio`, `loadTotals`, `loadRevenueSeries` (an owner sees every salon they own);
- tech profile — `viewerHasBookingWithProfile` (a viewer's bookings with a GLOBAL technician, at any salon);
- nail showcase — both `notifyUser` implementations (a like, comment, moderation or follow notifies the post author /
  followed customer at THEIR salon — resolving their customers row there). Under RLS without the wrap these notifications
  would have been silently skipped (they are best-effort).
The rest filter customers by the REQUEST's salon (the customer app's session carries the salon it acts in; checkout,
wallet, customer payments, booking and the nail showcase all add tenant_id), or run with no tenant at all (the kiosk and
public registration routes do not pass through the tenant middleware; the nightly customer reconciliation is a worker).
Proof: rls-cross-salon-reads spec drives the real owner-portfolio repository through a Kysely that records the session
tenant per query — every query runs with none, even inside salon t1's request; removing the wrap fails it.

**Next step (Kevin):** set `DB_TENANT_RLS=1` in STAGING only, exercise the owner portfolio, the customer app, checkout and
the kiosk, and watch for empty lists or errors. Other tables stay out of RLS until each is reviewed the same way.

## Measured (static map, 333 tenant tables used outside Super Admin)

- **222 tables have no cross-salon code path** — the first candidates for RLS once the switch is proven.
- **111 tables are touched by a cross-salon path** — each needs its path wrapped first.
- 117 tenant tables are not referenced by application code outside Super Admin.

The map is a static scan of which files name which tables (regenerate: `python3 tooling/ci/rls-readiness.py`); it
flags candidates, it does not prove absence — staging with the flag on remains the final check.

## Tables touched by a cross-salon path

- `ai_receptionist_agents` — owner multi-salon portfolio
- `appointments` — owner multi-salon portfolio
- `audit_logs` — customer app / customer identity (a customer spans salons), global technician profiles, owner multi-salon portfolio, safety community (cross-salon reports)
- `before_after_sets` — global technician profiles
- `booking_holds` — customer app / customer identity (a customer spans salons)
- `booking_verification_platform_policy` — customer app / customer identity (a customer spans salons)
- `booking_verification_sessions` — customer app / customer identity (a customer spans salons)
- `booking_verification_settings` — customer app / customer identity (a customer spans salons)
- `booking_verification_usage_daily` — customer app / customer identity (a customer spans salons)
- `booking_verified_phones` — customer app / customer identity (a customer spans salons)
- `branches` — customer app / customer identity (a customer spans salons), deals marketplace (nearby salons), global technician profiles, go check-in / display devices (keyed by device), owner multi-salon portfolio
- `bundle_items` — deals marketplace (nearby salons)
- `bundles` — deals marketplace (nearby salons)
- `campaigns` — owner multi-salon portfolio
- `community_comments` — safety community (cross-salon reports)
- `community_evidence` — safety community (cross-salon reports)
- `community_follows` — safety community (cross-salon reports)
- `customer_addresses` — customer app / customer identity (a customer spans salons)
- `customer_blocks` — global technician profiles
- `customer_deals` — customer app / customer identity (a customer spans salons)
- `customer_display_devices` — go check-in / display devices (keyed by device), shared gift-card programs (redeemed at another salon)
- `customer_display_sessions` — go check-in / display devices (keyed by device), shared gift-card programs (redeemed at another salon)
- `customer_follows` — global technician profiles
- `customer_global_links` — customer app / customer identity (a customer spans salons)
- `customer_identity_conflicts` — customer app / customer identity (a customer spans salons)
- `customer_loyalty_profiles` — customer app / customer identity (a customer spans salons), owner multi-salon portfolio
- `customer_notifications` — customer app / customer identity (a customer spans salons), global technician profiles
- `customer_payment_methods` — customer app / customer identity (a customer spans salons)
- `customer_phone_verifications` — customer app / customer identity (a customer spans salons)
- `customer_recon_tenant_stats` — customer app / customer identity (a customer spans salons)
- `customer_referrals` — customer app / customer identity (a customer spans salons), owner multi-salon portfolio
- `customer_social_profiles` — global technician profiles
- `customer_wallet_ledger` — customer app / customer identity (a customer spans salons), shared gift-card programs (redeemed at another salon)
- `customers` — customer app / customer identity (a customer spans salons), global technician profiles, go check-in / display devices (keyed by device), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `deal_analytics_events` — deals marketplace (nearby salons)
- `deal_approvals` — deals marketplace (nearby salons)
- `deal_redemption_holds` — deals marketplace (nearby salons)
- `deal_redemptions` — deals marketplace (nearby salons)
- `deal_saves` — deals marketplace (nearby salons)
- `deal_services` — deals marketplace (nearby salons)
- `deal_settings` — deals marketplace (nearby salons)
- `deals` — deals marketplace (nearby salons)
- `expenses` — owner multi-salon portfolio
- `gift_card_claim_tokens` — customer app / customer identity (a customer spans salons)
- `gift_card_deliveries` — customer app / customer identity (a customer spans salons)
- `gift_card_presentation_tokens` — customer app / customer identity (a customer spans salons), shared gift-card programs (redeemed at another salon)
- `gift_card_program_members` — shared gift-card programs (redeemed at another salon)
- `gift_card_recipients` — customer app / customer identity (a customer spans salons)
- `gift_card_stock` — shared gift-card programs (redeemed at another salon)
- `gift_card_transactions` — customer app / customer identity (a customer spans salons), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `gift_cards` — customer app / customer identity (a customer spans salons), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `go_checkin_devices` — go check-in / display devices (keyed by device)
- `go_checkin_logs` — go check-in / display devices (keyed by device)
- `go_checkin_sessions` — go check-in / display devices (keyed by device)
- `inventory_brands` — owner multi-salon portfolio
- `inventory_categories` — owner multi-salon portfolio
- `inventory_location_stock` — owner multi-salon portfolio
- `inventory_products` — owner multi-salon portfolio
- `inventory_vendors` — owner multi-salon portfolio
- `loyalty_redemptions` — customer app / customer identity (a customer spans salons), owner multi-salon portfolio
- `loyalty_rewards` — customer app / customer identity (a customer spans salons)
- `nail_photo_consent` — global technician profiles
- `nail_showcase_customer_score_snapshots` — global technician profiles
- `nail_showcase_photos` — global technician profiles
- `nail_showcase_posts` — global technician profiles
- `nail_showcase_reports` — global technician profiles
- `owner_alerts` — owner multi-salon portfolio
- `owner_audit_log` — owner multi-salon portfolio
- `payment_attempts` — shared gift-card programs (redeemed at another salon)
- `payment_refunds` — owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `payment_signatures` — go check-in / display devices (keyed by device), shared gift-card programs (redeemed at another salon)
- `payments` — go check-in / display devices (keyed by device), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `payroll_lines` — global technician profiles, owner multi-salon portfolio
- `payroll_periods` — owner multi-salon portfolio
- `pos_payment_terminals` — go check-in / display devices (keyed by device)
- `pos_queue_items` — customer app / customer identity (a customer spans salons), deals marketplace (nearby salons), go check-in / display devices (keyed by device), owner multi-salon portfolio
- `pos_tech_appointments` — customer app / customer identity (a customer spans salons), global technician profiles, go check-in / display devices (keyed by device), owner multi-salon portfolio
- `pos_tech_queue_tickets` — global technician profiles
- `receipts` — customer app / customer identity (a customer spans salons), shared gift-card programs (redeemed at another salon)
- `reviews` — customer app / customer identity (a customer spans salons), global technician profiles, owner multi-salon portfolio
- `salon_promotions` — deals marketplace (nearby salons)
- `service_categories` — shared gift-card programs (redeemed at another salon)
- `services` — customer app / customer identity (a customer spans salons), global technician profiles, go check-in / display devices (keyed by device), shared gift-card programs (redeemed at another salon)
- `sms_usage_records` — customer app / customer identity (a customer spans salons)
- `tech_portfolio_photos` — global technician profiles
- `tech_salon_memberships` — global technician profiles
- `technician_audit_logs` — global technician profiles
- `technician_notifications` — deals marketplace (nearby salons), global technician profiles
- `technician_permissions` — global technician profiles
- `technician_schedules` — global technician profiles
- `technician_services` — global technician profiles
- `technician_shifts` — owner multi-salon portfolio
- `technician_skill_change_requests` — global technician profiles
- `technician_statuses` — global technician profiles, owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `technicians` — customer app / customer identity (a customer spans salons), deals marketplace (nearby salons), global technician profiles, owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `tenant_app_flags` — customer app / customer identity (a customer spans salons)
- `tenant_checkin_settings` — go check-in / display devices (keyed by device)
- `tenant_community_settings` — safety community (cross-salon reports)
- `tenant_messaging_credentials` — customer app / customer identity (a customer spans salons)
- `tenant_payment_config` — go check-in / display devices (keyed by device)
- `tenant_private_incidents` — safety community (cross-salon reports)
- `tenant_promotion_redemptions` — deals marketplace (nearby salons)
- `tenant_promotions` — deals marketplace (nearby salons)
- `tenant_settings` — owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `ticket_revisions` — owner multi-salon portfolio
- `ticket_service_lines` — customer app / customer identity (a customer spans salons), global technician profiles, go check-in / display devices (keyed by device), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `ticket_tip_allocations` — global technician profiles, owner multi-salon portfolio
- `tickets` — customer app / customer identity (a customer spans salons), deals marketplace (nearby salons), global technician profiles, go check-in / display devices (keyed by device), owner multi-salon portfolio, shared gift-card programs (redeemed at another salon)
- `user_branch_access` — owner multi-salon portfolio
- `user_invitations` — global technician profiles
- `users` — customer app / customer identity (a customer spans salons), global technician profiles, owner multi-salon portfolio

## Tables with no cross-salon code path

`account_deletion_requests` `ai_billing_events` `ai_booking_conversion_events` `ai_booking_revoked_links` `ai_budgets` `ai_business_alerts` `ai_business_report_jobs` `ai_business_saved_questions` `ai_checkout_upsell_dismissals` `ai_checkout_upsell_feedback` `ai_checkout_upsell_idempotency` `ai_checkout_upsell_recommendations` `ai_checkout_upsell_settings` `ai_control_modes` `ai_customer_profile_settings` `ai_feedback` `ai_jobs` `ai_receptionist_agent_versions` `ai_receptionist_faqs` `ai_receptionist_follow_ups` `ai_receptionist_handoffs` `ai_receptionist_provisioning_jobs` `ai_receptionist_settings` `ai_revenue_attributions` `ai_support_conversations` `ai_support_messages` `ai_usage_logs` `alerts` `appointment_reminder_attempts` `appointment_reminders_sent` `appointment_reschedules` `audit_events` `bank_accounts` `bank_deposits` `bank_webhook_endpoints` `bonus_rules` `booking_checkin_failed_events` `call_consent_records` `call_deletion_events` `call_intelligence_events` `call_redaction_events` `call_transcript_intelligence` `call_transcript_segments` `call_transcripts` `campaign_compliance_flags` `campaign_delivery_failures` `campaign_delivery_rollups` `cash_drawer_movements` `cash_drawer_sessions` `cash_payment_confirmations` `chargebacks` `checkout_locks` `communication_messages` `communication_threads` `compensation_adjustments` `compensation_agreements` `compensation_policies` `compensation_policy_versions` `customer_identity_links` `customer_import_jobs` `customer_legal_holds` `customer_memberships` `customer_phone_update_sessions` `customer_phones` `customer_preferences` `customer_tags` `daily_follow_up_generation_runs` `daily_follow_up_settings` `device_push_tokens` `duplicate_checkin_candidates` `event_dead_letters` `fee_schedules` `forecast_points` `hardware_autopay_consents` `hardware_card_volume` `hardware_payment_invoices` `hardware_payment_ledger` `hardware_payment_methods` `hardware_payment_plans` `hardware_payment_transactions` `hardware_reconciliation_runs` `hardware_revenue_split_settings` `help_article_feedback` `help_article_views` `integration_connections` `integration_credential_references` `inventory_alerts` `inventory_count_lines` `inventory_counts` `inventory_items` `inventory_service_recipe_lines` `inventory_service_recipes` `inventory_stock_movements` `inventory_technician_reports` `inventory_transfer_lines` `inventory_transfers` `inventory_units` `invoice_lines` `invoices` `login_attempts` `loyalty_point_earnings` `membership_activity` `membership_audit` `membership_benefits` `membership_credit_ledger` `membership_payments` `membership_plan_versions` `membership_plans` `membership_redemptions` `mobile_pay_devices` `notification_delivery_logs` `notification_opt_outs` `notifications` `ocr_document_files` `ocr_documents` `ocr_postings` `ocr_reviews` `outbox_events` `password_reset_tokens` `payment_gateway_events` `payment_intents` `payment_settlements` `platform_announcement_targets` `pos_display_devices` `pos_kpi_daily_snapshots` `pos_message_templates` `processed_events` `purchase_order_lines` `purchase_orders` `queue_alerts` `queue_assignment_candidates` `queue_assignment_decisions` `queue_assignment_recommendations` `queue_assignment_rotation_state` `queue_assignment_settings` `queue_repair_actions` `reception_copilot_action_ledger` `reception_copilot_feedback` `reception_copilot_knowledge_versions` `reception_copilot_learning_suggestions` `reception_copilot_recommendations` `reception_copilot_sessions` `reconciliation_exceptions` `reconciliation_periods` `referral_redemptions` `reminder_settings` `review_analysis` `review_approvals` `review_escalations` `review_response_drafts` `review_response_versions` `schedule_change_applications` `schedule_optimization_recommendations` `security_events` `security_incidents` `service_add_ons` `service_follow_up_tasks` `service_product_recipes` `sessions` `settings_audit_logs` `skip_line_checkout_settings` `sms_delivery_logs` `sms_reconciliation_findings` `social_posts` `store_hours_settings` `super_admin_support_sessions` `support_session_events` `support_session_requests` `support_ticket_attachments` `support_ticket_events` `support_ticket_messages` `support_tickets` `tech_cash_handoffs` `technician_app_settings` `technician_blocked_times` `technician_classifications` `technician_clock_pins` `technician_guarantee_policies` `technician_help_requests` `technician_skills` `technician_status_events` `technician_tier_plans` `technician_timecard_adjustments` `tenant_a2p_registrations` `tenant_ai_features` `tenant_ai_packages` `tenant_ai_subscriptions` `tenant_api_keys` `tenant_backup_requests` `tenant_customer_phone_settings` `tenant_deployments` `tenant_event_logs` `tenant_location_map_history` `tenant_messaging_numbers` `tenant_ocr_ai_settings` `tenant_scheduling_ai_settings` `tenant_sms_billing_cycles` `tenant_sms_package_changes` `tenant_sms_subscriptions` `tenant_subscriptions` `tenant_tap_to_pay_onboarding` `tenant_usage_limits` `tenant_webhook_deliveries` `tenant_webhooks` `ticket_change_requests` `ticket_compensation_snapshots` `ticket_number_counters` `unmatched_customer_records` `user_avatars` `user_login_alert_prefs` `user_notification_prefs` `user_ui_prefs` `video_progress` `voice_call_outcomes` `voice_gateway_idempotency` `voice_improvement_suggestions` `voice_integration_keys` `voice_prompt_versions` `voice_transcription_settings` `webauthn_challenges` `webauthn_credentials` `workflow_runs`

## Statement level — tenant predicates that are NOT on the request's salon (`python3 tooling/ci/rls-readiness.py`)

Row-level security keys every query to the request's salon, so a statement that filters on ANOTHER tenant value breaks
under it unless it runs in `runAcrossTenants`. Trusted and not listed: ctx/scope/actor `.tenantId`, a bare tenantId
parameter, `tid(ctx)`, a local alias of ctx.tenantId. Each remaining one is classified; "passed-in" values are decided
by their caller.

- `ai_checkout_upsell_idempotency` — `ai-checkout-upsell/ai-checkout-upsell.kysely.ts:53` (other value: `k.tenant_id`) — the tenant is parsed from an idempotency key built from the request ctx
- `ai_checkout_upsell_idempotency` — `ai-checkout-upsell/ai-checkout-upsell.kysely.ts:60` (other value: `k.tenant_id`) — the tenant is parsed from an idempotency key built from the request ctx
- `ai_checkout_upsell_idempotency` — `ai-checkout-upsell/ai-checkout-upsell.kysely.ts:66` (other value: `k.tenant_id`) — the tenant is parsed from an idempotency key built from the request ctx
- `ai_marketing_campaign_sends` — `ai-marketing/ai-marketing-send.adapters.ts:54` (other value: `parts.tenantId`) — a background send sweep (worker) — no tenant session
- `ai_marketing_campaign_sends` — `ai-marketing/ai-marketing-send.adapters.ts:68` (other value: `p.tenant_id`) — a background send sweep (worker) — no tenant session
- `audit_events` — `audit.kysely.repository.ts:63` (other value: `filters.tenantId`) — Super Admin platform list (filters.tenantId is the SA scope selector)
- `branches` — `auth/auth-user.kysely.repository.ts:87` (other value: `tenant.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `branches` — `auth/auth-user.kysely.repository.ts:97` (other value: `tenant.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `campaigns` — `campaigns/campaigns.kysely.repository.ts:106` (other value: `filters.tenantId`) — Super Admin platform list (filters.tenantId)
- `chargebacks` — `payments/payment-webhook.service.ts:227` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `chargebacks` — `payments/payment-webhook.service.ts:231` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `communication_threads` — `communications/communications.kysely.repository.ts:66` (other value: `filters.tenantId`) — Super Admin platform list (filters.tenantId)
- `customer_wallet_ledger` — `wallet/wallet.kysely.repository.ts:54` (other value: `e.tenantId`) — event consumer — worker, no tenant session
- `customers` — `nail-showcase/nail-showcase.kysely.repository.ts:197` (passed-in: `input.tenantId`) — CROSS-SALON BY DESIGN — the public showcase filtered by a chosen salon; needs runAcrossTenants
- `customers` — `nail-showcase/nail-showcase-social.kysely.repository.ts:228` (passed-in: `input.tenantId`) — CROSS-SALON BY DESIGN — the public showcase filtered by a chosen salon; needs runAcrossTenants
- `event_dead_letters` — `events/event-ops.service.ts:74` (passed-in: `q.tenantId`) — Super Admin event replay
- `gift_card_program_members` — `checkout/checkout.kysely.repository.ts:471` (IN-list: `[issuingTenantId, ctx.tenantId]`) — CROSS-SALON BY DESIGN — shared gift-card program (the ISSUING salon); needs runAcrossTenants before gift_cards / program tables join RLS
- `gift_cards` — `checkout/checkout.kysely.repository.ts:362` (other value: `ledgerTenantId`) — CROSS-SALON BY DESIGN — shared gift-card program (the ISSUING salon); needs runAcrossTenants before gift_cards / program tables join RLS
- `gift_cards` — `checkout/checkout.kysely.repository.ts:366` (other value: `ledgerTenantId`) — CROSS-SALON BY DESIGN — shared gift-card program (the ISSUING salon); needs runAcrossTenants before gift_cards / program tables join RLS
- `nail_showcase_posts` — `nail-showcase/nail-showcase.kysely.repository.ts:105` (other value: `q.salonId`) — CROSS-SALON BY DESIGN — the public showcase filtered by a chosen salon; needs runAcrossTenants
- `outbox_events` — `events/event-replay.service.ts:87` (other value: `req.tenantId`) — Super Admin event replay
- `outbox_events` — `events/event-ops.service.ts:86` (passed-in: `q.tenantId`) — Super Admin event replay
- `payment_refunds` — `payments/payment-webhook.service.ts:201` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `payment_settlements` — `payments/payment-webhook.service.ts:209` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `payments` — `payments/payment-webhook.service.ts:181` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `payments` — `payments/payment-webhook.service.ts:187` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `payments` — `customer-display/terminal-capture.service.ts:69` (passed-in: `row.tenantId`) — review the caller
- `payroll_periods` — `payroll/payroll.kysely.repository.ts:65` (other value: `filters.tenantId`) — Super Admin platform list (filters.tenantId)
- `pos_payment_terminals` — `customer-display/terminal-capture.service.ts:80` (passed-in: `row.tenantId`) — review the caller
- `pos_tech_appointments` — `customer-booking/customer-booking.kysely.repository.ts:80` (passed-in: `input.tenantId`) — review the caller
- `pos_tech_appointments` — `customer-booking/customer-booking.kysely.repository.ts:97` (passed-in: `input.tenantId`) — review the caller
- `pos_tech_appointments` — `customer-booking/customer-booking.kysely.repository.ts:127` (passed-in: `input.tenantId`) — review the caller
- `pos_tech_appointments` — `customer-booking/customer-booking.kysely.repository.ts:133` (passed-in: `input.tenantId`) — review the caller
- `pos_tech_appointments` — `customer-booking/customer-booking.kysely.repository.ts:135` (passed-in: `input.tenantId`) — review the caller
- `services` — `customer-salons/customer-salons.service.ts:60` (IN-list: `tenantIds`) — CROSS-SALON BY DESIGN — the customer app browsing salons; needs runAcrossTenants
- `services` — `customer-salons/customer-salons.service.ts:135` (other value: `branch.tenant_id`) — CROSS-SALON BY DESIGN — the customer app browsing salons; needs runAcrossTenants
- `tech_salon_memberships` — `tech-profile/tech-profile.service.ts:163` (other value: `target.id`) — CROSS-SALON BY DESIGN — a global technician at another salon; needs runAcrossTenants
- `technicians` — `tech-profile/tech-profile.service.ts:551` (other value: `branch.tenant_id`) — CROSS-SALON BY DESIGN — a global technician at another salon; needs runAcrossTenants
- `technicians` — `tech-profile/tech-profile.service.ts:664` (other value: `sRow.tenant_id`) — CROSS-SALON BY DESIGN — a global technician at another salon; needs runAcrossTenants
- `tenant_payment_config` — `payments/payment-webhook.service.ts:249` (other value: `tenant.tenantId`) — no tenant in play — the gateway webhook is not a tenant request (no middleware)
- `tenant_payment_config` — `customer-display/terminal-capture.service.ts:92` (passed-in: `row.tenantId`) — review the caller
- `tenant_subscriptions` — `auth/auth-user.kysely.repository.ts:79` (other value: `tenant.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `tenant_subscriptions` — `auth/auth-user.kysely.repository.ts:147` (other value: `r.tenant_id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `tickets` — `customer-display/customer-display.repository.ts:130` (passed-in: `row.tenantId`) — review the caller
- `tickets` — `customer-display/terminal-capture.service.ts:112` (passed-in: `row.tenantId`) — review the caller
- `users` — `auth/system-reset.controller.ts:48` (other value: `t.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `users` — `auth/password-reset.ports.kysely.ts:60` (other value: `t.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session
- `users` — `auth/auth-user.kysely.repository.ts:67` (other value: `tenant.id`) — no tenant in play — login / password reset / system reset run before or outside a tenant session

### Passed-in values — traced to their callers
- customer booking (`input.tenantId`, 5) — the service passes `ctx.tenantId`: the request's own salon. Safe.
- nail showcase `notifyUser` (`input.tenantId`, 2) — the POST's salon, not the request's: CROSS-SALON — now wrapped (above).
- customer display / terminal capture (`row.tenantId`, 5) — the display session row of the POS's own salon. Safe.
- event operations (`q.tenantId`, 2) — Super Admin event tooling. Safe.

## Crossing salons inside a transaction — `acrossTenantsIn(exec, reason, fn)`
`runAcrossTenants` chooses the tenant a connection is CHECKED OUT with, so inside an open transaction (connection already
checked out with the request's tenant) it has no effect. `acrossTenantsIn` clears `app.tenant_id` locally for the
transaction while its callback runs and restores it afterwards; outside a transaction it defers to `runAcrossTenants`.
Proven in rls-across-tenants-in-transaction.pgtest (including that plain runAcrossTenants does NOT help mid-transaction).
All six current customers wraps run outside transactions. **Before `gift_cards` / the program tables join RLS:** checkout's
shared-program redemption (decrementGift's cross-tenant branch, inside the payment transaction) must use `acrossTenantsIn`.
