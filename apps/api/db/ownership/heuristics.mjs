// heuristics.mjs — BUILD_PLAN Phase 10 (Constitution 1 §3, §7, §58, §105): the rules that classify every table for the
// ownership registry (apps/api/scripts/db-ownership.mjs). Order of authority: overrides.json (a reviewed human decision,
// with a reason) beats these heuristics; a heuristic that cannot decide returns null and the gate fails until someone
// adds an override — no table is silently filed under "other".

/** §3 ownership classes. */
export const OWNERSHIP = {
  A: 'platform_global',
  B: 'tenant_owned',
  C: 'tenant_branch_owned',
  D: 'platform_identity_tenant_relationship',
  E: 'cross_tenant_platform_data',
};

/** §7 logical domains (the constitution's list, in its order). */
export const DOMAINS = ['PLATFORM', 'IDENTITY', 'TENANTS', 'CUSTOMERS', 'BOOKING', 'WORKFORCE', 'OPERATIONS', 'CATALOG', 'INVENTORY',
  'CHECKOUT', 'PAYMENTS', 'FINANCE', 'MARKETING', 'DEALS', 'LOYALTY', 'MEMBERSHIPS', 'COMMUNICATIONS', 'AI', 'ANALYTICS', 'SUPPORT',
  'AUDIT', 'SECURITY'];

// First match wins — specific rules before broad ones.
const DOMAIN_RULES = [
  // exact-name exceptions to the prefix rules below
  ['ANALYTICS', /^(scheduled_reports|super_admin_scheduled_report)/],
  ['OPERATIONS', /^(scheduler_runs|customer_display_|tenant_(api_key|webhook|deployments|backup_requests|event_logs))/],
  ['FINANCE', /^tenant_(subscriptions|trials|add_ons|ai_(subscriptions|plan_subscriptions|packages)|hardware_payoff|sms_|plan_limit|usage_limits)/],
  ['PAYMENTS', /^tenant_(payment_config|tap_to_pay)/],
  ['IDENTITY', /^tenant_(custom_roles|role_permissions|user_permission_overrides)/],
  ['SUPPORT', /^(tenant_(private_incidents|warnings)|community_)/],
  ['MARKETING', /^daily_follow_up/],
  ['MARKETING', /^advertising_/],   // G7 Global Advertising (migration 818): the master switch + its history
  ['AUDIT', /^(audit_|authorization_audit|owner_audit|technician_audit|revenue_audit|appointment_change_log|pos_queue_audit|export_snapshots|ticket_revisions|status_history)|_audit(_logs?)?$|_change_log$|_history$/],
  ['SECURITY', /^(security_|access_review|authorization_denials|dormant_account|money_protection|ip_block|emergency_lockdown|privileged_access|ephemeral_grants|secret_fingerprints|login_attempts|device_security|data_retention|customer_legal_holds|customer_blocks|rate_limit|community_risk|ticket_deletion_codes|api_keys?|webhook_signing)/],
  ['IDENTITY', /^(users|user_|sessions|refresh_tokens|oauth_|mfa_|webauthn|password_|auth_|super_admin_login|roles|role_permissions|permissions|account_deletion|access_requests|security_not_me|legal_document_acceptances|customer_identit|global_customers|customer_global_links|customer_phone_verif|phone_verif|staff_invit|invitations)/],
  ['AI', /^(ai_|receptionist|reception_copilot|copilot|call_transcript|call_consent|call_deletion|call_redaction|voice_|call_intelligence|ocr_|smart_|predict|recommend|nail_ai|ai$)/],
  ['LOYALTY', /^(loyalty|customer_loyalty|reward|points_|referral|customer_referrals)/],
  ['MEMBERSHIPS', /^(membership|customer_membership)/],
  ['DEALS', /^(deal|customer_deals|salon_promotions|tenant_promotion|coupon|offer)/],
  ['PAYMENTS', /^(payment|mobile_pay|pos_payment_terminals|reconciliation_|fee_schedules|refund|chargeback|dispute|terminal|card_|tip_|surcharge|gift_card|wallet|customer_wallet|customer_payment|stored_card|bolt_|cardpointe|processor_|settlement|deposit|bank_|merchant|pending_payment|cash_)/],
  ['FINANCE', /^(billing|admin_commission|bonus_rules|grandfathered|invoice|credit_note|subscription|overage|plan_|plans$|residual|revenue_|partner_payout|tenant_incentive|commission|payroll|compensation|earning|tech_earning|expense|owner_expense|tax_|ledger|accounting|price_|ai_price|trial_|promotions$|promotion_|sms_usage|usage_|trial)/],
  ['CHECKOUT', /^(ticket|checkout|receipt|pos_ticket|serving|pos_service|drawer|register|order|cart|upsell)/],
  ['BOOKING', /^(pos_tech_appointments|pos_tech_queue|public_check_in|duplicate_checkin|scheduling_rule|store_hours|skip_line|pos_booking|appointment|booking|online_booking|checkin|check_in|go_checkin|walkin|waitlist|pos_queue|queue_|tech_queue|availability|booking_hold|reschedul|reminder_(flow|plan)|customer_appointments|calendar)/],
  ['WORKFORCE', /^(technician|tech_|global_tech|staff|employee|clock_|time_clock|timesheet|shift|schedule|worker_|helper|skill|branch_transfer|nail_photo_consent|tech_portfolio|before_after|tech_salon)/],
  ['INVENTORY', /^(inventory|stock|purchase_order|supplier|vendor|product_barcode|product_import|product_distribution|product_master|products?$|product_)/],
  ['CATALOG', /^(service|bundle|services$|categories|catalog|menu|package|addon|price_list|business_categories|tenant_presets)/],
  ['CUSTOMERS', /^(customer|unmatched_customer|customers$|client|nail_showcase|review|favorite|guest|consent|note|notes$)/],
  ['COMMUNICATIONS', /^(sms_|pos_message|pos_messaging|message|notification|reminder|device_push|push_|a2p_|twilio|email|communication|campaign_deliver|tenant_messaging|tech_dm|chat|conversation|announcement|platform_announcements|inbox|outreach)/],
  ['MARKETING', /^(marketing|campaign|automation|segment|lead|website_lead|social|promo|community)/],
  ['ANALYTICS', /^(report|forecast|reputation|reports|kpi|analytics|snapshot|metrics|stats|overview|tenant_daily|daily_|pos_kpi|queue_metrics|utilization|billing_kpi|membership_kpi|super_admin_report|super_admin_scheduled|scheduled_report|insight|dashboard|benchmark|platform_request_metrics|summary)/],
  ['SUPPORT', /^(support|video_progress|pos_project_status|help_|video_tutorial|feedback|ticket_csat|status_|product_updates|alert|warning|owner_alert|maintenance|incident|system_status|super_admin_project|onboarding|tenant_application|applications?)/],
  ['OPERATIONS', /^(branches|pos_stations|pos_display|workflow_runs|branch_|hardware|device|display|customer_display|printer|integration|webhook|job|jobs$|outbox|processed_events|event_|inbox_events|scheduler|schema_|api_idempotency|idempotency|backup|synthetic|system_health|db_|export_|import_|settings|setting|cache|locks?$|lock_|feature_flag|go_|kiosk|qr_|pairing)/],
  ['TENANTS', /^(tenants$|tenant_)/],
  ['PLATFORM', /^(platform_|super_admin|feature|legal_document|trial_definitions|provider|ai_provider|communication_providers|status_components|system_|maintenance_)/],
];

/** Domain by name rule, else null (an override must decide). */
export function domainOf(table) {
  for (const [d, rx] of DOMAIN_RULES) if (rx.test(table)) return d;
  return null;
}

// Sensitivity — the classes Constitution 12's classify-schema.mjs introduced (SECURITY_SECRET > PAYMENT_RESTRICTED >
// HIGHLY_SENSITIVE > CONFIDENTIAL > PUBLIC > INTERNAL). One implementation, imported by both scripts.
const PII = /(^|_)(phone|email|address|street|zip|postal|ssn|tax_id|dob|date_of_birth|first_name|last_name|full_name|notes?|transcript|recording_url|ip_address|user_agent)($|_)/;
const SECRET = /_enc$|password_hash|secret_hash|_secret$|token_hash|totp|api_key|auth_token|private_key/;
const PAYMENT = /(card|pan|cvv|last4|brand|processor_(reference|transaction)|merchant|settlement|bank|routing|refund|payout)/;
export function sensitivityOf(table, columns) {
  const enc = columns.filter((c) => SECRET.test(c));
  const pii = columns.filter((c) => PII.test(c) && !SECRET.test(c));
  const pay = PAYMENT.test(table) || columns.some((c) => PAYMENT.test(c));
  let cls = 'INTERNAL';
  if (enc.length) cls = 'SECURITY_SECRET';
  else if (pay) cls = 'PAYMENT_RESTRICTED';
  else if (/(transcript|recording|voice|compensation|payroll|earning|notes|evidence|bank)/.test(table) || pii.some((c) => /notes?|transcript|recording|ssn|tax_id|dob/.test(c))) cls = 'HIGHLY_SENSITIVE';
  else if (pii.length || /(customer|appointment|ticket|user|technician|employee|message|sms|email|review)/.test(table)) cls = 'CONFIDENTIAL';
  else if (/^(status_components|status_incidents|product_updates|public_|business_categories|service_templates)/.test(table)) cls = 'PUBLIC';
  return { cls, enc, pii };
}

/** Columns that point at a platform identity (§3 D): a tenant row that links to one is a relationship record. */
const IDENTITY_LINK = /^(customer_identity_id|identity_id|global_customer_id|global_tech_profile_id)$/;
/** Platform identity roots and identity-security records keyed by a person, not by a salon. */
const IDENTITY_ROOT = /^(customer_identities|global_customers|global_tech_profiles|global_tech_delete_requests|tech_profile_events|tech_account_status_events|users|sessions|refresh_tokens|oauth_tokens|oauth_codes|mfa_factors|mfa_recovery_codes|mfa_recovery_tokens|auth_devices|auth_events|login_attempts|webauthn_credentials|webauthn_challenges|password_reset_tokens|security_not_me_tokens|account_deletion_requests|legal_document_acceptances|customer_favorite_salons|customer_favorite_techs|tech_dm_threads|tech_dm_messages|tech_dm_reports|customer_phone_verifications|customer_identity_conflicts|user_roles|user_permissions)$/;

/**
 * Ownership by shape (§3). `t` = { table, columns: Map(name → {nullable}), fkParents: string[] }.
 *   identity roots / identity-security tables              → D
 *   a column naming another tenant (from_/to_/owner_…)     → E (it moves or shares data BETWEEN tenants)
 *   no tenant_id                                           → A
 *   tenant_id + an identity link column                    → D
 *   tenant_id + branch_id NOT NULL                         → C
 *   tenant_id                                              → B (nullable tenant_id is flagged `platform_rows`, see the doc)
 */
export function ownershipOf(t) {
  const has = (c) => t.columns.has(c);
  if (IDENTITY_ROOT.test(t.table)) return 'D';
  const cols = [...t.columns.keys()];
  if (!has('tenant_id') && cols.some((c) => /^(from|to|owner|issuing|redeeming|source|target)_tenant_id$/.test(c))) return 'E';
  if (!has('tenant_id')) return 'A';
  if (cols.some((c) => IDENTITY_LINK.test(c))) return 'D';
  if (has('branch_id') && !t.columns.get('branch_id').nullable) return 'C';
  return 'B';
}
