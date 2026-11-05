# DB_INDEX_AUDIT.md

**GENERATED FROM THE LIVE CATALOG — do not hand-edit.** Regenerate:
`cd apps/api && node scripts/generate-index-audit.mjs > ../../DB_INDEX_AUDIT.md`

Generated 2026-07-30. **1825 indexes across 618 tables** (includes primary keys and
constraint-backed indexes). Policy: **REPORT-ONLY.** Unique/partial-unique indexes are business POLICY in this
schema (SID dedupe, open-findings dedupe — see DATABASE_ARCHITECTURE.md §5) and are never flagged. Any drop is
a production decision measured with `pg_stat_user_indexes.idx_scan` — never an audit side-effect.

## Exact duplicates (0)

None. Every index definition is unique.

## Prefix-covered candidates (75) — candidates, not verdicts
A narrower non-unique btree whose key columns are the leading prefix of a wider index on the same table. The
wider index can usually serve the narrower one's scans; the narrower one may still win on size/cache. Decide
per-index in production with usage stats.

| Table | Narrow (candidate) | Covered by | Narrow cols | Covering cols | Note |
| --- | --- | --- | --- | --- | --- |
| ai_checkout_upsell_settings | ai_checkout_upsell_settings_tenant | ai_checkout_upsell_settings_scope | tenant_id | tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid) |  |
| ai_control_modes | idx_ai_control_modes_tenant | ai_control_modes_tenant_id_assistant_key_key | tenant_id | tenant_id, assistant_key |  |
| ai_customer_profile_settings | ai_customer_profile_settings_tenant | ai_customer_profile_settings_scope | tenant_id | tenant_id, level, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid) |  |
| ai_receptionist_agent_versions | idx_air_agent_versions_agent | uq_air_agent_version | tenant_id, agent_id | tenant_id, agent_id, version |  |
| bank_deposits | ix_bank_deposits_account | ux_bank_deposits_external | tenant_id, bank_account_id | tenant_id, bank_account_id, external_bank_txn_id | covering is PARTIAL — verify predicate covers the narrow index’s queries before any decision |
| campaign_template_versions | ix_template_versions_template | ux_template_version | template_id | template_id, version |  |
| cash_payment_confirmations | idx_cash_conf_tenant | idx_cash_conf_tech | tenant_id | tenant_id, technician_id, status |  |
| cash_payment_confirmations | idx_cash_conf_tenant | idx_cash_conf_ticket | tenant_id | tenant_id, ticket_id |  |
| chargebacks | idx_chargebacks_tenant | idx_chargebacks_tenant_status | tenant_id | tenant_id, status |  |
| chargebacks | idx_chargebacks_tenant | uq_chargebacks_tenant_case | tenant_id | tenant_id, chargeback_id | covering is PARTIAL — verify predicate covers the narrow index’s queries before any decision |
| customer_favorite_salons | idx_cfs_user | customer_favorite_salons_pkey | user_id | user_id, salon_id |  |
| customer_follows | idx_cf_follower | uq_cf_pair | follower_customer_id | follower_customer_id, following_customer_id |  |
| customer_identity_links | ix_cil_identity | customer_identity_links_identity_id_tenant_id_key | identity_id | identity_id, tenant_id |  |
| customer_import_rows | customer_import_rows_job_idx | customer_import_rows_job_dedup_uq | job_id | job_id, dedup_key |  |
| customer_tags | idx_customer_tags_customer | customer_tags_pkey | tenant_id, customer_id | tenant_id, customer_id, tag |  |
| customers | idx_customers_tenant_branch | idx_customers_tenant_branch_created | tenant_id, branch_id | tenant_id, branch_id, created_at |  |
| customers | idx_customers_tenant_branch | idx_customers_tenant_branch_email | tenant_id, branch_id | tenant_id, branch_id, email |  |
| customers | idx_customers_tenant_branch | idx_customers_tenant_branch_name | tenant_id, branch_id | tenant_id, branch_id, full_name |  |
| customers | idx_customers_tenant_branch | idx_customers_tenant_branch_phone | tenant_id, branch_id | tenant_id, branch_id, normalized_phone |  |
| customers | idx_customers_tenant_branch | idx_customers_tenant_branch_status | tenant_id, branch_id | tenant_id, branch_id, status |  |
| deal_redemptions | idx_deal_redemptions_deal | idx_deal_redemptions_customer | deal_id | deal_id, customer_id |  |
| dispute_evidence | idx_dispute_evidence_cb | uq_dispute_evidence_hash | chargeback_id | chargeback_id, file_hash | covering is PARTIAL — verify predicate covers the narrow index’s queries before any decision |
| hardware_card_volume | idx_hw_card_volume_tenant | hardware_card_volume_tenant_id_billing_month_key | tenant_id | tenant_id, billing_month |  |
| help_article_feedback | idx_help_feedback_article | uq_help_feedback_voter | article_id | article_id, tenant_id, user_id |  |
| help_article_views | idx_help_article_views_article | help_article_views_article_id_tenant_id_user_id_viewed_on_key | article_id | article_id, tenant_id, user_id, viewed_on |  |
| integration_connections | ix_integration_conn_provider | uq_integration_conn_scope | provider_key | provider_key, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) | covering is PARTIAL — verify predicate covers the narrow index’s queries before any decision |
| inventory_count_lines | idx_count_lines | uq_count_product | count_id | count_id, product_id |  |
| inventory_service_recipe_lines | inv_service_recipe_lines_recipe_idx | inv_recipe_line_unique_product | recipe_id | recipe_id, product_id |  |
| merchant_funding_profiles | idx_merchant_funding_profiles_current | idx_merchant_funding_profiles_issue | tenant_id | tenant_id, has_funding_issue | same partial predicate |
| money_protection_rule_settings | idx_mp_rule_settings_tenant | money_protection_rule_settings_tenant_id_rule_id_key | tenant_id | tenant_id, rule_id |  |
| payment_intents | idx_payment_intents_tenant | idx_payment_intents_customer | tenant_id | tenant_id, customer_id |  |
| payment_intents | idx_payment_intents_tenant | idx_payment_intents_ticket | tenant_id | tenant_id, ticket_id |  |
| payments | idx_payments_tenant_branch_created | idx_payments_tenant_branch_created_method | tenant_id, branch_id, created_at | tenant_id, branch_id, created_at, method |  |
| payroll_sync_events | idx_payroll_sync_events_tenant | payroll_sync_events_idem | tenant_id | tenant_id, idempotency_key |  |
| plan_features | idx_plan_features_plan | plan_features_plan_id_feature_key_key | plan_id | plan_id, feature_key |  |
| plan_limits | idx_plan_limits_plan | plan_limits_plan_id_metric_key | plan_id | plan_id, metric |  |
| pos_display_devices | idx_devices_tenant | pos_display_devices_pkey | tenant_id | tenant_id, id |  |
| pos_payment_terminals | idx_terminals_tenant | pos_payment_terminals_pkey | tenant_id | tenant_id, id |  |
| pos_project_status_checks | idx_pps_checks_tenant | pos_project_status_checks_tenant_id_module_key_key | tenant_id | tenant_id, module_key |  |
| pos_queue_items | idx_pos_queue_items_tenant_branch | idx_pos_queue_items_tenant | tenant_id, branch_id | tenant_id, branch_id, status, checked_in_at |  |
| product_distributions | ix_product_distribution_master | ux_product_distribution_master_tenant | master_product_id | master_product_id, tenant_id |  |
| reminder_plan_features | ix_reminder_plan_features | reminder_plan_features_plan_code_feature_key_key | plan_code | plan_code, feature_key |  |
| services | idx_services_tenant_branch | idx_services_tenant_branch_category | tenant_id, branch_id | tenant_id, branch_id, category_id |  |
| services | idx_services_tenant_branch | idx_services_tenant_branch_name | tenant_id, branch_id | tenant_id, branch_id, name |  |
| services | idx_services_tenant_branch | idx_services_tenant_branch_status | tenant_id, branch_id | tenant_id, branch_id, status |  |
| store_hours_settings | idx_store_hours_tenant | uq_store_hours_tenant_branch | tenant_id | tenant_id, branch_id |  |
| subscription_plan_versions | idx_plan_versions_plan | subscription_plan_versions_plan_id_version_number_key | plan_id | plan_id, version_number |  |
| super_admin_saved_views | idx_super_admin_saved_views_owner | super_admin_saved_views_unique | owner_user_id, surface | owner_user_id, surface, name |  |
| technician_clock_pins | idx_technician_clock_pins_tenant | technician_clock_pins_pkey | tenant_id | tenant_id, technician_id |  |
| technician_permissions | idx_techperm_tenant_tech | technician_permissions_pkey | tenant_id, technician_id | tenant_id, technician_id, permission_key |  |
| technicians | idx_technicians_tenant_branch | idx_technicians_tenant_branch_name | tenant_id, branch_id | tenant_id, branch_id, full_name |  |
| technicians | idx_technicians_tenant_branch | idx_technicians_tenant_branch_phone | tenant_id, branch_id | tenant_id, branch_id, normalized_phone |  |
| technicians | idx_technicians_tenant_branch | idx_technicians_tenant_branch_status | tenant_id, branch_id | tenant_id, branch_id, status |  |
| tenant_ai_features | idx_tenant_ai_features_tenant | tenant_ai_features_pkey | tenant_id | tenant_id, feature_key |  |
| tenant_ai_subscriptions | idx_tenant_ai_subscriptions_tenant | tenant_ai_subscriptions_tenant_id_package_code_key | tenant_id | tenant_id, package_code |  |
| tenant_app_flags | idx_tenant_app_flags_tenant | tenant_app_flags_pkey | tenant_id | tenant_id, flag_key |  |
| tenant_feature_overrides | idx_tenant_feature_overrides_tenant | tenant_feature_overrides_tenant_id_feature_key_key | tenant_id | tenant_id, feature_key |  |
| tenant_plan_limit_overrides | idx_tenant_limit_overrides_tenant | tenant_plan_limit_overrides_tenant_id_metric_key | tenant_id | tenant_id, metric |  |
| ticket_compensation_snapshots | idx_comp_snap_ticket | ticket_compensation_snapshots_tenant_id_ticket_id_service_l_key | tenant_id, ticket_id | tenant_id, ticket_id, service_line_id, technician_id |  |
| ticket_tip_allocations | idx_tip_alloc_ticket | ticket_tip_allocations_tenant_id_ticket_id_technician_id_key | tenant_id, ticket_id | tenant_id, ticket_id, technician_id |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_checkout_ready | tenant_id, branch_id | tenant_id, branch_id, status, ready_checkout_at |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_service_done | tenant_id, branch_id | tenant_id, branch_id, service_done_checkout_status, service_done_at DESC |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_branch_number | tenant_id, branch_id | tenant_id, branch_id, ticket_number |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_branch_paid_at | tenant_id, branch_id | tenant_id, branch_id, paid_at |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_branch_status | tenant_id, branch_id | tenant_id, branch_id, status |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_branch_status_created | tenant_id, branch_id | tenant_id, branch_id, status, created_at |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_branch_tech_status | tenant_id, branch_id | tenant_id, branch_id, primary_technician_id, status |  |
| tickets | idx_tickets_tenant_branch | idx_tickets_tenant_customer_paid | tenant_id, branch_id | tenant_id, branch_id, customer_id, paid_at |  |
| tickets | idx_tickets_tenant_branch_status | idx_tickets_checkout_ready | tenant_id, branch_id, status | tenant_id, branch_id, status, ready_checkout_at |  |
| tickets | idx_tickets_tenant_branch_status | idx_tickets_tenant_branch_status_created | tenant_id, branch_id, status | tenant_id, branch_id, status, created_at |  |
| user_branch_access | idx_uba_tenant | idx_uba_tenant_branch | tenant_id | tenant_id, branch_id |  |
| user_branch_access | idx_uba_tenant | idx_uba_tenant_user | tenant_id | tenant_id, user_id |  |
| user_branch_access | idx_uba_tenant | user_branch_access_tenant_id_user_id_branch_id_key | tenant_id | tenant_id, user_id, branch_id |  |
| user_branch_access | idx_uba_tenant_user | user_branch_access_tenant_id_user_id_branch_id_key | tenant_id, user_id | tenant_id, user_id, branch_id |  |
| webauthn_credentials | ix_webauthn_credentials_tenant | idx_webauthn_credentials_user | tenant_id | tenant_id, user_id |  |

## How to act on this (developer)
1. In production, snapshot `pg_stat_user_indexes` after ≥2 weeks of real traffic. 2. For each candidate with
near-zero `idx_scan`, test the drop on a replica/staging with the app's slow-query log watched. 3. Ship each
drop as its own migration with the measurement in the migration comment. 4. Never touch unique/partial-unique
indexes without a product decision — they encode business rules, not performance.
