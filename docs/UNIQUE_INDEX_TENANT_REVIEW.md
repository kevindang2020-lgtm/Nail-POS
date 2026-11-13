# Unique indexes on tenant tables without `tenant_id` — review (Oct 10 2026)

BUILD_PLAN Phase 15 C (Constitution 1 §35 "unique rules"; deferred from Phase 10, which counted 92 in
`docs/DB_SCHEMA_MEASUREMENTS_2026-10-08.md`). The question for every one: could two salons legitimately hold the same value?
If yes, a platform-wide unique index refuses the second salon (or, with `ON CONFLICT DO NOTHING`, silently drops its row).

**Method.** Enumerated from the local `postgres` database with all migrations applied: every unique index / constraint that
is not the primary key, on a table that has a `tenant_id` column, whose key does not include `tenant_id` — **96** on
Oct 10 2026 (four added since Phase 10's count). For each, the writers and readers were read (file named in the reason).
After this phase **95** remain, every one reviewed below. (Oct 13 2026: **96** — `uq_ns_posts_portfolio_photo_live`, reviewed below.)

## What was wrong — fixed in this phase

| index (before) | table | why it was wrong | fix |
|---|---|---|---|
| `uq_payment_gateway_events_processed` `(processor_type, event_id) WHERE processed` (538) | `payment_gateway_events` | The card-processor webhook's duplicate CHECK reads `(tenant, processor, event id)`, but the claim index was platform-wide. A processor event id is only promised unique inside one merchant's stream, and every salon is its own merchant (own merchant id, own webhook secret). Salon B's settlement / refund carrying the same event id as one of salon A's was answered `duplicate` and **never applied** (money not recorded). | 567 (pre-flight, transactional) + 568 (`CREATE UNIQUE INDEX CONCURRENTLY uq_payment_gateway_events_tenant_processed (tenant_id, processor_type, event_id)` same predicate, then `DROP INDEX CONCURRENTLY` the old one). Plus `chk_payment_gateway_events_processed_tenant` (a processed event always has a salon — NULL tenants never collide in a unique index, PG14 floor). No code had an `ON CONFLICT` on the old index (the webhook catches 23505). |
| `security_incidents_incident_ref_key` (global by design — kept) | `security_incidents` | The KEY the fraud detector composed was not per salon: card testing on payments with no branch was `FRAUD-card_testing-<day>-branch:none` for every salon, so the second salon's incident that day hit `ON CONFLICT DO NOTHING` — dropped, and its owner never told. | `fraudIncidentRef()` (`apps/api/src/common/fraud-detector.ts`) adds `tenant:<id>` to the no-branch subject; every other reference unchanged. |

Proof: `apps/api/src/common/unique-tenant-scope.pgtest.vitest.spec.ts` (failed 5/6 before the fix) and
`unique-tenant-scope.postgres-race.vitest.spec.ts` (real Postgres: two salons + retries concurrently; the real runner over
the real 567/568 on fixture databases — normal path, and the deferred path where 538 itself had been deferred).

**Safe on a live database.** Widening a unique key cannot create duplicates, so while 538's index is valid 568 just builds.
Only if 538 had been DEFERRED on that database (duplicates never resolved) can the new key hold duplicates; then 567 defers
the new index the Phase 10 way (count only, exact retry statement, Super Admin Database page / `db-validate-constraints.mjs`)
and closes 538's open deferral as `superseded:567…` (retrying it would rebuild the platform-wide rule), and
`scripts/migrate.mjs` **skips** a `CREATE UNIQUE INDEX CONCURRENTLY` whose name has an open deferral instead of failing the
deploy (`concurrentUniqueIndexName`, `apps/api/db/migration-sql.mjs`).

## Classes

- **GLOBAL — parent**: the key starts with a tenant-owned parent row id (uuid). The parent belongs to exactly one salon, so
  the rule is already per salon; adding `tenant_id` changes nothing.
- **GLOBAL — secret**: a token / secret / code hash presented with no salon context — the lookup itself resolves the salon,
  so it must be unique platform-wide.
- **GLOBAL — provider id**: an id issued by an outside provider that is unique across that provider.
- **GLOBAL — platform**: a platform (Super Admin) reference or a platform-owned value (physical serial, routed phone number).
- **GLOBAL — composed key**: a server-composed idempotency / dedupe key that already embeds the tenant id or a tenant-owned uuid.
- **DEAD**: no application writer — left as is, listed.

Totals (95): GLOBAL — parent 45 · platform 16 · secret 13 · composed key 9 · provider id 4 · DEAD 8. SHOULD BE TENANT-SCOPED: 0 left.

## The gate

`npm run check:unique-tenant-review` (`apps/api/scripts/audit-unique-tenant-review.mjs`, in `tooling/ci/run-gates.mjs`)
replays every migration into PGlite and FAILS when a non-PK unique index on a tenant table without `tenant_id` is not in the
table below, when a listed index's definition changed (re-review it), when a listed index no longer exists (remove the row),
or when a row's class is not one of the classes above. To add one: decide the class with the code evidence and add the row
(the definition exactly as `pg_get_indexdef` prints it after `USING btree`). A value two salons could share is not
reviewable — key it `(tenant_id, …)`.

## Reviewed (98)

| index | table | definition | class | reason / evidence |
|---|---|---|---|---|
| `ux_mobile_pay_devices_key_fingerprint` | `mobile_pay_devices` | `(key_fingerprint) WHERE (key_fingerprint IS NOT NULL)` | GLOBAL — platform | Secure Tap to Pay §58 (687): one phone key pair is one device on the WHOLE platform — a key cloned into another salon must be refused, not accepted per salon. The value is sha256 of a device-generated P-256 public key; two honest salons never share it. A collision raises DeviceKeyMismatchError (modules/checkout/src/mobile-checkout/mobile-pay-device.kysely.ts). |
| `payment_device_pairings_code_hash_key` | `payment_device_pairings` | `(code_hash)` | GLOBAL — secret | Secure Tap to Pay §7 / §70 (687): sha256 of a 32-byte random single-use pairing code; consumption also requires `tenant_id` (device-pairing.ts consume), so another salon's code matches nothing. |
| `uq_access_review_items_user` | `access_review_items` | `(review_id, user_id)` | GLOBAL — parent | review_id is an access review (one salon or the platform); one item per user per review. |
| `ai_billing_events_event_id_key` | `ai_billing_events` | `(event_id)` | GLOBAL — provider id | Event id from the PLATFORM's own AI-subscription billing provider (one account for all salons); the claim in ai-subscription-billing.repository.ts apply() is ON CONFLICT (event_id). |
| `device_history_chain_audit_log_id_key` | `device_history_chain` | `(audit_log_id)` | GLOBAL — parent | Round 10 (Device Assignments 25, 923): one chain link per audit_logs row — audit_log_id is that row's own primary key (a uuid), written by the AFTER INSERT trigger with the audit row's tenant_id, so two salons can never share it; the chain itself is ordered per salon by (tenant_id, seq). |
| `ux_ai_insight_dedup_active` | `ai_insights` | `(deduplication_key) WHERE ((deduplication_key IS NOT NULL) AND (status <> ALL (ARRAY['dismissed'::text, 'expired'::text, 'superseded'::text, 'archived'::text, 'resolved'::text])))` | DEAD | No application INSERT into ai_insights (only Super Admin status updates, ai-insights.kysely.repository.ts); left as is. |
| `ai_knowledge_chunks_document_id_chunk_index_key` | `ai_knowledge_chunks` | `(document_id, chunk_index)` | DEAD | No application writer (read-only in ai-knowledge.kysely.ts); keyed by document uuid anyway. |
| `ai_report_runs_idem` | `ai_report_runs` | `(idempotency_key)` | GLOBAL — platform | Super Admin report runs; key from buildRunIdempotencyKey (report + scope incl. tenantId + period + source) or a schedule occurrence key (report-run-core.ts). |
| `alerts_dedupe_key_key` | `alerts` | `(dedupe_key)` | GLOBAL — platform | Platform (Super Admin) alerts; every writer composes the key from a uuid or a platform reference (payment_setup:<tenantId>, payment_review:<attemptId>, incident refs, health episodes). |
| `audit_export_flags_event_ref_rule_key_key` | `audit_export_flags` | `(event_ref, rule_key)` | GLOBAL — platform | event_ref is the audit event id; Super Admin export-risk flags (audit-export-flags.service.ts upsertFlag ON CONFLICT (event_ref, rule_key)). |
| `audit_investigations_case_ref_key` | `audit_investigations` | `(case_ref)` | GLOBAL — platform | Super Admin investigation case reference, numbered platform-wide (audit-investigations.kysely.repository.ts). |
| `automation_executions_idempotency_key_key` | `automation_executions` | `(idempotency_key)` | GLOBAL — composed key | idempotencyKey({ruleVersionId, triggerEventId, tenantId, branchId, entityId}) — embeds the tenant (automation-engine.service.ts). |
| `ux_bank_webhook_endpoints_token_hash` | `bank_webhook_endpoints` | `(token_hash)` | GLOBAL — secret | POST /webhooks/bank/:token resolves the endpoint (and so the salon) by the token hash — must be unique platform-wide. |
| `billing_invoices_invoice_number_key` | `billing_invoices` | `(invoice_number)` | GLOBAL — platform | Platform subscription invoices TO salons, numbered platform-wide (super-admin-billing); salon-issued invoices live in invoices. |
| `billing_payment_attempts_idempotency_key_key` | `billing_payment_attempts` | `(idempotency_key)` | GLOBAL — platform | Super Admin retry-payment key (billing.kysely.repository.ts retryPayment), platform operator only. |
| `booking_checkin_retry_attempt_failed_event_id_idempotency_k_key` | `booking_checkin_retry_attempts` | `(failed_event_id, idempotency_key)` | GLOBAL — parent | failed_event_id is a tenant-owned failure row (uuid). |
| `uq_booking_holds_appointment` | `booking_holds` | `(converted_appointment_id) WHERE (converted_appointment_id IS NOT NULL)` | GLOBAL — parent | converted_appointment_id is a tenant-owned appointment (uuid). |
| `uq_booking_holds_live_session` | `booking_holds` | `(booking_session_id) WHERE ((booking_session_id IS NOT NULL) AND (released_at IS NULL) AND (converted_appointment_id IS NULL))` | GLOBAL — parent | booking_session_id is a tenant-owned booking session (uuid). |
| `uq_bvs_consumed_appointment` | `booking_verification_sessions` | `(consumed_appointment_id) WHERE (consumed_appointment_id IS NOT NULL)` | GLOBAL — parent | consumed_appointment_id is a tenant-owned appointment (uuid). |
| `ux_branch_health_snapshots_slot` | `branch_health_snapshots` | `(branch_id, snapshot_slot)` | GLOBAL — parent | branch_id belongs to one salon; one snapshot per branch per slot. |
| `call_transcript_intelligence_transcript_id_key` | `call_transcript_intelligence` | `(transcript_id)` | GLOBAL — parent | transcript_id is a tenant-owned transcript (uuid). |
| `call_transcript_segments_transcript_id_seq_key` | `call_transcript_segments` | `(transcript_id, seq)` | GLOBAL — parent | transcript_id is a tenant-owned transcript (uuid). |
| `ux_delivery_rollup_subject` | `campaign_delivery_rollups` | `(subject_type, subject_id)` | DEAD | No application writer (read by communications-activity / campaign-delivery only). |
| `uq_chargebacks_dispute_ref` | `chargebacks` | `(dispute_reference) WHERE (dispute_reference IS NOT NULL)` | DEAD | No application writer (only the 188 seed); Super Admin disputes page looks a dispute up by this platform reference. The per-salon processor key is uq_chargebacks_tenant_case (tenant_id, chargeback_id), 096. |
| `uq_comp_policy_version` | `compensation_policy_versions` | `(policy_id, version)` | GLOBAL — parent | policy_id is a tenant-owned compensation policy (uuid). |
| `uq_customer_blocks` | `customer_blocks` | `(blocker_user_id, blocked_user_id)` | GLOBAL — parent | blocker / blocked are user uuids. |
| `customer_deletion_requests_open_uq` | `customer_deletion_requests` | `(customer_id) WHERE (status = ANY (ARRAY['requested'::text, 'approved'::text]))` | GLOBAL — parent | customer_id is a tenant-owned customer (uuid). |
| `ux_display_pairing_open_code` | `customer_display_pairings` | `(code_hash) WHERE (claimed_at IS NULL)` | GLOBAL — secret | An UNCLAIMED display types its pairing code before it knows any salon (display-pairing.repository.ts inserts with no tenant) — the code must be unique platform-wide while open. |
| `uq_customer_display_one_active_session` | `customer_display_sessions` | `(display_device_id) WHERE ((display_device_id IS NOT NULL) AND (closed_at IS NULL) AND (state <> ALL (ARRAY['closed'::text, 'disconnected'::text])) AND (created_at >= '2026-10-05 00:00:00+00'::timestamp with time zone))` | GLOBAL — parent | display_device_id is a tenant-owned device (uuid). |
| `uq_cf_pair` | `customer_follows` | `(follower_customer_id, following_customer_id)` | GLOBAL — parent | follower / following are customer uuids. |
| `customer_global_links_customer_id_key` | `customer_global_links` | `(customer_id)` | GLOBAL — parent | customer_id is a tenant-owned customer row (uuid); one global link per salon customer. |
| `customer_identity_conflicts_fingerprint_key` | `customer_identity_conflicts` | `(fingerprint)` | GLOBAL — composed key | fingerprint = `${reason}\|${tenantId}\|${customerId}` or the platform constant SYNC_MISSED\|platform (customer-reconciliation.service.ts). |
| `customer_identity_links_user_id_key` | `customer_identity_links` | `(user_id)` | GLOBAL — parent | user_id is a user uuid; one identity link per user. |
| `customer_import_rows_job_dedup_uq` | `customer_import_rows` | `(job_id, dedup_key)` | GLOBAL — parent | job_id is a tenant-owned import job (uuid). |
| `customer_legal_holds_active_customer_uq` | `customer_legal_holds` | `(customer_id) WHERE ((status = 'active'::text) AND (customer_id IS NOT NULL))` | GLOBAL — parent | customer_id is a tenant-owned customer (uuid). |
| `uq_customer_referrals_code` | `customer_referrals` | `(code)` | GLOBAL — composed key | code = 'REF' + first 10 hex of the salon customer's uuid (customer.kysely.repository.ts getOrCreateReferralCode) — derived from a uuid, not chosen by a salon. |
| `uq_csp_customer` | `customer_social_profiles` | `(customer_id)` | GLOBAL — parent | customer_id uuid; one social profile per customer. |
| `uq_deal_hold_idem` | `deal_redemption_holds` | `(deal_id, idempotency_key)` | GLOBAL — parent | deal_id is a tenant-owned deal (uuid). |
| `uq_deal_redemption_idem` | `deal_redemptions` | `(deal_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)` | GLOBAL — parent | deal_id is a tenant-owned deal (uuid). |
| `uq_deal_redemption_ticket_live` | `deal_redemptions` | `(ticket_id, deal_id) WHERE ((status = ANY (ARRAY['applied'::text, 'redeemed'::text])) AND (ticket_id IS NOT NULL))` | GLOBAL — parent | ticket_id is a tenant-owned ticket (uuid). |
| `uq_deal_saves_user` | `deal_saves` | `(deal_id, user_id)` | GLOBAL — parent | deal_id is a tenant-owned deal (uuid). |
| `deal_versions_deal_id_version_key` | `deal_versions` | `(deal_id, version)` | GLOBAL — parent | deal_id is a tenant-owned deal (uuid). |
| `uq_deals_legacy` | `deals` | `(legacy_source, legacy_id) WHERE (legacy_source IS NOT NULL)` | GLOBAL — parent | legacy_id is the uuid of the salon_promotions / tenant_promotions row it was carried from (522). |
| `ux_device_biometric_credentials_active` | `device_biometric_credentials` | `(user_id, device_key_hash) WHERE (status = 'active'::text)` | GLOBAL — parent | user_id is a user uuid. |
| `ux_device_biometric_credentials_secret` | `device_biometric_credentials` | `(secret_hash)` | GLOBAL — secret | Device-unlock secret hash, looked up without a tenant. |
| `ux_device_maint_ref` | `device_maintenance` | `(ticket_reference)` | DEAD | No application writer (Super Admin device management reads only). |
| `uq_device_push_tokens_token` | `device_push_tokens` | `(token)` | GLOBAL — provider id | A push token names one installed app on one device; re-registering re-points it to the signed-in user (push.kysely.repository.ts upsertToken ON CONFLICT (token)). |
| `ux_device_shipment_ref` | `device_shipments` | `(shipment_reference)` | DEAD | No application writer (Super Admin device management reads only). |
| `uq_dispute_evidence_hash` | `dispute_evidence` | `(chargeback_id, file_hash) WHERE (file_hash IS NOT NULL)` | GLOBAL — parent | chargeback_id is a tenant-owned chargeback (uuid). |
| `event_dead_letters_consumer_name_event_id_key` | `event_dead_letters` | `(consumer_name, event_id)` | GLOBAL — parent | event_id is the outbox event uuid. |
| `forecast_points_unique_idx` | `forecast_points` | `(run_id, target_date, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))` | GLOBAL — parent | run_id is a tenant-owned forecast run (uuid). |
| `uq_gift_card_claim_token_hash` | `gift_card_claim_tokens` | `(token_hash)` | GLOBAL — secret | Gift-card claim link token hash, resolved without a salon. |
| `uq_gift_card_presentation_token_hash` | `gift_card_presentation_tokens` | `(token_hash)` | GLOBAL — secret | Presentation (barcode) token hash, resolved without a salon. |
| `uq_gift_cards_card_number` | `gift_cards` | `(card_number) WHERE (card_number IS NOT NULL)` | DEAD | Plaintext card_number has no writer any more (numbers are stored as card_number_hash, gift-card-number-core.ts). |
| `uq_gift_cards_card_number_hash` | `gift_cards` | `(card_number_hash) WHERE (card_number_hash IS NOT NULL)` | GLOBAL — platform | Cross-salon redemption (§15 programs) resolves a 16-digit number ACROSS salons (checkout.kysely.repository.ts resolveCrossTenantGiftCard) — the number must name one card platform-wide. Numbers are random 16 digits (generateCardNumber). Note: a pre-printed stock number already sold at another salon is refused at sale time (stock is per salon, (tenant_id, card_number_hash)). |
| `uq_go_checkin_devices_slug` | `go_checkin_devices` | `(checkin_slug)` | GLOBAL — secret | Public kiosk URL slug (random, go-check-in.service.ts newSlug) resolved with no salon (deviceBySlug). |
| `uq_go_checkin_devices_token` | `go_checkin_devices` | `(device_token_hash) WHERE (device_token_hash IS NOT NULL)` | GLOBAL — secret | Kiosk device token hash, resolved with no salon. |
| `uq_hardware_device_serial` | `hardware_package_devices` | `(serial_number) WHERE (serial_number IS NOT NULL)` | GLOBAL — platform | A manufacturer's serial number is one physical device platform-wide (Super Admin hardware packages). |
| `hardware_payment_invoices_hardware_payment_plan_id_billing__key` | `hardware_payment_invoices` | `(hardware_payment_plan_id, billing_month)` | GLOBAL — parent | hardware_payment_plan_id is a tenant-owned plan (uuid). |
| `uq_sync_job_idem` | `integration_sync_jobs` | `(connection_id, sync_type, idempotency_key) WHERE (idempotency_key IS NOT NULL)` | GLOBAL — parent | connection_id is a tenant-owned integration connection (uuid). |
| `uq_sync_record_ledger` | `integration_sync_records` | `(connection_id, provider_record_id)` | GLOBAL — parent | connection_id is a tenant-owned integration connection (uuid). |
| `uq_int_webhook_event` | `integration_webhook_events` | `(connection_id, provider_event_id)` | GLOBAL — parent | connection_id is a tenant-owned integration connection (uuid). |
| `uq_count_product` | `inventory_count_lines` | `(count_id, product_id)` | GLOBAL — parent | count_id is a tenant-owned inventory count (uuid). |
| `inventory_location_stock_branch_id_product_id_key` | `inventory_location_stock` | `(branch_id, product_id)` | GLOBAL — parent | branch_id belongs to one salon. |
| `inv_recipe_line_unique_product` | `inventory_service_recipe_lines` | `(recipe_id, product_id)` | GLOBAL — parent | recipe_id is a tenant-owned recipe (uuid). |
| `idx_inv_techrep_dedup` | `inventory_technician_reports` | `(inventory_unit_id, report_type) WHERE ((status = 'pending'::text) AND (inventory_unit_id IS NOT NULL))` | GLOBAL — parent | inventory_unit_id is a tenant-owned unit (uuid). |
| `uq_jobs_idempotency` | `jobs` | `(job_type, idempotency_key) WHERE (idempotency_key IS NOT NULL)` | GLOBAL — composed key | Every enqueueJob key embeds the tenant / branch / operation uuid or a provider SID (`${tenantId}:${day}`, `${branchId}:${day}`, `${sid}:${status}`, operation id); jobs.tenant_id is NULL for platform jobs. |
| `ux_loyalty_corr_bucket` | `loyalty_calculation_corrections` | `(bucket_key)` | GLOBAL — composed key | correctionBucket(tenantId, customerId, type) — embeds the tenant (loyalty-corrections.service.ts). |
| `ux_loyalty_susp_bucket` | `loyalty_suspicious_cases` | `(bucket_key)` | GLOBAL — composed key | bucketKey(tenantId, customerId, signal, day[, id]) — embeds the tenant (loyalty-suspicious.service.ts). |
| `membership_payments_idem` | `membership_payments` | `(idempotency_key)` | GLOBAL — composed key | renewalIdempotencyKey(membershipId, dueDate, attempt) — the membership uuid (membership-billing.service.ts). |
| `membership_plan_versions_plan_ver` | `membership_plan_versions` | `(plan_id, version_number)` | GLOBAL — parent | plan_id is a tenant-owned plan (uuid). |
| `membership_redemptions_service_line_uq` | `membership_redemptions` | `(service_line_id) WHERE (service_line_id IS NOT NULL)` | GLOBAL — parent | service_line_id is a tenant-owned ticket line (uuid). |
| `nail_photo_consent_photo_id_key` | `nail_photo_consent` | `(photo_id)` | GLOBAL — parent | photo_id uuid. |
| `uq_nscss_scope` | `nail_showcase_customer_score_snapshots` | `(customer_id, scope, period)` | GLOBAL — parent | customer_id uuid; the only writer stores scope 'platform' (nail-showcase-ranking.service.ts). |
| `uq_ocr_postings_idem` | `ocr_postings` | `(idempotency_key)` | GLOBAL — composed key | buildIdempotencyKey = `${tenantId}:${documentId}:${destination}:${version}` (ai-ocr-receipt-posting.ts). |
| `onboarding_records_application_uq` | `onboarding_records` | `(application_id)` | GLOBAL — parent | application_id is a tenant application (uuid), created before the salon exists. |
| `uq_partner_payouts_idem` | `partner_payouts` | `(idempotency_key)` | GLOBAL — platform | sha256(payout\|agreement\|processor\|period) — Super Admin residual payouts (super-admin-revenue-residuals). |
| `idx_payroll_lines_period_tech` | `payroll_lines` | `(period_id, technician_id)` | GLOBAL — parent | period_id is a tenant-owned payroll period (uuid). |
| `ux_realtime_stream_tickets_hash` | `realtime_stream_tickets` | `(ticket_hash)` | GLOBAL — secret | Stream ticket hash, presented with no salon. |
| `uq_residual_statements_hash` | `residual_statements` | `(import_hash)` | GLOBAL — platform | Super Admin processor residual statement import hash (platform ISO statements). |
| `revenue_adjustments_adjustment_ref_key` | `revenue_adjustments` | `(adjustment_ref)` | GLOBAL — platform | Super Admin revenue adjustment reference. |
| `revenue_agreements_code_key` | `revenue_agreements` | `(code)` | GLOBAL — platform | Super Admin revenue-share agreement code. |
| `uq_sched_apply_idem` | `schedule_change_applications` | `(idempotency_key)` | GLOBAL — composed key | applyKey = `${tenantId}:${recId}:apply:${attempt}` (ai-scheduling-application.ts). |
| `security_incidents_incident_ref_key` | `security_incidents` | `(incident_ref)` | GLOBAL — platform | Platform incident reference (INC-yyyy-nnn, FRAUD-…). Phase 15 C fixed its fraud-detector KEY: card testing with no branch was `branch:none` for every salon, so the second salon's incident was dropped — now fraudIncidentRef adds the salon (fraud-detector.ts). |
| `uq_service_product` | `service_product_recipes` | `(service_id, product_id)` | GLOBAL — parent | service_id is a tenant-owned service (uuid). |
| `uq_sms_delivery_logs_provider_sid` | `sms_delivery_logs` | `(provider_sid) WHERE (provider_sid IS NOT NULL)` | GLOBAL — provider id | Twilio message SID — unique across Twilio. (No application writer today.) |
| `uq_sms_usage_provider_sid` | `sms_usage_records` | `(provider, provider_message_id) WHERE (provider_message_id IS NOT NULL)` | GLOBAL — provider id | Provider message id (Twilio SID), unique across the provider. |
| `support_tickets_ticket_number_key` | `support_tickets` | `(ticket_number)` | GLOBAL — platform | Platform support ticket number (time + random, support-tickets.service.ts), searched by Super Admin. |
| `ux_tenant_api_keys_secret` | `tenant_api_keys` | `(secret_hash)` | GLOBAL — secret | API key secret hash — the key authenticates and so RESOLVES the salon. |
| `uq_tenant_incentives_idem` | `tenant_incentives` | `(idempotency_key)` | GLOBAL — platform | sha256(incentive\|agreement\|tenantId\|period) — embeds the tenant (super-admin-revenue-residuals). |
| `tenant_location_hours_location_id_day_of_week_key` | `tenant_location_hours` | `(location_id, day_of_week)` | GLOBAL — parent | location_id is a tenant-owned location (uuid). |
| `uq_tenant_messaging_number` | `tenant_messaging_numbers` | `(phone_number)` | GLOBAL — platform | An inbound SMS is routed to the salon BY the number (twilio-inbound.service.ts SELECT tenant_id … WHERE phone_number) — one number, one salon. |
| `promotion_redemptions_idem` | `tenant_promotion_redemptions` | `(promotion_id, idempotency_key)` | DEAD | Frozen table (523): no writer; rows carried into deal_redemptions. |
| `uq_ns_posts_portfolio_photo_live` | `nail_showcase_posts` | `(portfolio_photo_id) WHERE ((portfolio_photo_id IS NOT NULL) AND (deleted_at IS NULL) AND (status <> 'removed'::text))` | GLOBAL — parent | portfolio_photo_id is a tech_portfolio_photos uuid owned by ONE global technician profile (647, Technician Profile §46): one live showcase post per photo platform-wide is the rule — a second share from another salon she works at is "already shared" (tech-profile.service.ts sharePhotoToShowcase), never two posts of one photo. |
| `ticket_deletion_codes_ticket_id_key` | `ticket_deletion_codes` | `(ticket_id)` | GLOBAL — parent | ticket_id is a tenant-owned ticket (uuid). |
| `user_invitations_token_hash_uq` | `user_invitations` | `(token_hash)` | GLOBAL — secret | Invitation link token hash, opened with no salon. |
| `uq_voice_keys_active_hash` | `voice_integration_keys` | `(secret_hash) WHERE (revoked_at IS NULL)` | GLOBAL — secret | Voice-integration key hash — authenticates and resolves the salon. |
| `webauthn_challenges_handle_key` | `webauthn_challenges` | `(handle)` | GLOBAL — secret | Random challenge handle. |
| `webauthn_credentials_credential_id_key` | `webauthn_credentials` | `(credential_id)` | GLOBAL — secret | Authenticator-generated credential id (random, per registration) — the sign-in ceremony finds the user by it. |
| `uq_ai_billing_invoice_events` | `ai_billing_invoice_events` | `(provider, provider_event_id)` | GLOBAL — provider id | The platform's billing provider event id (one AI PowerSalon provider account bills every salon), unique within that provider; the webhook ingest dedupes on it with `ON CONFLICT … DO NOTHING` before the salon is resolved (ai-billing-invoices.ts ingest). Reviewed Oct 30 2026 gap sweep. |
| `uq_ai_billing_invoice_line` | `ai_billing_invoice_line_snapshots` | `(invoice_link_id, provider_line_id)` | GLOBAL — parent | invoice_link_id is a tenant-owned ai_billing_invoice_links row (uuid). |
| `uq_retention_sms_recipients_customer` | `retention_sms_recipients` | `(campaign_id, customer_id)` | GLOBAL — parent | campaign_id is a tenant-owned retention_sms_campaigns row (uuid): one recipient row per customer per campaign. |
| `uq_retention_sms_recipients_destination` | `retention_sms_recipients` | `(campaign_id, destination) WHERE ((destination IS NOT NULL) AND (eligibility = 'eligible'::text))` | GLOBAL — parent | campaign_id is a tenant-owned campaign (uuid): one text per phone number per campaign (two customers sharing a number get one). |
| `uq_sms_test_provider_sid` | `sms_test_events` | `(provider_message_sid) WHERE (provider_message_sid IS NOT NULL)` | GLOBAL — provider id | Twilio message SID — unique across Twilio; the signed status callback finds the test send by it (twilio-inbound.service.ts). |
| `uq_tnpq_token` | `tenant_number_purchase_quotes` | `(token_hash)` | GLOBAL — secret | sha256 of a random one-time purchase-quote token (tenant-number.service.ts); every read and claim also filters tenant_id. |
| `merchant_reimbursements_redemption_id_key` | `merchant_reimbursements` | `(redemption_id)` | GLOBAL — parent | redemption_id is a tenant-owned reward_redemptions row (uuid): exactly one reimbursement payable per committed redemption — the guide's "never finalize merchant reimbursement twice" (LoyaltyTokens.pdf §6.4). |
| `rewards_journal_entries_source_table_source_id_entry_type_key` | `rewards_journal_entries` | `(source_table, source_id, entry_type)` | GLOBAL — composed key | One journal entry per business source: source_id is the UUID of a tenant-owned purchase / earn / redemption / refund row, so two salons never share a key; tenant_id is NULL on platform cash lines, which is why it is not part of the key (a NULL would defeat the uniqueness). |
| `uq_tpi_provider_ref` | `token_purchase_intents` | `(provider, provider_ref) WHERE (provider_ref IS NOT NULL)` | GLOBAL — provider id | The funding provider's order / payment reference — unique within that provider; a verified webhook resolves the purchase by it (LoyaltyTokens.pdf §5.3 "unique provider-reference constraints are mandatory"). |
| `uq_pa_provider_payout` | `payout_attempts` | `(provider, provider_payout_id) WHERE (provider_payout_id IS NOT NULL)` | GLOBAL — provider id | The payout provider's own payout id — unique within that provider; a verified settlement callback resolves the attempt by it (Final Completion guide §05: one payout per payable, no duplicate settlement). |
| `uq_pa_provider_event` | `payout_attempts` | `(provider, provider_event_id) WHERE (provider_event_id IS NOT NULL)` | GLOBAL — provider id | The provider's callback event id — a replayed / duplicated settlement callback hits this key and changes nothing (guide §06 "handle duplicates and out-of-order messages"). |
| `uq_pa_one_live` | `payout_attempts` | `(reimbursement_id) WHERE (status = ANY (ARRAY['REQUESTED'::text, 'SUBMITTED'::text, 'UNKNOWN'::text, 'SETTLED'::text]))` | GLOBAL — parent | `reimbursement_id` is a uuid FK to one salon's `merchant_reimbursements` row (globally unique id): at most one live payout per payable. |
| `uq_airr_no` | `ai_receptionist_faq_revisions` | `(faq_id, revision_no)` | GLOBAL — parent | `faq_id` is one salon's `ai_receptionist_faqs` row (uuid); revision numbers are per FAQ, written only by business-setup-center.ts inside the FAQ's row lock (migration 753). |
| `uq_brp_backup_ref` | `backup_recovery_points` | `(environment, backup_ref)` | GLOBAL — platform | G9 (migration 819): the platform recovery catalog. `backup_ref` is the provider's backup identity in one AI PowerSalon environment (a platform backup covers every salon); a tenant-scoped logical export carries its own platform-issued ref. A re-reported backup must resolve to the SAME point (backup-center.service `insertPoint` ON CONFLICT). |
| `uq_brpl_idempotency` | `backup_restore_plans` | `(idempotency_key)` | GLOBAL — platform | G9: a Super Admin restore plan's request key (a random UUID from the Backup Center form); plans are created only by platform operators, so a double click resolves to the first plan platform-wide. |
| `loyalty_fraud_alerts_dedupe_key_key` | `loyalty_fraud_alerts` | `(dedupe_key)` | GLOBAL — composed key | A platform-wide (Super Admin) review queue: the detector builds the key from the signal + the record ids it saw (e.g. `payout_mismatch:<attempt uuid>`), so the same evidence never raises two alerts. |
