#!/usr/bin/env node
// generate-realtime-catalog.mjs — Constitution 9 §247 (event catalog) + §248 (channel documentation).
//
// Generated from the registry so it cannot drift: EVENTS, EVENT_VERSIONS and AFFECTS are parsed from
// packages/realtime-contracts/src/realtime-core.ts (Constitution 13 §77); CHANNELS from packages/realtime-client/src/client.ts. The per-domain
// metadata below (audience, permission, sensitivity, source) is the one hand-maintained table — it is keyed by
// event-name PREFIX so a new event in an existing domain is documented automatically, and an event in a new
// domain shows up as UNCLASSIFIED — and fails the generator (exit 1) and the gate, so it cannot ship unclassified.
//   npm run docs:realtime-catalog   → writes REALTIME_EVENT_CATALOG.md at the repo root
//   node apps/api/scripts/generate-realtime-catalog.mjs --check → the gate (check:realtime-catalog): exit 1 on any
//   UNCLASSIFIED event or a stale committed catalog; writes nothing
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const api = readFileSync(resolve(root, 'packages/realtime-contracts/src/realtime-core.ts'), 'utf8');
const client = readFileSync(resolve(root, 'packages/realtime-client/src/client.ts'), 'utf8');
const block = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i); return s.slice(i, j + b.length); };

const events = [...block(api, 'export const EVENTS = {', '} as const;').matchAll(/(\w+):\s*["']([a-z_]+)["']/g)].map((m) => ({ key: m[1], name: m[2] }));
const versions = Object.fromEntries([...block(api, 'export const EVENT_VERSIONS', '};').matchAll(/\b([a-z_]+):\s*(\d+)\b/g)].map((m) => [m[1], Number(m[2])]));
const affects = Object.fromEntries([...block(api, 'const AFFECTS', '};').matchAll(/^\s+([a-z_]+):\s*\[([^\]]*)\]/gm)].map((m) => [m[1], m[2].split(',').map((x) => x.trim().replace(/"/g, '')).filter(Boolean)]));
const channelsBlock = block(client, 'export const CHANNELS = {', '} as const;');
const channels = [...channelsBlock.matchAll(/'([a-z.]+)':\s*\[([^\]]*)\]/g)].map((m) => ({ name: m[1], events: [...m[2].matchAll(/EVENTS\.(\w+)/g)].map((x) => events.find((e) => e.key === x[1])?.name ?? x[1]) }));

/** Hand-maintained: domain → audience/permission/sensitivity/source. Keyed by event-name prefix (longest match wins). */
const DOMAINS = [
  ['ai_job_',                 { source: 'AI Platform',       audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Signal only — requestId, taskKey, status; never a prompt, an output or customer data (projected by events/consumers/realtime-projection from AI_JOB_STARTED / COMPLETED / FAILED)' }],
  ['appointment_',            { source: 'Booking',           audience: 'Tenant branch room (POS/Owner); Customer SELF room',       permission: 'pos.login (tenant) · customer session (self)', sensitivity: 'Operational — envelope facts only, no PII (§22)' }],
  ['message_delivery_',       { source: 'Communications',    audience: 'Tenant room (every location screen of the salon)',          permission: 'pos.login', sensitivity: 'Signal only — message id + delivery status; no number, no body' }],   // C2 (Nov 5 2026)
  ['conversation_',           { source: 'Communications',    audience: 'Tenant branch room (SMS Inbox)',                           permission: 'pos.communications.view', sensitivity: 'Signal only — threadId, kind, version; never a phone, a name or message text' }],
  ['team_member_',            { source: 'Team Management',   audience: 'Tenant branch rooms (the new member\'s branches + the creator\'s)', permission: 'pos.technicians.view', sensitivity: 'Signal only — memberId; never a name, email or phone' }],
  ['loyalty_network_',        { source: 'Global rewards network', audience: 'Tenant branch rooms (every POS of the salon)', permission: 'pos.customers.view', sensitivity: 'Signal only — a kind word; never a rate, a balance or an amount' }],
  ['customer_checked_in',     { source: 'Check-in',          audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Operational' }],
  ['customer_display_',       { source: 'Customer Display',  audience: 'Customer-display session room only',                       permission: 'display session', sensitivity: 'Contains no card data by construction (forbidden keys stripped)' }],
  ['customer_',               { source: 'Customers',         audience: 'Tenant branch room; Customer SELF room',                   permission: 'pos.login · customer session', sensitivity: 'Operational — changedFields names only' }],
  ['queue_',                  { source: 'Queue',             audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Operational' }],
  ['ticket_',                 { source: 'Serving / Checkout', audience: 'Tenant branch room; Ticket room (Customer App)',          permission: 'pos.login · ticket holder', sensitivity: 'Operational; technician stream receives event-only frames (§22)' }],
  ['service_',                { source: 'Serving',           audience: 'Tenant branch room; Ticket room',                          permission: 'pos.login', sensitivity: 'Operational' }],
  ['payment_',                { source: 'Checkout',          audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Financial — amounts only, never instrument data' }],
  ['mobile_pay_',             { source: 'Owner & Manager Payment App', audience: 'Tenant branch room',                              permission: 'pos.login', sensitivity: 'Operational — device id / status only, never a credential' }],
  ['receipt_',                { source: 'Checkout',          audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Operational' }],
  ['checkout_',               { source: 'Checkout',          audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Financial — totals only' }],
  ['reports_',                { source: 'Reports',           audience: 'Tenant branch room; Owner tenant room',                    permission: 'pos.login · owner', sensitivity: 'Signal only (refetch)' }],
  ['turn_queue_',             { source: 'Technician turn queue', audience: 'Tenant branch room; Technician room (self)',              permission: 'turn_queue.read · technician self', sensitivity: 'Operational — ids and event types only' }],
  ['technician_help_',        { source: 'Helper allocation', audience: 'Tenant branch room; Technician room',                      permission: 'pos.login · technician self', sensitivity: 'Operational' }],
  ['technician_',             { source: 'Technicians',       audience: 'Technician room (self); Owner tenant room',                permission: 'technician self · owner', sensitivity: 'Earnings events are financial — amounts only' }],
  ['tech_salon_membership_',  { source: 'Tech profile',      audience: 'Technician room (self); Owner tenant room',                permission: 'technician self · owner', sensitivity: 'Operational' }],
  ['time_clock_',             { source: 'Time clock',        audience: 'Tenant branch room',                                       permission: 'pos.login', sensitivity: 'Operational — NOT presence (§49)' }],
  // Phase 15: notifySettingsChanged sends to the OWNER room only (the Owner App stream, owner.dashboard.view) — never a branch room
  ['settings_',               { source: 'Settings',          audience: 'Owner tenant room (Owner App stream)',                     permission: 'owner.dashboard.view', sensitivity: 'Signal only (the category)' }],
  ['tenant_status_',          { source: 'Tenant admin',      audience: 'Owner tenant room; Tenant branch room',                    permission: 'owner · pos.login', sensitivity: 'Signal only' }],
  ['owner_',                  { source: 'Owner alerts / payroll', audience: 'Owner tenant room only',                              permission: 'owner', sensitivity: 'Payroll events are financial — refetch signal only' }],
  ['daily_follow_up_',        { source: 'End-of-day follow-ups', audience: 'Tenant branch room; Technician room',                 permission: 'pos.login · technician self', sensitivity: 'Operational' }],
  ['follow_up_',              { source: 'End-of-day follow-ups', audience: 'Technician room (self)',                              permission: 'technician self', sensitivity: 'Operational' }],
  ['cash_drawer_',            { source: 'Cash drawer',       audience: 'Tenant branch room',                                       permission: 'pos.login (pos.reports.view or pos.checkout.take_payment to act)', sensitivity: 'Financial — amounts only' }],
  ['cash_handoff_',           { source: 'Tech cash hand-off', audience: 'Tenant branch room; Technician room (self)',              permission: 'pos.login · technician self', sensitivity: 'Financial — amounts only' }],
  ['cash_',                   { source: 'Skip-line checkout (cash path)', audience: 'Tenant branch room; Technician room (self)',  permission: 'pos.login · technician self', sensitivity: 'Financial — amounts only' }],
  ['customer_bill_',          { source: 'Skip-line checkout', audience: 'Tenant branch room; Customer SELF room',                  permission: 'pos.login · customer session', sensitivity: 'Financial — totals only' }],
  ['customer_payment_',       { source: 'Skip-line checkout', audience: 'Tenant branch room; Customer SELF room',                  permission: 'pos.login · customer session', sensitivity: 'Financial — status/amounts only, never instrument data' }],
  ['skip_line_',              { source: 'Skip-line checkout', audience: 'Tenant branch room; Customer SELF room',                  permission: 'pos.login · customer session', sensitivity: 'Operational' }],
  ['loyalty_',                { source: 'Loyalty',           audience: 'Tenant branch room; Customer SELF room',                   permission: 'pos.login · customer session', sensitivity: 'Points balance only' }],
  ['ticket_closed',           { source: 'Skip-line checkout', audience: 'Tenant branch room',                                      permission: 'pos.login', sensitivity: 'Operational' }],
  ['queue_alert_',            { source: 'AI queue assignment', audience: 'Tenant branch room',                                     permission: 'pos.login', sensitivity: 'Operational' }],
  ['queue_a',                 { source: 'AI queue assignment', audience: 'Tenant branch room',                                     permission: 'pos.login', sensitivity: 'Operational' }],
  ['queue_record_',           { source: 'AI queue assignment', audience: 'Tenant branch room',                                     permission: 'pos.login', sensitivity: 'Operational' }],
  // Phase 15 (agent G): classified from the ONE path that produces them — events/consumers/realtime-projection.consumer.ts
  // (none of these domains emits realtime itself). schedClient: a branch-scoped envelope → that branch room, a salon-wide
  // one → the owner room. communityClient ('salon' scope): owner room + branch-less room + every branch room the payload
  // names (the salon's OWN branches) + the envelope's branch. Payload class for all: ids + status/kind/version only.
  ['schedule_',               { source: 'AI Scheduling Optimizer (Phase 7)', audience: 'Tenant branch room (branch-scoped run/recommendation/settings) · Owner tenant room (salon-wide)', permission: 'pos.login · owner.dashboard.view (room); screens refetch under ai_scheduling.view', sensitivity: 'Signal only — runId / recommendationId / proposalId / insightId + status (settings: scope + version); never customer data' }],
  // Super Admin POS Top-Bar Announcements (Oct 22 2026): one event per TARGETED salon, so a salon's rooms never hear another salon's notice
  ['platform_announcement_', { source: 'Platform Announcements (Super Admin)', audience: 'Salon scope — Owner tenant room + branch-less room + the targeted branch rooms of each targeted salon only', permission: 'pos.login (room); GET /pos/platform-announcements/active re-applies tenant/branch targeting', sensitivity: 'Signal only — announcementId, version, action, branchIds; never the title or message text' }],
  ['community_',              { source: 'Safety Community (Phase 8)', audience: 'Salon scope — Owner tenant room + branch-less room + the salon’s own branch rooms (ADVISORY_*/COMMENT_*: origin salon; ALERT_DELIVERED: each recipient salon)', permission: 'pos.login · owner.dashboard.view (room); screens refetch under community.feed.view', sensitivity: 'Signal only — postId / commentId + status (alert: severity + category; settings: version); never the post text, reporter or evidence' }],
  ['approval_',               { source: 'Salon approvals engine (Phase 9)', audience: 'Salon scope — Owner tenant room + branch-less room + the request’s branch room', permission: 'pos.login · owner.dashboard.view (room); screens refetch under approvals.view', sensitivity: 'Signal only — approvalId + kind + status; never the request payload' }],
  ['expense_',                { source: 'Receipts & Expenses (finance mandate, Oct 21 2026)', audience: 'Salon scope — Owner tenant room + branch-less room + the expense’s branch room', permission: 'pos.login · owner.dashboard.view (room); screens refetch under owner.expenses.view', sensitivity: 'Signal only — expenseId / documentId + action + status; never an amount, vendor, card or receipt text' }],
  ['authorization_',          { source: 'Permissions / roles (Phase 9)', audience: 'Salon scope — Owner tenant room + branch-less room + the envelope’s branch room', permission: 'pos.login · owner.dashboard.view (room); Roles screens refetch under roles.view; the person’s next request is re-authorized (x-authorization-changed)', sensitivity: 'Signal only — userId + change kind + version; never the permission set' }],
  ['platform_ops_',           { source: 'Platform live ops (Phase 20)', audience: 'Platform room — Super Admin only',              permission: 'SUPER_ADMIN', sensitivity: 'Aggregates only; no identity of any kind (§60/§206)' }],
];
const classify = (name) => { const hit = [...DOMAINS].sort((a, b) => b[0].length - a[0].length).find(([p]) => name.startsWith(p)); return hit ? hit[1] : { source: 'UNCLASSIFIED', audience: 'UNCLASSIFIED', permission: 'UNCLASSIFIED', sensitivity: 'UNCLASSIFIED' }; };

const recovery = (name) => (affects[name]?.length ? `Refetch: ${affects[name].join(', ')}` : name === 'platform_ops_snapshot' ? 'Apply snapshot; next tick replaces it' : 'No screen (event-only signal)');

let md = `# REALTIME_EVENT_CATALOG.md\n### Constitution 9 §247 event catalog + §248 channel documentation — GENERATED by \`npm run docs:realtime-catalog\`; do not edit by hand.\n\n`;
md += `Registry: \`packages/realtime-contracts/src/realtime-core.ts\` (${events.length} events, all versioned). The client package re-exports it — one registry (Constitution 13 §77); \`check:realtime-contract\` fails on any copy.\n\n`;
md += `**Payload:** every frame is \`{ event, v, screens, payload?, seq, stream }\`; \`payload\` is the sealed envelope \`{ eventId, eventType, tenantId, branchId, resourceType, resourceId, updatedAt, version, data }\` with forbidden keys stripped and a 32 KB cap. Technician and Customer streams receive event-only frames (no \`payload\`).\n\n`;
md += `## Events (§247)\n\n| Name | Version | Source domain | Audience | Required permission | Recovery strategy | Sensitivity |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
for (const e of events) { const c = classify(e.name); md += `| \`${e.name}\` | ${versions[e.name] ?? '—'} | ${c.source} | ${c.audience} | ${c.permission} | ${recovery(e.name)} | ${c.sensitivity} |\n`; }
const unclassified = events.filter((e) => classify(e.name).source === 'UNCLASSIFIED');
if (unclassified.length) md += `\n**UNCLASSIFIED (add a DOMAINS row):** ${unclassified.map((e) => e.name).join(', ')}\n`;

md += `\n## Channels (§248)\n\n`;
md += `Internal room names are server-derived and never seen by a client (§13/§110); the \`stream\` slot (\`r0\`, \`r1\`) is the only room identifier on the wire.\n\n`;
const CHANNEL_DOC = {
  'branch.queue':    { type: 'BRANCH',   actors: 'Tenant users (OWNER, MANAGER, FRONT_DESK, RECEPTION)', permission: 'pos.login', scope: 'BRANCH (home branch from session)', room: 'tenantBranch(tenantId, branchId)', snapshot: 'GET /pos/queue' },
  'branch.booking':  { type: 'BRANCH',   actors: 'Tenant users', permission: 'pos.login', scope: 'BRANCH', room: 'tenantBranch', snapshot: 'GET /pos/booking (board range)' },
  'branch.serving':  { type: 'BRANCH',   actors: 'Tenant users; Ticket holder (Customer App) for ticket-scoped events', permission: 'pos.login · ticket holder', scope: 'BRANCH / TICKET', room: 'tenantBranch · ticket(ticketId)', snapshot: 'GET /pos/serving' },
  'branch.checkout': { type: 'BRANCH',   actors: 'Tenant users', permission: 'pos.login', scope: 'BRANCH', room: 'tenantBranch', snapshot: 'GET /pos/checkout/:ticketId' },
  'technician.me':   { type: 'USER',     actors: 'TECHNICIAN (self)', permission: 'technician session', scope: 'SELF + home branch', room: 'technician(technicianId) · tenantBranch', snapshot: 'GET /tech/today' },
  'owner.dashboard': { type: 'TENANT',   actors: 'OWNER', permission: 'owner session', scope: 'TENANT (+ home branch)', room: 'ownerTenant(tenantId) · tenantBranch', snapshot: 'GET /owner/dashboard · GET /owner/alerts' },
  'customer.me':     { type: 'CUSTOMER', actors: 'CUSTOMER (self)', permission: 'customer session', scope: 'SELF + checked-in branch', room: 'customer(customerId) · tenantBranch', snapshot: 'GET /customer/me' },
};
md += `| Channel | Type | Actors allowed | Permission | Scope | Internal room | Typical events | Snapshot API |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
for (const ch of channels) { const d = CHANNEL_DOC[ch.name] ?? {}; md += `| \`${ch.name}\` | ${d.type ?? '?'} | ${d.actors ?? '?'} | ${d.permission ?? '?'} | ${d.scope ?? '?'} | \`${d.room ?? '?'}\` | ${ch.events.map((e) => `\`${e}\``).join(', ')} | ${d.snapshot ?? '?'} |\n`; }
md += `| \`platform.live-ops\` (server-only) | PLATFORM | SUPER_ADMIN | SuperAdminGuard | PLATFORM (aggregates) | \`platform()\` | \`platform_ops_snapshot\` | GET /super-admin/system-status/realtime |\n`;
md += `\nSnapshot APIs listed are the existing screen endpoints the client refetches on \`screens\`; realtime never introduces a second read path (§180).\n`;

const CHECK = process.argv.includes('--check');
const outPath = resolve(root, 'REALTIME_EVENT_CATALOG.md');
if (CHECK) {
  let onDisk = ''; try { onDisk = readFileSync(outPath, 'utf8'); } catch { /* missing → stale */ }
  if (onDisk !== md) { console.error('realtime catalog: REALTIME_EVENT_CATALOG.md is stale — run `npm run docs:realtime-catalog` (apps/api)'); process.exitCode = 1; }
} else writeFileSync(outPath, md);
console.log(`REALTIME_EVENT_CATALOG.md: ${events.length} events, ${channels.length + 1} channels${unclassified.length ? `, ${unclassified.length} UNCLASSIFIED` : ''}`);
// Phase 15: an UNCLASSIFIED event is a gate failure, not a footnote — a new realtime domain must say who hears it, under
// which permission, and what its payload may carry before it ships. `--check` (the gate) also fails when the committed
// catalog is stale (the generator's output differs from REALTIME_EVENT_CATALOG.md on disk).
if (unclassified.length) {
  console.error(`realtime catalog: ${unclassified.length} UNCLASSIFIED event(s) — add a DOMAINS row in apps/api/scripts/generate-realtime-catalog.mjs: ${unclassified.map((e) => e.name).join(', ')}`);
  process.exitCode = 1;
}
