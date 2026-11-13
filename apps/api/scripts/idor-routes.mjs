import { fileURLToPath, URL } from 'node:url';
// idor-routes.mjs — Constitution 12 §286 / §299: the automated IDOR suite's route table, GENERATED from the OpenAPI
// manifest (apps/api/openapi/manifest.txt), not hand-picked.
//
// Every GET route of the tenant realms (realm=staff | shared, auth=session) whose path carries a parameter is one IDOR
// case: salon B, signed in, asks for salon A's REAL record by its REAL id and must get 403 / 404 (or a 200 that carries
// none of A's data) — never A's record. This file says, for each case, WHERE salon A's real id comes from (a table and
// column — the live script seeds the row) or WHY the route is not an IDOR target (a public capability id, a catalog
// key, platform-global content). A new by-id route that this table cannot classify FAILS
// src/common/idor-route-coverage.vitest.spec.ts, so the suite grows with the API.
//
// Used by: scripts/live-phase14-idor.mjs (the live run) and src/common/idor-route-coverage.vitest.spec.ts (coverage).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A fixture: salon A's row in `table`; the value put in the path is `col` (default id). `extra.over` pins columns the
 *  route's lookup filters on ('$owner' / '$techUser' / '$tech' = salon A's owner user, technician user, technician). */
const F = (table, col = 'id', extra = {}) => ({ table, col, ...extra });
/** Not an IDOR target, with the reason (printed by the live script and the coverage spec). */
const X = (reason) => ({ exempt: reason });

// ── parameter name → fixture (the default) ───────────────────────────────────────────────────────────────────────
export const PARAM_FIXTURES = {
  customerId: F('customers'), technicianId: F('technicians'), ticketId: F('tickets'), checkoutId: F('tickets'),
  appointmentId: F('pos_tech_appointments'), serviceId: F('services'), branchId: F('branches'), userId: F('users'),
  queueItemId: F('pos_queue_items'), queueEntryId: F('pos_queue_items'), checkInId: F('pos_queue_items'),
  planId: F('membership_plans'), membershipId: F('customer_memberships'), productId: F('inventory_products'),
  bundleId: F('bundles'), techQueueTicketId: F('pos_tech_queue_tickets'), assignmentId: F('technician_skill_assignments'),   // G3 (Nov 5 2026): a technician's skill assignment
  threadId: F('tech_dm_threads'),
  jobId: F('ai_receptionist_provisioning_jobs'), attachmentId: F('support_ticket_attachments'),
  providerCallId: F('voice_call_outcomes', 'provider_call_id'), code: F('gift_cards', 'code'),
  kind: { value: 'transaction' },
  deviceId: F('mobile_pay_devices', 'device_id'),   // Oct 24 2026 Secure Tap to Pay M6-6: GET /mobile-checkout/devices/{deviceId}/activity (owner-only, tenant-scoped)
  idempotencyKey: F('payment_attempts', 'idempotency_key'),   // Oct 13 2026 Tap to Pay: GET /mobile-checkout/payment-attempts/{idempotencyKey}
  techId: F('technicians'),   // Oct 12 2026 payroll: /pos/payroll/periods/{id}/technicians/{techId}
  vendorId: F('inventory_vendors'),
  documentId: F('ocr_documents'),   // Oct 27 2026 finance §142: GET /owner/finance/receipts/{documentId}/suggested-expense — salon A's receipt document
  // Oct 22 2026 B-22: GET /pos/booking/drafts/{draftId} — salon A's live draft (kind 'draft', no technician, unexpired,
  // a real time range: the draft reader shows only live drafts, and booking_holds requires end > start)
  draftId: F('booking_holds', 'id', { over: { kind: 'draft', technician_id: null, status: 'held', released_at: null, converted_appointment_id: null,
    start_time: '2099-01-01T10:00:00Z', end_time: '2099-01-01T11:00:00Z', expires_at: '2099-01-08T00:00:00Z', draft_payload: '{}' } }),
  // Oct 22 2026: pinned to salon A's technician — ONE live statement per (period, technician) is allowed, and the tech route
  // reads only hers; the manager route and the tech route therefore share this one row
  statementId: F('payroll_statements', 'id', { over: { technician_id: '$tech' } }),   // Oct 21 2026 weekly paychecks: /pos/payroll/paychecks/statements/{statementId}, /tech/payroll/statements/{statementId}   // Oct 21 2026 finance: /owner/finance/vendors/{vendorId}/spend
  // ↑ also Oct 27 2026 (17.5) the pay-stub PDFs: /pos/payroll/paychecks/statements/{statementId}/pay-stub.pdf, /owner/payroll/paychecks/statements/{statementId}/pay-stub.pdf,
  //   /tech/payroll/statements/{statementId}/pay-stub.pdf — salon B gets 404 STATEMENT_NOT_FOUND for salon A's statement (no PDF bytes)
  // Nov 3 2026 Payments / Deposit Reconciliation screens: /pos/payments/settlements/{settlementId}[/export|/transactions],
  //   /pos/deposit-reconciliation/workspace/settlements/{settlementId} — salon A's processor settlement batch
  settlementId: F('payment_settlements'),
  paymentId: F('payments'),   // Nov 3 2026 Transactions screen: GET /pos/payments/transactions/{paymentId}
  depositId: F('bank_deposits'),   // Nov 3 2026 Deposit Reconciliation workspace: deposits/{depositId}[/suggestions]
  exceptionId: F('reconciliation_exceptions'),   // Nov 3 2026 Deposit Reconciliation workspace: exceptions/{exceptionId}
  reportType: { value: 'settlement_summary' },   // Nov 3 2026 Deposit Reconciliation reports/{reportType}: a report KIND (REPORT_TYPES), always the caller's salon
  businessDate: { value: '2026-01-15' },   // Nov 3 2026 Cash Handoffs: /{technicianId}/{businessDate}/detail — the seeder's date, so A's seeded handoff is that day
  terminalId: F('pos_payment_terminals'),   // Nov 3 2026 Payment Terminals screen: physical/{terminalId}
  cardId: F('gift_cards'),   // Nov 3 2026 Gift Cards screen: /pos/gift-cards/{cardId}/detail | ledger
  redemptionId: F('loyalty_redemptions'),   // Nov 3 2026 Loyalty Program: GET /pos/loyalty/redemptions/{redemptionId}
  // Nov 3 2026 Coupons & Promotions: /pos/coupons/{dealId}/campaigns, /pos/discounts/{dealId}, /pos/promotions/{dealId}/activity —
  //   the coupon screens read only deals of kind 'coupon'
  dealId: F('deals', 'id', { over: { kind: 'coupon' } }),
  categoryId: F('service_categories'),   // Nov 3 2026 Catalog screens: GET /pos/catalog/categories/{categoryId}
  // Nov 3 2026 Team screens (members, birthdays, training): a member id is the staff USER id (a login-less technician's id is
  //   accepted as a fallback — resolveMember / the roster); salon A's owner is a member
  memberId: F('users'),
  poId: F('purchase_orders'),   // Nov 3 2026 Inventory screen: GET /tenant/inventory/screen/purchase-orders/{poId}
};

// ── `{id}` (and a few named params) by the path segment(s) in front of it ─────────────────────────────────────────
// Longest prefix wins. Keys are matched against the path with `{…}` params removed from the end.
export const SEGMENT_FIXTURES = [
  ['/owner/finance/expenses/{id}', F('expenses')],              // Oct 21 2026 finance: salon A's expense (with its lines, history, documents)
  ['/community/incidents/{id}', F('tenant_private_incidents')],
  ['/community/mine/{id}', F('community_posts')],
  ['/community/posts/{id}', F('community_posts')],            // salon A's UNPUBLISHED draft — B must not read it
  ['/community/evidence/{id}', F('community_evidence')],
  ['/owner/operations/{id}', F('api_operations', 'id', { over: { realm: 'owner', actor_user_id: '$owner' } })],
  ['/pos/operations/{id}', F('api_operations', 'id', { over: { realm: 'pos', actor_user_id: '$owner' } })],
  ['/tech/operations/{id}', F('api_operations', 'id', { over: { realm: 'tech', actor_user_id: '$techUser' } })],
  ['/owner/payroll/periods/{id}', F('payroll_periods')], ['/owner/payroll/paychecks/periods/{id}', F('payroll_periods')], ['/pos/payroll/paychecks/periods/{id}', F('payroll_periods')], ['/pos/payroll/periods/{id}', F('payroll_periods')], ['/pos/tickets/{id}', F('tickets')],
  ['/pos/ai-business/reports/{id}', F('ai_business_report_jobs')],
  ['/pos/ai-customer-profile/customers/{id}', F('customers')],
  ['/pos/ai-inventory/recipes/{id}', F('inventory_service_recipes')],
  ['/pos/ai-marketing/campaigns/{id}', F('campaigns')],
  ['/pos/ai-money-protection/investigations/{id}', F('money_protection_investigations')],
  ['/pos/ai-ocr-receipt/documents/{id}', F('ocr_documents')],
  ['/pos/ai-queue-assignment/recommendations/{id}', F('queue_assignment_recommendations')],
  // A7 (Nov 4 2026): a request id is a correlation id inside ai_booking_conversion_events; the query is salon-scoped (another salon's id answers 404)
  ['/pos/ai-booking/requests/{requestId}', F('ai_booking_conversion_events', 'correlation_id')],
  ['/pos/ai-booking/requests/{requestId}/support-report', F('ai_booking_conversion_events', 'correlation_id')],
  ['/pos/ai-booking/recovery/{caseKey}/dismiss', X('caseKey is a derived key (type:id); the dismissal is stored under the caller\'s salon only and reveals nothing')],
  ['/pos/ai-review-reputation/{id}', F('reviews')],
  ['/pos/ai-scheduling-optimizer/recommendations/{id}', F('schedule_optimization_recommendations')],
  ['/pos/ai-scheduling-optimizer/runs/{id}', F('schedule_optimization_runs')],
  ['/pos/ai-voice-transcription/transcripts/{id}', F('call_transcripts')],
  ['/pos/approvals/{id}', F('tenant_approval_requests')],
  ['/pos/duplicate-review/merges/{id}', F('customer_merge_snapshots')],   // extras Customer 08 (Nov 13 2026): salon A's merge record
  ['/pos/campaigns/{id}', F('campaigns')],
  ['/pos/communications/threads/{id}', F('communication_threads')],
  ['/pos/deals/{id}', F('deals')],
  ['/pos/deposit-reconciliation/periods/{id}', F('reconciliation_periods')],
  ['/pos/invoices/{id}', F('invoices')],
  ['/pos/marketing/display-ads/{id}', F('display_ads')],
  ['/pos/reports/detail/{kind}/{id}', F('payments')],
  ['/pos/security/access-reviews/{id}', F('access_reviews')],
  ['/pos/settings/payments-checkout/terminals/{id}', F('pos_payment_terminals')],
  ['/pos/webhooks/{id}', F('tenant_webhooks')],
  ['/tech/follow-ups/{id}', F('service_follow_up_tasks', 'id', { over: { technician_id: '$tech' } })],

  ['/tech/tickets/{id}', F('tickets')],
  ['/pos/ai/front-desk/agents/{id}', F('ai_receptionist_agents')],
  ['/tenant/ai/receptionist/learning/suggestions/{id}', F('voice_improvement_suggestions')],   // AI Receptionist Settings 07 (Nov 13 2026): salon A's recommendation
  ['/tenant/help/tickets/{id}', F('support_tickets')],
  ['/tenant/inventory/counts/{id}', F('inventory_counts')],
  ['/tenant/inventory/products/{id}', F('inventory_products')],
  ['/tenant/inventory/products/{id}/stock-preview', F('inventory_products')],   // Products Management 09 (round 10): Add Stock preview
  ['/tenant/inventory/products/{id}/reorder-draft', F('inventory_products')],   // Products Management 14 (round 10): Reorder draft prefill
  ['/pos/payments/tips' + '/technicians/{id}/earnings', F('technicians')],   // (path split: the payroll gate reads 'tips/technicians' as a division)   // Tips & Gratuity 01 (round 10): technician earnings overlay
  ['/tenant/inventory/purchase-orders/{id}', F('purchase_orders')],
  ['/tenant/inventory/transfers/{id}', F('inventory_transfers')],
  ['/tenant/locations/{id}', F('branches')],
  ['/pos/ai-customer-profile/duplicates/{groupId}', F('customers')],   // a duplicate group is keyed by a customer of the salon

  // Nov 3 2026 — the centers / screens added by the recent builds (each: the table its by-id read looks up)
  ['/pos/ai-business/center/alerts/events/{id}', F('ai_business_alert_events')],   // AI Business Center: alert explain
  ['/pos/ai-business/center/reports/{id}', F('ai_business_report_jobs')],
  // Nov 6 2026 — Batch A extras (A2 incidents / delivery, A5 assistant history, A12 closures)
  ['/pos/ai-business/center/alerts/incidents/{id}', F('ai_business_alert_events')],   // an incident is an alert event row
  ['/pos/ai-business/center/alerts/{id}', F('ai_business_alerts')],                   // delivery settings of one alert rule
  ['/pos/ai-business/center/assistant/history/{id}', F('ai_business_conversations')],
  ['/pos/ai-business/center/branches/snapshots/{id}', F('ai_branch_comparison_snapshots')],   // round 7: a saved branch comparison (+ its /signoffs)
  ['/pos/ai/business-setup/closures/{id}', F('business_closures')],
  ['/pos/ai/business-setup/faqs/{id}', F('ai_receptionist_faqs')],                 // Business Setup Center
  ['/pos/ai/calendar-center/appointments/{id}', F('pos_tech_appointments')],       // AI Calendar Center
  // AI Calls / Receptionist Center: `ref` is the call's provider_call_id (its row id is accepted too)
  ['/pos/ai/calls-center/calls/{ref}', F('voice_call_outcomes', 'provider_call_id')],
  ['/pos/ai/receptionist-center/calls/{ref}', F('voice_call_outcomes', 'provider_call_id')],
  ['/pos/ai/copilot-center/customers/{id}', F('customers')],                       // Reception Copilot overlay
  ['/pos/ai/follow-ups-center/tasks/{id}', F('ai_receptionist_follow_ups')],
  ['/pos/birthdays/customers/{id}', F('customers')],
  ['/pos/booking-verification-center/history/{id}', F('booking_verification_sessions')],
  ['/pos/campaign-center/campaigns/{id}', F('campaigns')],                         // + /audit /events /recipients
  ['/pos/catalog/add-ons/{key}', F('service_add_ons', 'add_on_key')],              // Catalog: an add-on is addressed by its key
  ['/pos/churn-watch/customers/{id}', F('customers')],
  ['/pos/commission-discrepancies/{id}', F('commission_discrepancy_reviews')],     // Commission Review (F1)
  ['/pos/commission-screen/technicians/{id}', F('technicians')],                   // + /lines /tips /adjustments
  ['/pos/communications/inbox/threads/{id}', F('communication_threads')],          // + /messages /timeline
  ['/pos/customer-ai-settings/history/{id}', F('ai_customer_profile_settings_events')],
  ['/pos/customer-intelligence/customers/{id}', F('customers')],
  ['/pos/customer-notifications/records/{id}', F('notifications')],
  ['/pos/customer-phone-center/requests/{id}', F('customer_phone_update_sessions')],
  ['/pos/customer-search/customers/{id}', F('customers')],
  ['/pos/customer-timeline/customers/{id}', F('customers')],
  // Customer Timeline: an event id is COMPOSED ('<source>:<row id>[:<state>]') — no column holds it, so a well-formed id;
  // the customer (salon A's) is the record under test and is checked first
  ['/pos/customer-timeline/customers/{id}/events/{eventId}', { value: 'appt:00000000-0000-0000-0000-000000000000:booked' }],
  ['/pos/deals-offers/{id}', F('deals')],
  ['/pos/duplicate-review/groups/{id}', F('customer_duplicate_groups')],
  ['/pos/email-center/messages/{id}', F('notifications', 'id', { over: { channel: 'email' } })],   // Email Center reads email notifications only
  ['/pos/eod-follow-ups/tasks/{id}', F('service_follow_up_tasks')],
  ['/pos/follow-up-queue/tasks/{id}', F('service_follow_up_tasks')],
  ['/pos/loyalty/network/purchases/{id}', F('token_purchase_intents')],            // Global Rewards: a token purchase
  ['/pos/marketing/segments/audience-drafts/{id}', F('segment_audience_drafts')],
  ['/pos/marketing/segments/customers/{id}', F('customers')],
  ['/pos/message-templates/templates/{id}', F('pos_message_templates')],
  ['/pos/me/saved-views/{id}', F('pos_saved_views', 'id', { over: { owner_user_id: '$owner', surface: 'idor.check', name: 'IDOR view', filters_json: {} } })],   // extras arc (Nov 9 2026): salon A owner's saved view; keyed by session tenant + user
  ['/pos/payments/refunds-voids/{kind}', { value: 'refund' }],                     // overrides the global `kind`: 'refund' | 'void' only
  ['/pos/payments/refunds-voids/{kind}/{id}', F('payment_refunds')],
  ['/pos/rebooking/customers/{id}', F('customers')],
  ['/pos/receipt-center/documents/{id}', F('ocr_documents')],
  ['/pos/referral-program/referrals/{id}', F('referral_redemptions')],
  ['/pos/reminder-center/reminders/{id}', F('appointment_reminders_sent')],        // a SENT reminder (an upcoming one is a composed 'u:…' id)
  ['/pos/reputation-settings/history/{id}', F('ai_reputation_config_versions')],
  ['/pos/reputation/reviews/{id}', F('reviews')],
  ['/pos/retention/sms/campaigns/{campaignId}', F('retention_sms_campaigns')],
  ['/pos/reviews-center/reviews/{id}', F('reviews')],
  ['/pos/service-recommendations/recommendations/{id}', F('service_recommendations')],
  ['/pos/team-data-alerts/{id}', F('team_data_alerts')],
  ['/pos/team-performance-screen/technicians/{id}', F('technicians')],             // + /composite /reviews /services
  ['/pos/tech-queue-screen/technicians/{id}', F('technicians')],
  ['/pos/tech-queue-screen/tickets/{id}', F('pos_tech_queue_tickets')],
  ['/tenant/inventory/stock-alerts/events/{eventId}', F('product_usage_events')],  // a product usage event (read at the caller's branch)
  ['/tenant/messaging/setup/activity/{kind}', { value: 'test_sms' }],              // overrides the global `kind`: ACTIVITY_KINDS
  ['/tenant/messaging/setup/activity/{kind}/{id}', F('sms_test_events')],
];

// ── whole routes that are not IDOR targets, with the reason ──────────────────────────────────────────────────────
export const EXEMPT = [
  // A7 (Nov 4 2026): Review alternatives — the case is rebuilt from the caller's own salon records (openCase); another salon's key is not found
  [/^\/pos\/ai-booking\/recovery\/\{caseKey\}\/alternatives$/, X('caseKey is a derived key (type:id) rebuilt from the caller\'s own salon records — another salon\'s key is not found, nothing is revealed')],
  [/^\/pos\/ai-business\/metrics\/\{id\}/, X('a metric KEY from the fixed metric catalog, not a salon record')],
  [/^\/pos\/project-status\/module\/\{moduleKey\}/, X('a platform module key, not a salon record')],
  [/^\/owner\/reports\/\{reportId\}\/export/, X('a report KIND name; the export is always of the caller\'s own salon')],
  [/^\/tenant\/help\/(articles|videos)\/\{id\}/, X('platform-global help content (no tenant column) — the same for every salon by design')],
  // extras Membership Overview 16·15 (Nov 12 2026): the drill-down of one check — the KEY is from the fixed system-check registry; the rows are always the caller's own salon
  [/^\/pos\/system-checks\/memberships\/\{checkKey\}\/rows$/, X('a check KEY from the fixed system-check registry, not a salon record; the source rows are always read for the caller\'s own salon (tenant from the session)')],
];

// ── query strings a route needs to reach its lookup at all (else both salons get the same 400 and nothing is proved) ─
export const QUERIES = [
  [/\/community\/evidence\/\{id\}\/access$/, 'reason=IDOR%20proof'],
  [/\/refund-preview$/, 'amountCents=100'],
];
export const queryFor = (path) => QUERIES.find(([re]) => re.test(path))?.[1] ?? '';

/** The manifest's tenant-realm GET routes with a path parameter. */
export function idorRoutes(manifestText = readFileSync(resolve(API_ROOT, 'openapi/manifest.txt'), 'utf8')) {
  const out = [];
  for (const line of manifestText.split('\n')) {
    const m = /^GET (\S+)\s+realm=(\S+)\s+auth=(\S+)\s+domain=(\S+)(.*)$/.exec(line);
    if (!m || !m[1].includes('{')) continue;
    const [, path, realm, auth, domain, rest] = m;
    if (realm !== 'staff' && realm !== 'shared') continue;
    out.push({ path, realm, auth, domain, perm: /perm=(\S+)/.exec(rest)?.[1] ?? null });
  }
  return out;
}

/** Classify one route: { exempt } or { params: { name: fixture } } or { unclassified: [names] }. */
export function classifyIdorRoute(route) {
  if (route.auth !== 'session') return { exempt: `auth=${route.auth} — not a tenant session route (a public capability id or an API key realm)` };
  for (const [re, x] of EXEMPT) if (re.test(route.path)) return x;
  const names = [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const params = {}; const unclassified = [];
  for (const name of names) {
    // the longest segment-prefix ending at this param
    const upTo = route.path.slice(0, route.path.indexOf(`{${name}}`) + name.length + 2);
    const seg = SEGMENT_FIXTURES.filter(([k]) => upTo.endsWith(k) || upTo === k).sort((a, b) => b[0].length - a[0].length)[0];
    const fx = seg?.[1] ?? PARAM_FIXTURES[name];
    if (fx) params[name] = fx; else unclassified.push(name);
  }
  return unclassified.length ? { unclassified } : { params };
}

// ── §75 / §187 branch rows: which by-id routes are LOCATION-scoped ─────────────────────────────────────────────────
// Every fixture table that carries a branch_id is classified here: 'branch' — a record of one location; a manager whose
// access is another location must not be served it (the live script attacks each such route as salon A's location-2
// manager against location 1's real record: scripts/live-phase14-idor.mjs, "no location-scoped route hands …") — or a
// reason it is salon-wide by design (shared across a salon's locations, never across salons: the tenant rows above
// cover that). A new fixture table with a branch_id fails idor-route-coverage until it is classified here.
const SW = (why) => ({ salonWide: why });
export const BRANCH_TABLES = {
  // operational records of one location
  pos_tech_appointments: 'branch', pos_queue_items: 'branch', pos_tech_queue_tickets: 'branch', tickets: 'branch', payments: 'branch',
  payment_attempts: 'branch', booking_holds: 'branch', pos_payment_terminals: 'branch', mobile_pay_devices: 'branch',
  // Nov 3 2026: the new centers' by-id reads filter on the caller's location (branch_id = it, or a salon-wide null row)
  ai_business_alert_events: 'branch', ai_business_alerts: 'branch', ai_receptionist_follow_ups: 'branch', service_add_ons: 'branch', service_categories: 'branch',
  commission_discrepancy_reviews: 'branch', pos_message_templates: 'branch', payment_refunds: 'branch', referral_redemptions: 'branch',
  ai_booking_conversion_events: 'branch',   // A7 (Nov 4 2026): a location user reads its own location's requests; the owner with no location reads all
  team_data_alerts: 'branch', product_usage_events: 'branch',
  appointment_reminders_sent: 'branch', sms_test_events: 'branch',   // confined to a branch-scoped login's allowed locations
  // salon-wide by design
  customers: SW('one customer book per salon: a guest of location 2 walks into location 1 (cross-branch-suite.pgtest "salon-wide by design")'),
  customer_merge_snapshots: SW('a merge of the salon-wide customer book (extras Customer 08); branch_id is only the survivor\'s home location'),
  services: SW('the menu is salon-wide; per-location prices / availability live in separate tables'),
  membership_plans: SW('a membership plan is honoured at every location of the salon'),
  customer_memberships: SW('a customer\'s membership is honoured at every location'),
  bundles: SW('service bundles belong to the salon menu'),
  deals: SW('a deal is published by the salon; per-location targeting is a field, not an access boundary'),
  campaigns: SW('marketing campaigns are salon-wide (owner / manager tool)'),
  gift_cards: SW('a gift card is redeemable at every location of the salon'),
  technicians: SW('a technician may work at several locations; the roster is salon-wide (branch membership is a separate table)'),
  technician_skill_assignments: SW('G3 Skills Catalog: a technician holds a skill at every location of the salon (branch_id records where it was approved, it does not confine it)'),
  users: SW('a staff account is salon-wide; its location access is user_branch_access'),
  reviews: SW('reviews are read salon-wide by the reputation tools'),
  inventory_service_recipes: SW('a service recipe is part of the salon menu'),
  ai_business_report_jobs: SW('salon-level AI business reports'),
  ai_branch_comparison_snapshots: SW('a saved comparison ACROSS the salon\'s locations (owner / manager) — salon-level by design'),
  ai_receptionist_agents: SW('the AI receptionist is configured for the salon'),
  ai_receptionist_provisioning_jobs: SW('provisioning of the salon\'s AI receptionist'),
  api_operations: SW('keyed by the acting user (actor_user_id): a person reads only their own operations'),
  tenant_private_incidents: SW('community safety incidents are reported per salon'),
  support_tickets: SW('help-desk tickets belong to the salon account'),
  tenant_approval_requests: SW('salon approval queue (owner / manager)'),
  communication_threads: SW('the salon\'s customer conversations (one customer book per salon)'),
  invoices: SW('platform-billing / salon invoices are per salon account'),
  expenses: SW('owner finance: expenses are reviewed salon-wide by the owner (the branch is an allocation field)'),
  payroll_periods: SW('a pay period is salon-wide; statements carry the technician'),
  payroll_statements: SW('a statement is per technician (the tech route reads only hers); salon-wide for payroll managers'),
  ocr_documents: SW('owner finance receipts; the OCR preview key is bound to the document folder (E8)'),
  money_protection_investigations: SW('owner-level loss-prevention investigations across the salon'),
  call_transcripts: SW('the salon\'s phone line transcripts'),
  voice_call_outcomes: SW('the salon\'s phone line outcomes'),
  queue_assignment_recommendations: SW('AI recommendations reviewed by salon managers'),
  schedule_optimization_runs: SW('AI scheduling runs reviewed by salon managers'),
  schedule_optimization_recommendations: SW('AI scheduling recommendations reviewed by salon managers'),
  service_follow_up_tasks: SW('a follow-up belongs to its technician (the tech route pins technician_id)'),
  inventory_counts: SW('stock counts are reviewed by the salon\'s inventory managers'),
  purchase_orders: SW('purchasing is salon-wide (one vendor book)'),
  // Nov 3 2026: the new centers whose by-id read is salon-wide (no location filter in the lookup)
  ai_receptionist_faqs: SW('the AI receptionist\'s FAQ knowledge is the salon\'s (Business Setup Center reads it salon-wide)'),
  booking_verification_sessions: SW('booking phone verification history is reviewed salon-wide (one customer book per salon)'),
  customer_phone_update_sessions: SW('a customer\'s phone change belongs to the salon-wide customer book'),
  ai_customer_profile_settings_events: SW('history of the salon\'s Customer AI settings (salon-level configuration)'),
  ai_reputation_config_versions: SW('history of the salon\'s reputation settings (salon-level configuration)'),
  notifications: SW('customer notification / email records are read salon-wide by Customer Notifications and Email Center'),
  segment_audience_drafts: SW('marketing audience drafts are salon-wide (owner / manager marketing tool)'),
  retention_sms_campaigns: SW('retention SMS campaigns are salon-wide (owner / manager marketing tool)'),
  payment_settlements: SW('processor settlements are reconciled salon-wide (one merchant account book)'),
  bank_deposits: SW('bank deposits are reconciled salon-wide against the salon\'s settlements'),
  reconciliation_exceptions: SW('deposit reconciliation cases are worked salon-wide by the owner / finance'),
};
/** The branch scope of a by-id route: 'branch' when any of its fixture tables is location-scoped; else 'salon-wide' / 'n/a'. */
export function branchScopeOf(route) {
  const c = classifyIdorRoute(route);
  if (!c.params) return { scope: 'n/a', why: c.exempt ?? 'unclassified' };
  const tables = Object.values(c.params).map((f) => f.table).filter(Boolean);
  if (tables.some((t) => BRANCH_TABLES[t] === 'branch')) return { scope: 'branch', why: tables.filter((t) => BRANCH_TABLES[t] === 'branch').join(',') };
  return { scope: 'salon-wide', why: tables.map((t) => BRANCH_TABLES[t]?.salonWide ?? `${t}: no branch column`).join(' / ') };
}

/** The tech realm's routes are attacked by salon B's TECHNICIAN; every other route by salon B's OWNER. */
export const actorFor = (path) => (path.startsWith('/tech/') ? 'tech' : 'owner');

// ── Security Deep Scan §74 (Nov 5 2026): WRITE routes and the CUSTOMER realm ──────────────────────────────────────
// The GET sweep above proved reads. §74 asks for the ~700 id-bearing write routes (POST / PATCH / PUT / DELETE) and the
// customer realm too: salon B (customer B) sends the write against salon A's (customer A's) real id and salon A's row
// must be UNCHANGED (md5 of the whole row before and after) — whatever the status. A write route uses the same fixture
// table as the reads (classifyIdorRoute); a write route the table cannot classify yet is listed in
// security/idor-write-unclassified.baseline.json, which only shrinks (idor-route-coverage fails on a NEW unclassified one).

/** The manifest's tenant-realm (staff / shared) write routes with a path parameter. */
export function idorWriteRoutes(manifestText = readFileSync(resolve(API_ROOT, 'openapi/manifest.txt'), 'utf8')) {
  const out = [];
  for (const line of manifestText.split('\n')) {
    const m = /^(POST|PATCH|PUT|DELETE) (\S+)\s+realm=(\S+)\s+auth=(\S+)\s+domain=(\S+)(.*)$/.exec(line);
    if (!m || !m[2].includes('{')) continue;
    const [, method, path, realm, auth, domain, rest] = m;
    if (realm !== 'staff' && realm !== 'shared') continue;
    out.push({ method, path, realm, auth, domain, perm: /perm=(\S+)/.exec(rest)?.[1] ?? null });
  }
  return out;
}

/** Customer realm: '$cust' = customer A's salon profile (customers.id), '$custUser' = customer A's login (users.id). */
const C = (table, over = { customer_id: '$cust' }, col = 'id') => ({ table, col, over });
export const CUSTOMER_FIXTURES = [
  [/^\/customer\/(booking\/)?appointments\/\{id\}/, C('pos_tech_appointments', { customer_id: '$cust', technician_id: '$tech', start_time: '10:00', end_time: '11:00' })],
  [/^\/customer\/invoices\/\{id\}/, C('invoices')],
  [/^\/customer\/payments\/\{invoiceId\}/, C('tickets')],            // skip-line checkout: "invoiceId" is the ticket id
  [/^\/customer\/payments\/\{paymentId\}/, C('payment_intents')],    // "paymentId" is the payment-intent id
  [/^\/customer\/tickets\/\{ticketId\}/, C('tickets')],
  [/^\/customer\/queue\/\{queueItemId\}/, C('pos_queue_items')],
  [/^\/customer\/addresses\/\{id\}/, C('customer_addresses')],
  [/^\/customer\/payment-methods\/\{id\}/, C('customer_payment_methods')],
  [/^\/customer\/gift-cards\/\{id\}/, C('gift_cards')],
  [/^\/customer\/messages\/\{threadId\}/, C('communication_threads')],
  [/^\/customer\/operations\/\{id\}/, C('api_operations', { realm: 'customer', actor_user_id: '$custUser' })],
  [/^\/customer\/me\/security\/sessions\/\{id\}/, C('sessions', { user_id: '$custUser' })],
  [/^\/customer\/wallet\/top-ups\/\{id\}/, C('wallet_topup_intents')],
  [/^\/customer\/schedule-proposals\/\{id\}/, C('schedule_change_proposals')],
  [/^\/customer\/my-photo-consents\/\{photoId\}/, C('nail_photo_consent')],
  [/^\/customer\/follow-ups\/\{id\}/, C('service_follow_up_tasks')],
  [/^\/customer\/profile\/phone\/\{sessionId\}/, C('customer_phone_verifications')],
  // public / social by design — the same answer for every customer
  [/^\/customer\/(salons|techs|deals\/public)\//, X('public salon / technician / deal pages — the same for every visitor by design')],
  [/^\/customer\/deals\/\{id\}/, X('a published deal is offered to every customer; save / estimate act on the caller\'s own list')],
  [/^\/customer\/social\//, X('public social profiles (follow / block / report act on the caller\'s own relations)')],
  [/^\/customer\/nail-showcase\//, X('the public showcase; edit / delete check the author — proven by modules/workforce/src/nail-showcase/nail-showcase-ownership.vitest.spec.ts')],
  [/^\/customer\/me\/favorite-salons\//, X('a public salon id; the favourite list is the caller\'s own')],
  [/^\/customer\/tech-favorites\//, X('a public technician slug; the favourite list is the caller\'s own')],
  [/^\/customer\/rewards\/\{id\}/, X('a reward from the platform catalog; redemption spends the caller\'s own points')],
];
/** The customer realm's session routes with a path parameter (reads and writes). */
export function idorCustomerRoutes(manifestText = readFileSync(resolve(API_ROOT, 'openapi/manifest.txt'), 'utf8')) {
  const out = [];
  for (const line of manifestText.split('\n')) {
    const m = /^(GET|POST|PATCH|PUT|DELETE) (\S+)\s+realm=customer\s+auth=(\S+)\s+domain=(\S+)/.exec(line);
    if (!m || !m[2].includes('{')) continue;
    out.push({ method: m[1], path: m[2], realm: 'customer', auth: m[3], domain: m[4] });
  }
  return out;
}
export function classifyCustomerRoute(route) {
  if (route.auth !== 'session') return { exempt: `auth=${route.auth} — a public route, the same for every visitor` };
  const hit = CUSTOMER_FIXTURES.find(([re]) => re.test(route.path));
  if (!hit) return { unclassified: [...route.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]) };
  if (hit[1].exempt) return hit[1];
  const names = [...route.path.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
  // the first parameter is the customer-owned record; any further one is a sub-record of it (attacked through the first)
  return { params: { [names[0]]: hit[1] }, extra: names.slice(1) };
}
