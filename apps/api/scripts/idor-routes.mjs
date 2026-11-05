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
  idempotencyKey: F('payment_attempts', 'idempotency_key'),   // Oct 13 2026 Tap to Pay: GET /mobile-checkout/payment-attempts/{idempotencyKey}
  techId: F('technicians'),   // Oct 12 2026 payroll: /pos/payroll/periods/{id}/technicians/{techId}
};

// ── `{id}` (and a few named params) by the path segment(s) in front of it ─────────────────────────────────────────
// Longest prefix wins. Keys are matched against the path with `{…}` params removed from the end.
export const SEGMENT_FIXTURES = [
  ['/community/incidents/{id}', F('tenant_private_incidents')],
  ['/community/mine/{id}', F('community_posts')],
  ['/community/posts/{id}', F('community_posts')],            // salon A's UNPUBLISHED draft — B must not read it
  ['/community/evidence/{id}', F('community_evidence')],
  ['/owner/operations/{id}', F('api_operations', 'id', { over: { realm: 'owner', actor_user_id: '$owner' } })],
  ['/pos/operations/{id}', F('api_operations', 'id', { over: { realm: 'pos', actor_user_id: '$owner' } })],
  ['/tech/operations/{id}', F('api_operations', 'id', { over: { realm: 'tech', actor_user_id: '$techUser' } })],
  ['/owner/payroll/periods/{id}', F('payroll_periods')], ['/pos/payroll/periods/{id}', F('payroll_periods')], ['/pos/tickets/{id}', F('tickets')],
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
  ['/tenant/ai/receptionist/agents/{id}', F('ai_receptionist_agents')],
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

/** The tech realm's routes are attacked by salon B's TECHNICIAN; every other route by salon B's OWNER. */
export const actorFor = (path) => (path.startsWith('/tech/') ? 'tech' : 'owner');
