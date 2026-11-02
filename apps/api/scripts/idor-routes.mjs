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

const API_ROOT = resolve(new URL('..', import.meta.url).pathname);

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
  bundleId: F('bundles'), techQueueTicketId: F('pos_tech_queue_tickets'), threadId: F('tech_dm_threads'),
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
  ['/pos/ai-review-reputation/{id}', F('reviews')],
  ['/pos/ai-scheduling-optimizer/recommendations/{id}', F('schedule_optimization_recommendations')],
  ['/pos/ai-scheduling-optimizer/runs/{id}', F('schedule_optimization_runs')],
  ['/pos/ai-voice-transcription/transcripts/{id}', F('call_transcripts')],
  ['/pos/approvals/{id}', F('tenant_approval_requests')],
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
  ['/tenant/help/tickets/{id}', F('support_tickets')],
  ['/tenant/inventory/counts/{id}', F('inventory_counts')],
  ['/tenant/inventory/products/{id}', F('inventory_products')],
  ['/tenant/inventory/purchase-orders/{id}', F('purchase_orders')],
  ['/tenant/inventory/transfers/{id}', F('inventory_transfers')],
  ['/tenant/locations/{id}', F('branches')],
  ['/pos/ai-customer-profile/duplicates/{groupId}', F('customers')],   // a duplicate group is keyed by a customer of the salon
];

// ── whole routes that are not IDOR targets, with the reason ──────────────────────────────────────────────────────
export const EXEMPT = [
  [/^\/pos\/ai-business\/metrics\/\{id\}/, X('a metric KEY from the fixed metric catalog, not a salon record')],
  [/^\/pos\/project-status\/module\/\{moduleKey\}/, X('a platform module key, not a salon record')],
  [/^\/owner\/reports\/\{reportId\}\/export/, X('a report KIND name; the export is always of the caller\'s own salon')],
  [/^\/tenant\/help\/(articles|videos)\/\{id\}/, X('platform-global help content (no tenant column) — the same for every salon by design')],
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
  // salon-wide by design
  customers: SW('one customer book per salon: a guest of location 2 walks into location 1 (cross-branch-suite.pgtest "salon-wide by design")'),
  services: SW('the menu is salon-wide; per-location prices / availability live in separate tables'),
  membership_plans: SW('a membership plan is honoured at every location of the salon'),
  customer_memberships: SW('a customer\'s membership is honoured at every location'),
  bundles: SW('service bundles belong to the salon menu'),
  deals: SW('a deal is published by the salon; per-location targeting is a field, not an access boundary'),
  campaigns: SW('marketing campaigns are salon-wide (owner / manager tool)'),
  gift_cards: SW('a gift card is redeemable at every location of the salon'),
  technicians: SW('a technician may work at several locations; the roster is salon-wide (branch membership is a separate table)'),
  users: SW('a staff account is salon-wide; its location access is user_branch_access'),
  reviews: SW('reviews are read salon-wide by the reputation tools'),
  inventory_service_recipes: SW('a service recipe is part of the salon menu'),
  ai_business_report_jobs: SW('salon-level AI business reports'),
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
