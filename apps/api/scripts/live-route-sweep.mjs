#!/usr/bin/env node
// live-route-sweep.mjs — WAVE 4 SWEEP (Oct 13 2026): every GET route of the API, called on the REAL booted API against a
// REAL PostgreSQL seeded with a realistic two-salon dataset, as a role the role matrix says may call it.
//
// What it proves, per route of apps/api/openapi/manifest.txt:
//   MOUNTED   the path is mounted (a Nest "Cannot GET" 404 = the controller is in the manifest but not in the app)
//   SERVED    the permitted principal (chosen from security/role-matrix.snapshot.json: a cell 'A' or 'U') gets a 2xx.
//             A 5xx is a defect. A 4xx for a permitted principal is a defect unless it is explained (a fixture id the
//             route reads as a different kind of record → 404, a required query nobody can guess → 400, a feature switch).
//   FAST      the response is complete in under 2 s
//   SANE      a JSON body parses, and its text carries no "[object Object]" / ":NaN" / "undefined" value and no secret
//             column (password_hash, token_hash, secret, …)
//   DENIED    a principal whose matrix cell is 'D' (same realm, key not held) gets 403 — the route's permission key is
//             the one the role matrix says (a 2xx here is a permission leak)
// Then every safe preview POST (a pure dry-run: a compute-only preview with no write) with a minimal valid body.
//
// Run (apps/api built; DB migrated; a SCRATCH database only — it seeds and never cleans, by design: re-runnable):
//   DATABASE_URL=postgres://postgres@localhost:5432/w4_sweep node apps/api/scripts/live-route-sweep.mjs
//   env: SWEEP_PORT (3181) · SWEEP_OUT (JSON results file) · SWEEP_ONLY (regex on the path) · SWEEP_VERBOSE=1
// The seed chain (seed.ts → seed-demo.ts → seed-local-accounts.ts for salons LUXE and PALACE) runs on first use.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyIdorRoute } from './idor-routes.mjs';
import { makeSeeder } from './lib/generic-seeder.mjs';
import { pgLogErrors } from './lib/pg-log-errors.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const API_ROOT = resolve(new URL('..', import.meta.url).pathname);
const REPO = resolve(API_ROOT, '../..');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error('refusing a non-local database'); process.exit(2); }
const PORT = Number(process.env.SWEEP_PORT || 3181), API = `http://127.0.0.1:${PORT}`;
const ONLY = process.env.SWEEP_ONLY ? new RegExp(process.env.SWEEP_ONLY) : null;
const SLOW_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new pg.Client({ connectionString: DB }); await client.connect();
const RUN_STARTED = new Date();
const DB_NAME = new URL(DB).pathname.replace(/^\//, '');
const OWN_PID = (await client.query('select pg_backend_pid() as p')).rows[0].p;   // the sweep's own seeding connection
const q = async (s, p = []) => (await client.query(s, p)).rows;

// ── 1. the salon data: the documented seed chain, then the top-ups the chain does not make ────────────────────────
const PW = { owner: 'Owner123!', front: 'FrontDesk123!', tech: 'Tech123!', cust: 'Customer123!', staff: 'Sweep123!x', admin: 'Admin123!x' };
const tsx = (script, env) => {
  const r = spawnSync('npx', ['tsx', `apps/api/scripts/${script}`], { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${script}: ${r.stderr || r.stdout}`);
};
for (const [code, name, dom] of [['LUXE', 'Luxe Nails', 'luxenails'], ['PALACE', 'Palace Nails', 'palace']]) {
  if ((await q(`select 1 from tenants where tenant_code = $1`, [code])).length) continue;
  const base = { SEED_TENANT_CODE: code, SEED_SUPER_ADMIN_EMAIL: 'admin@aipowersalon.test', SEED_SUPER_ADMIN_PASSWORD: PW.admin };
  tsx('seed.ts', { ...base, SEED_TENANT_NAME: name, SEED_TENANT_EMAIL: `hello@${dom}.test`, SEED_OWNER_EMAIL: `owner@${dom}.test`, SEED_OWNER_PASSWORD: PW.owner });
  tsx('seed-demo.ts', base);
  tsx('seed-local-accounts.ts', { ...base, SEED_FRONTDESK_EMAIL: `frontdesk@${dom}.test`, SEED_TECH_EMAIL: `tech@${dom}.test`, SEED_CUSTOMER_EMAIL: code === 'LUXE' ? 'customer@test.com' : `customer@${dom}.test` });
}
const tenantOf = async (code) => (await q(`select id from tenants where tenant_code = $1`, [code]))[0].id;
const A = { code: 'LUXE', id: await tenantOf('LUXE') }, B = { code: 'PALACE', id: await tenantOf('PALACE') };
for (const s of [A, B]) {
  s.branch = (await q(`select id from branches where tenant_id = $1 order by created_at limit 1`, [s.id]))[0].id;
  s.owner = (await q(`select id from users where tenant_id = $1 and role = 'OWNER' limit 1`, [s.id]))[0].id;
}
const MARK = 'SWEEPA';
const staffHash = await hashPassword(PW.staff);
async function ensureUser(s, email, role, branches, extra = {}) {
  let id = (await q(`select id from users where lower(email) = lower($1)`, [email]))[0]?.id;
  if (!id) {
    id = randomUUID();
    await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role)
      values ($1,$2,$3,$4,'Sweep',$4 || ' Sweep',$5,$6,'active',$7,false,$8)`, [id, s?.id ?? null, s ? branches[0] : null, extra.first ?? role[0] + role.slice(1).toLowerCase(), email, staffHash, role, extra.platformRole ?? null]);
  }
  if (s) for (const b of branches) await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) select $1,$2,$3,$4 where not exists (select 1 from user_branch_access where user_id = $3 and branch_id = $2)`, [s.id, b, id, role === 'OWNER' || role === 'MANAGER' ? 'manager' : 'staff']);
  return id;
}
// a second branch for salon A (multi-branch screens, transfers) — the owner reaches both
A.branch2 = (await q(`select id from branches where tenant_id = $1 and id <> $2 order by created_at limit 1`, [A.id, A.branch]))[0]?.id;
if (!A.branch2) { A.branch2 = randomUUID(); await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,'Cherry Hill','active','America/New_York','2 Sweep Way')`, [A.branch2, A.id]); }
// (explicit grants CONFINE a user — branch-access.ts — so the owner is granted both branches, never just the new one)
for (const b of [A.branch, A.branch2]) await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) select $1,$2,$3,'manager' where not exists (select 1 from user_branch_access where user_id = $3 and branch_id = $2)`, [A.id, b, A.owner]);
A.manager = await ensureUser(A, 'manager@luxenails.test', 'MANAGER', [A.branch, A.branch2]);
A.reception = await ensureUser(A, 'reception@luxenails.test', 'RECEPTION', [A.branch]);
B.manager = await ensureUser(B, 'manager@palace.test', 'MANAGER', [B.branch]);
const { PLATFORM_ROLES } = require(resolve(REPO, 'packages/permissions/dist/platform-roles.js'));
const platformEmail = (pr) => `sweep-${pr.toLowerCase().replace(/_/g, '-')}@aipowersalon.test`;
for (const pr of PLATFORM_ROLES) await ensureUser(null, platformEmail(pr), 'SUPER_ADMIN', [], { platformRole: pr, first: pr });

// the rows the operational screens read that the chain does not make (memberships, gift cards, payroll, a payment…)
const seedLog = [];
const seederFor = (s) => makeSeeder({
  query: (sql, p) => client.query(sql, p), mark: MARK, log: seedLog,
  fixed: { tenants: s.id, branches: s.branch, users: s.owner },
  tokens: { $owner: s.owner },
  overrides: {
    pos_tech_appointments: { start_time: '10:00', end_time: '11:00' }, api_operations: { kind: 'sweep.proof' },
    inventory_transfers: { from_branch_id: s.branch, to_branch_id: s.branch2 ?? s.branch },
    tenant_community_settings: { enabled: true },
  },
});
const seeders = { A: seederFor(A), B: seederFor(B) };

// ── 2. fixtures: a REAL row of salon A for every path parameter ──────────────────────────────────────────────────
const hasCol = new Map();
const colsOf = async (t) => hasCol.get(t) ?? hasCol.set(t, new Set((await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [t])).map((r) => r.column_name))).get(t);
/** salon A's row of `table` (an existing one first — the realistic data — else a seeded one); returns `col`. */
async function fixture(table, col = 'id', pin = null) {
  const cols = await colsOf(table);
  if (!cols.size) throw new Error(`no table ${table}`);
  const where = []; const params = [];
  if (cols.has('tenant_id')) { params.push(A.id); where.push(`tenant_id = $${params.length}`); }
  for (const [k, v] of Object.entries(pin ?? {})) { params.push(v === '$owner' ? A.owner : v === '$tech' ? A.tech : v === '$techUser' ? A.techUser : v); where.push(`"${k}" = $${params.length}`); }
  if (col !== 'id') where.push(`"${col}" is not null`);
  const order = cols.has('created_at') ? 'order by created_at desc' : '';
  const hit = (await q(`select "${col}" as v from "${table}" ${where.length ? 'where ' + where.join(' and ') : ''} ${order} limit 1`, params))[0];
  if (hit) return hit.v;
  await client.query('begin');
  try {
    const id = await seeders.A.rowOf(table, { pin: pin ? Object.fromEntries(Object.entries(pin).map(([k, v]) => [k, v === '$tech' ? A.tech : v === '$techUser' ? A.techUser : v])) : null });
    let v = col === 'id' ? id : (await q(`select "${col}" as v from "${table}" where id = $1`, [id]))[0]?.v;
    if (v == null) { v = `${MARK}-${col}`; await q(`update "${table}" set "${col}" = $2 where id = $1`, [id, v]); }
    await client.query('commit');
    return v;
  } catch (e) { await client.query('rollback'); throw e; }
}
A.tech = (await q(`select t.id, t.user_id from technicians t join users u on u.id = t.user_id where t.tenant_id = $1 and u.email = 'tech@luxenails.test'`, [A.id]))[0]?.id;
A.techUser = (await q(`select id from users where email = 'tech@luxenails.test'`))[0]?.id;
A.customerUser = (await q(`select id from users where email = 'customer@test.com'`))[0]?.id;
A.customer = (await q(`select id from customers where user_id = $1 limit 1`, [A.customerUser]))[0]?.id ?? await fixture('customers');
A.service = (await q(`select id from services where tenant_id = $1 and status = 'active' order by created_at limit 1`, [A.id]))[0]?.id;

// params of the routes outside the staff IDOR table (super-admin, customer, devices) — by name, then by path segment
// catalog keys (fixed registries, not rows) — read from the built code so the sweep never drifts from them
const dist = (rel) => require(resolve(REPO, rel));
const CATALOG = {
  reminderType: dist('modules/super-admin/dist/super-admin-smart-reminders/smart-reminders-core.js').REMINDER_TYPES[0].key,
  component: dist('apps/api/dist/observability/health-core.js').COMPONENTS[0].key,
  aiPackage: dist('modules/ai/dist/ai/ai-catalog.js').AI_PACKAGE_CODES[0],
  settingsModule: dist('apps/api/dist/project-status/project-status.dto.js').POS_SETTINGS_MODULES[0].moduleKey,
  posModule: (() => { try { return dist('apps/api/dist/pos-project-status/pos-project-status.dto.js').POS_MODULE_DEFS?.[0]?.moduleKey ?? 'pos'; } catch { return 'pos'; } })(),
};
const P = (table, col = 'id', pin = null) => ({ table, col, pin });
const V = (value) => ({ value });
const NAME_FIXTURES = {
  tenantId: V(A.id), salonId: V(A.branch),   // a customer-app "salon" is a BRANCH (customer-salons.service)
 branchId: V(A.branch), customerId: V(A.customer), technicianId: V(A.tech), techId: V(A.tech),
  ownerId: V(A.owner), userId: V(A.owner), profileId: P('global_tech_profiles'), publicSlug: P('global_tech_profiles', 'public_slug'),
  ticketId: P('tickets'), appointmentId: P('pos_tech_appointments'), serviceId: P('services'), queueItemId: P('pos_queue_items'),
  sessionId: P('go_checkin_sessions'), runId: P('ai_report_runs'), reminderType: V(CATALOG.reminderType), postId: P('nail_showcase_posts'),
  threadId: P('communication_threads'), planId: P('membership_plans'), membershipId: P('customer_memberships'), packageId: P('hardware_packages'),
  code: P('gift_cards', 'code'), moduleKey: V(CATALOG.posModule), paymentId: P('payments'), activityId: P('tenant_event_logs'), callId: P('voice_call_outcomes'),
  slug: P('tenants', 'tenant_slug'), key: V('community'), category: V('security'), dataClass: V('audit_events'), metric: V('technicians'),
  traceId: V('0af7651916cd43dd8448eb211c80319c'), correlationId: V(randomUUID()), requestId: V(randomUUID()), token: P('billing_export_jobs', 'id'),
  idempotencyKey: P('payment_attempts', 'idempotency_key'), path: V('x'),
};
const SEGMENT = [
  ['/customer-display/checkout/{sessionId}', P('customer_display_sessions')], ['/customer/deals', P('deals')], ['/customer/follow-ups/{id}', P('service_follow_up_tasks')],
  ['/customer/invoices/{id}', P('invoices')], ['/customer/messages/{threadId}', P('communication_threads')], ['/customer/operations/{id}', P('api_operations', 'id', { realm: 'customer' })],
  ['/super-admin/ai-insights/{id}', P('ai_insights')], ['/super-admin/ai-reports/runs/{id}', P('ai_report_runs')], ['/super-admin/alerts/{id}', P('alerts')],
  ['/super-admin/audit-logs/evidence-packs/{id}', P('audit_evidence_packs')], ['/super-admin/audit-logs/investigations/{id}', P('audit_investigations')],
  ['/super-admin/campaigns/templates/{id}', P('campaign_templates')], ['/super-admin/catalog/service-templates/{id}', P('service_templates')],
  ['/super-admin/communications/providers/{id}', P('communication_providers')], ['/super-admin/communications/templates/{id}', P('message_templates')],
  ['/super-admin/community-moderation/cases/{id}', P('community_moderation_cases')], ['/super-admin/community-moderation/evidence/{id}', P('community_evidence')],
  ['/super-admin/community-moderation/posts/{id}', P('community_posts')], ['/super-admin/customer-data-oversight/sync/runs/{id}', P('customer_recon_runs')],
  ['/super-admin/device-management/devices/{id}', P('go_checkin_devices')], ['/super-admin/disputes/{id}', P('chargebacks')],
  ['/super-admin/gift-cards/settlement/batches/{id}', P('gift_card_settlement_batches')], ['/super-admin/integrations/connections/{id}', P('integration_connections')],
  ['/super-admin/membership-programs/programs/{id}', P('membership_plans')], ['/super-admin/onboarding/{id}', P('onboarding_records')],
  ['/super-admin/operations/{id}', P('api_operations', 'id', { realm: 'super_admin' })], ['/super-admin/plans/{id}', P('subscription_plans')],
  ['/super-admin/platform/applications/{id}', P('tenant_applications')], ['/super-admin/platform/branches/{id}', V(A.branch)],
  ['/super-admin/platform/payments-transactions/{id}', P('payments')], ['/super-admin/platform/users/{id}', V(A.owner)],
  ['/super-admin/platform-staff/{userId}', V(null)], ['/super-admin/product-catalog/products/{id}', P('product_master')],
  ['/super-admin/revenue-residuals/agreements/{id}', P('revenue_agreements')], ['/super-admin/revenue-residuals/export-jobs/{id}', P('revenue_export_jobs')],
  ['/super-admin/revenue-residuals/residual-statements/{id}', P('residual_statements')], ['/super-admin/scheduled-reports/runs/{runId}', P('super_admin_scheduled_report_runs')],
  ['/super-admin/scheduled-reports/{id}', P('super_admin_scheduled_reports')], ['/super-admin/security/incidents/{id}', P('security_incidents')],
  ['/super-admin/security/lockdowns/{id}', P('emergency_lockdowns')], ['/super-admin/security/privileged-access/{id}', P('privileged_access_grants')],
  ['/super-admin/settings/general/legal-documents/{id}', P('legal_document_versions')], ['/super-admin/settings/general/tenant-presets/{id}', P('tenant_presets')],
  ['/super-admin/smart-reminders/templates/{id}', P('reminder_templates')], ['/super-admin/support/tickets/{id}', P('support_tickets')],
  ['/super-admin/system-status/incidents/{id}', P('status_incidents')], ['/super-admin/system/components/{key}', V(CATALOG.component)], ['/super-admin/project-status/pos-settings/{moduleKey}', V(CATALOG.settingsModule)],
  ['/super-admin/tenant-locations/{id}', V(A.branch)], ['/super-admin/tenants/{id}', V(A.id)], ['/super-admin/website-leads/{id}', P('website_leads')],
  ['/super-admin/ai/packages/{code}', V(CATALOG.aiPackage)], ['/super-admin/hardware-packages/{packageId}', P('hardware_packages')],
  ['/super-admin/sms-packages/{packageId}', P('sms_verification_packages')], ['/super-admin/billing/exports/jobs/{token}', P('billing_export_jobs')],
  ['/super-admin/memberships/plans/{planId}', P('membership_plans')], ['/super-admin/features/{key}', P('platform_features', 'key')],
  ['/mobile-checkout/tickets/{ticketId}', P('tickets')],
];
const OWNED = [
  [/^\/customer\/follow-ups\/\{id\}/, 'service_follow_up_tasks'], [/^\/customer\/invoices\/\{id\}/, 'invoices'],
  [/^\/customer\/payments\/\{paymentId\}/, 'payments'], [/^\/customer\/queue\/\{queueItemId\}/, 'pos_queue_items'],
  [/^\/customer\/messages\/\{threadId\}/, 'tech_dm_threads'], [/^\/customer\/nail-showcase\/posts\/\{postId\}/, 'nail_showcase_posts'],
  [/^\/customer\/tickets\/\{ticketId\}/, 'tickets'],
  [/^\/tech\/tickets\/\{(id|ticketId)\}/, 'pos_tech_queue_tickets']   /* the tech app addresses a ticket by its tech-queue projection id */, [/^\/tech\/profile\/messages\/\{threadId\}/, 'tech_dm_threads'],
];
async function ownedFixture(route, name, upTo) {
  const hit = OWNED.find(([re]) => re.test(upTo));
  if (!hit) return null;
  const table = hit[1]; const cols = await colsOf(table);
  const where = ['tenant_id = $1']; const params = [A.id];
  if (route.path.startsWith('/customer/')) {
    if (cols.has('customer_id')) { params.push(A.customer); where.push(`customer_id = $${params.length}`); }
    else if (cols.has('customer_user_id')) { params.push(A.customerUser); where.push(`customer_user_id = $${params.length}`); }
    else return null;
  } else {
    const c = ['primary_technician_id', 'technician_id', 'assigned_technician_id'].find((x) => cols.has(x));
    if (!c) return null;
    params.push(A.tech); where.push(`${c} = $${params.length}`);
  }
  const found = (await q(`select id from "${table}" where ${where.join(' and ')} ${cols.has('created_at') ? 'order by created_at desc' : ''} limit 1`, params))[0]?.id;
  if (found) return found;
  // none yet: seed one owned by the caller
  const pin = {}; for (let i = 1; i < params.length; i++) pin[where[i].split(' ')[0]] = params[i];
  await client.query('begin');
  try { const id = await seeders.A.rowOf(table, { pin }); await client.query('commit'); return id; } catch (e) { await client.query('rollback'); return null; }
}
async function paramValue(route, name) {
  const upTo = route.path.slice(0, route.path.indexOf(`{${name}}`) + name.length + 2);
  // a refund preview needs a ticket that still has captured money to return
  if (/refund-preview$/.test(route.path) && name === 'ticketId') {
    const t = (await q(`select t.id from tickets t join payments p on p.ticket_id = t.id where t.tenant_id = $1 and p.status in ('captured','succeeded','paid','completed') group by t.id order by max(p.created_at) desc limit 1`, [A.id]).catch(() => []))[0]?.id;
    if (t) return t;
  }
  // the CALLER's own records: a customer route reads the signed-in customer's rows, a /tech route the technician's
  const own = await ownedFixture(route, name, upTo);
  if (own) return own;
  if (route.realm === 'staff' || route.realm === 'shared') {
    const c = classifyIdorRoute(route);
    const fx = c.params?.[name];
    if (fx) return fx.value ?? fixture(fx.table, fx.col, fx.over ?? null);
  }
  const seg = SEGMENT.filter(([k]) => upTo.endsWith(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  const fx = seg ?? NAME_FIXTURES[name];
  if (!fx) return null;
  if ('value' in fx) return fx.value;
  return fixture(fx.table, fx.col, fx.pin);
}

// ── 3. the route list and who may call each (the committed role matrix) ──────────────────────────────────────────
const manifest = readFileSync(resolve(API_ROOT, 'openapi/manifest.txt'), 'utf8');
const matrix = JSON.parse(readFileSync(resolve(API_ROOT, 'security/role-matrix.snapshot.json'), 'utf8'));
const routes = [];
for (const line of manifest.split('\n')) {
  const m = /^(GET|POST|PUT|PATCH|DELETE) (\S+)\s+realm=(\S+)\s+auth=(\S+)\s+domain=(\S+)(.*)$/.exec(line);
  if (!m) continue;
  const [, method, path, realm, auth, domain, rest] = m;
  routes.push({ method, path, realm, auth, domain, perm: /perm=(\S+)/.exec(rest)?.[1] ?? /derived=(\S+)/.exec(rest)?.[1] ?? null, feature: /feature=(\S+)/.exec(rest)?.[1] ?? null, unversioned: /\bunversioned\b/.test(rest), row: matrix.routes[`${method} ${path}`] ?? null });
}
const PREFER = ['OWNER', 'PLATFORM_SUPER_ADMIN', 'CUSTOMER', 'MANAGER', 'TECHNICIAN', 'FRONT_DESK', 'RECEPTION', ...PLATFORM_ROLES];
const pickAllowed = (r) => {
  if (!r.row) return null;
  const ok = matrix.principals.filter((p, i) => r.row[i] === 'A' || r.row[i] === 'U');
  if (r.path.startsWith('/tech/') && ok.includes('TECHNICIAN')) return 'TECHNICIAN';
  return PREFER.find((p) => ok.includes(p)) ?? null;
};
const pickDenied = (r) => {
  if (!r.row) return null;
  const den = matrix.principals.filter((p, i) => r.row[i] === 'D');
  return ['TECHNICIAN', 'FRONT_DESK', 'RECEPTION', 'MANAGER', 'PLATFORM_AUDITOR', 'PLATFORM_SUPPORT', 'PLATFORM_FINANCE', ...PLATFORM_ROLES].find((p) => den.includes(p)) ?? null;
};

// ── 4. boot + sign in every principal ────────────────────────────────────────────────────────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'MAINTENANCE_BREAK_GLASS']) delete env[k];
let proc = null, errs = '';
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const jar = (...lists) => { const m = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) m.set(k, c); } return [...m.values()].join('; '); };
let ipN = 0;
const nextIp = () => `10.231.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;
async function login(body, branchId) {
  const ip = nextIp();
  const l = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });
  const c1 = setCookies(l); const lt = await l.text();
  let cookie = jar(c1), sel = null;
  if (branchId) { const s = await fetch(API + '/api/v1/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ branchId }) }); sel = s.status; cookie = jar(c1, setCookies(s)); }
  return { ok: l.status === 200 && (!branchId || sel === 200), detail: `login ${l.status}${branchId ? ' select ' + sel : ''} ${l.status !== 200 ? lt.slice(0, 120) : ''}`, cookie, ip };
}
async function call(who, method, path, body, { unversioned = false } = {}) {
  // Oct 20 2026: `ms` is the SERVER's answer time for the attempt that answered — the timer restarts after a 429
  // retry-after sleep. Before, the sleep was counted as latency and the "under 2000 ms" check blamed whichever route
  // happened to hit the per-IP limiter (/super-admin/database/indexes "3085 ms" = ~1 s of work + retry sleeps).
  let t0 = performance.now(); let retries = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const headers = { accept: 'application/json', 'x-forwarded-for': who?.ip ?? nextIp() };
      if (who?.cookie) headers.cookie = who.cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (method !== 'GET') headers['idempotency-key'] = randomUUID();
      const r = await fetch(API + (unversioned ? '' : '/api/v1') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal });
      if (r.status === 429) { retries++; await sleep(Math.min(5000, 1000 * Number(r.headers.get('retry-after') || 1))); t0 = performance.now(); continue; }
      const ct = r.headers.get('content-type') ?? '';
      let text = '';
      if (/event-stream/.test(ct)) { ac.abort(); text = '[sse]'; } else text = await r.text().catch(() => '');
      return { status: r.status, text, ct, ms: Math.round(performance.now() - t0), retries };
    } catch (e) { return { status: 0, text: String(e?.message || e), ct: '', ms: Math.round(performance.now() - t0), retries }; } finally { clearTimeout(timer); }
  }
  return { status: 429, text: 'rate limited', ct: '', ms: Math.round(performance.now() - t0), retries };
}

const QUERY_BUNDLE = `from=2026-10-01&to=2026-10-13&date=2026-10-13&startDate=2026-10-01&endDate=2026-10-13&start=2026-10-01&end=2026-10-13&month=2026-10&period=month&branchId=${'BRANCH'}&limit=10&page=1&q=a&query=a&type=all&serviceId=SERVICE&technicianId=TECH&customerId=CUSTOMER&tenantId=TENANT&lat=39.95&lng=-75.0&reason=sweep&docType=terms_of_service&kind=recommendations&app=customer&channel=sms&amountCents=100`;
const SECRET_RE = /"(password_hash|passwordHash|token_hash|tokenHash|secret_hash|api_secret|client_secret|private_key|privateKey|auth_token|authToken)"\s*:\s*"[^"]+"/;
const SANE_BAD = /\[object Object\]|":\s*NaN\b|"NaN"|":\s*"undefined"|\bundefined\b(?=[^"]*"(,|}))/;

// A 4xx for a permitted principal is a FINDING unless it is one of these — each with its reason. The body patterns are
// contract answers the platform gives by design; the path list is a fixture the sweep cannot make real (with why).
const BY_DESIGN = [
  [/DISABLED|not active for this salon|community_disabled/, 'feature switched off for this salon (feature / package gate)'],
  [/SUPPORT_SESSION_REQUIRED/, 'Super Admin salon detail needs an open support session (by design)'],
  [/STEP_UP_REQUIRED/, 'step-up re-authentication required (by design)'],
  [/"code":"ENDPOINT_RETIRED"/, 'a retired route answers 410 with the routes that replaced it (by design, Nov 6 2026)'],
  [/OPERATION_NOT_READY/, 'the seeded export has not finished — 409 is the contract'],
  [/INSUFFICIENT_HISTORY/, 'forecast needs 14 days of history — 422 is the contract'],
  [/This profile is private/, 'the seeded social profile is private'],
  [/No technician profile is linked/, 'GET /tech as the OWNER (no technician profile) — the tech app root'],
  [/PAYROLL_PERIOD_NOT_READY/, 'the seeded pay period is not approved — the preparation report of an unapproved week is 409 by contract (proved on an approved week by pilot phase 10e2)'],
];
const EXPLAINED = [
  [/^\/\.well-known\/|^\/app-links\//, 'deep-link association files are served only when the app ids are configured (env) — 404 in a dev boot'],
  [/^\/media\/\{path\}/, 'no uploaded media object in the scratch store'],
  [/^\/customer-display\/(checkout|device)\//, 'device-token realm: the display sends its paired device token (proved by live-display-*.mjs), not a session'],
  [/^\/go-check-in\//, 'kiosk realm: a session/slug minted by a paired kiosk device (proved by live-phase6/verify-checkin), not a seeded row'],
  [/^\/customer\/techs\/\{publicSlug\}/, 'the seeded global tech profile is not published (public profiles only — by design)'],
  [/^\/customer\/deals/, 'no live published deal in the seed (deals are proved by live-phase5-deals.mjs)'],
  [/^\/customer\/follow-ups\/\{id\}/, 'a customer sees a follow-up only once it is sent (status filter, by design); the seeded task is a draft'],
  [/^\/customer\/(operations|messages|payments|nail-showcase\/posts)\//, 'the generic seeder cannot make the realm-specific row this lookup needs (customer export op / DM thread / skip-line payment intent / published post)'],
  [/^\/(super-admin|customer|owner|pos|tech)\/operations\/\{id\}/, 'the seeded api_operations row is not a finished export of this realm'],
  [/^\/tech\/(profile\/messages|tickets\/\{ticketId\}\/cash-payment)/, 'no DM thread / no pending cash payment for the seeded technician'],
  [/^\/(mobile-checkout|pos\/checkout)\/tickets\/\{ticketId\}\/refund-preview/, 'no captured payment left to refund in the seed (refunds are proved by live-money-chain.mjs)'],
  [/^\/tech\/tickets\/\{id\}\/(change-requests|edit-options)/, 'the seeded tech-queue ticket has no priced ticket yet ("no active service to edit" — by design)'],
  [/^\/oauth\/authorize/, 'needs a registered OAuth client (register-oauth-client.mjs) — 400 invalid_client is the contract'],
  [/^\/owner\/compensation\/reports\/platform/, 'FINDING SW-04: reachable by nobody (Super Admin cannot enter /owner; the handler refuses everyone else) — listed for removal'],
  [/^\/owner\/reports\/\{reportId\}|^\/pos\/ai-business\/metrics\/\{id\}/, 'a catalog key, not a row (unknown key → 404 is the contract)'],
  [/^\/pos\/ai-customer-profile\/duplicates/, 'no duplicate group in the seed'],
  [/^\/pos\/ai-ocr-receipt\/documents\/\{id\}\/preview-url/, 'no stored OCR file for the seeded document'],
  [/^\/super-admin\/(billing\/exports\/jobs|scheduled-reports\/runs\/\{runId\}\/download|communications\/templates\/\{id\}|memberships\/members|gift-cards\/settlement)/, 'the seeded row is not in the state / table this read expects (export not produced, template kept elsewhere)'],
  [/^\/super-admin\/platform\/branches\/\{id\}\/transfer-preflight/, 'needs ?toTenantId= (a destination salon)'],
  [/^\/super-admin\/customer-data-oversight\/sync\/merge-preview|^\/super-admin\/smart-reminders\/plan-features\/evaluate/, 'needs specific ids in the query (two global customers / a tenant)'],
];
function explain4xx(r) {
  for (const [re, why] of BY_DESIGN) if (re.test(r.body ?? '')) return why;
  for (const [re, why] of EXPLAINED) if (re.test(r.path)) return why;
  return null;
}
// w4 SW-21 (fixed): a missing / malformed query id is answered 400 INVALID_ID (or the handler's own 404) BEFORE any query,
// so an empty id the client sent no longer reaches PostgreSQL — no allow-list: every silent SQL error is a finding.
// the reader is shared with live-pilot-day.mjs (lib/pg-log-errors.mjs); the sweep's expected outcomes are unchanged
const SWEEP_EXPECTED_PG = /violates|duplicate key|append-only|is (paid|locked|review|approved)|could not serialize|deadlock|canceling statement|pg_stat_statements|current transaction is aborted/;
async function silentSqlErrors() {
  return pgLogErrors({ dbName: DB_NAME, since: RUN_STARTED, excludePids: [OWN_PID], expected: SWEEP_EXPECTED_PG });
}
const results = []; const checks = []; let failed = 0;
const check = (name, ok, detail = '') => { checks.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const note = (text) => { checks.push(`NOTE  ${text}`); };
const cleanup = async () => { try { proc?.kill('SIGTERM'); } catch { /* */ } await sleep(800); await client.end().catch(() => undefined); };

try {
  proc = spawn('node', ['dist/main.js'], { cwd: API_ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; if (errs.length > 4e6) errs = errs.slice(-2e6); });
  let up = false; for (let i = 0; i < 360 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API boots on PostgreSQL with every module', up, errs.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('no boot');

  const who = {
    OWNER: await login({ portal: 'tenant', salonCode: A.code, identifier: 'owner@luxenails.test', password: PW.owner }, A.branch),
    MANAGER: await login({ portal: 'tenant', salonCode: A.code, identifier: 'manager@luxenails.test', password: PW.staff }, A.branch),
    FRONT_DESK: await login({ portal: 'tenant', salonCode: A.code, identifier: 'frontdesk@luxenails.test', password: PW.front }, A.branch),
    RECEPTION: await login({ portal: 'tenant', salonCode: A.code, identifier: 'reception@luxenails.test', password: PW.staff }, A.branch),
    TECHNICIAN: await login({ portal: 'tenant', salonCode: A.code, identifier: 'tech@luxenails.test', password: PW.tech }, A.branch),
    CUSTOMER: await login({ portal: 'customer', identifier: 'customer@test.com', password: PW.cust }),
  };
  for (const pr of PLATFORM_ROLES) who[pr] = await login({ portal: 'super-admin', identifier: platformEmail(pr), password: PW.staff, mfaCode: '123456' });
  const bad = Object.entries(who).filter(([, w]) => !w.ok);
  check(`every principal signs in (${Object.keys(who).length})`, bad.length === 0, bad.map(([k, w]) => `${k}: ${w.detail}`).join(' | '));

  // ── the GET sweep ──
  const gets = routes.filter((r) => r.method === 'GET' && (!ONLY || ONLY.test(r.path)));
  const subst = (s) => s.replace('BRANCH', A.branch).replace('SERVICE', A.service).replace('TECH', A.tech ?? '').replace('CUSTOMER', A.customer ?? '').replace('TENANT', A.id);
  for (const r of gets) {
    const rec = { path: r.path, realm: r.realm, auth: r.auth, perm: r.perm };
    if (r.auth === 'api_key') { rec.skip = 'api_key realm (no session principal) — mount check only'; }
    let principal = r.auth === 'public' ? null : pickAllowed(r);
    if (r.auth === 'session' && !principal) rec.skip = 'no principal is allowed by the role matrix';
    // path params
    const names = [...r.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const values = {}; rec.fixtures = 'real';
    for (const n of names) {
      let v = null;
      try { v = await paramValue(r, n); } catch (e) { rec.fixtureErr = String(e.message).slice(0, 120); }
      if (v == null) { v = n === 'id' || /Id$/.test(n) ? randomUUID() : 'sweep'; rec.fixtures = 'guessed'; }
      values[n] = v;
    }
    const url = r.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(String(values[n])));
    rec.url = url; rec.principal = principal ?? (r.auth === 'public' ? 'public' : null);
    const opt = { unversioned: r.unversioned };
    const res = await call(r.auth === 'public' || r.auth === 'api_key' ? null : who[principal], 'GET', url, undefined, opt);
    rec.status = res.status; rec.ms = res.ms; rec.body = res.text.slice(0, 300);
    if (res.status === 400 && !rec.skip) {   // a required query: retry once with the common query bundle
      const res2 = await call(r.auth === 'public' ? null : who[principal], 'GET', `${url}${url.includes('?') ? '&' : '?'}${subst(QUERY_BUNDLE)}`, undefined, opt);
      rec.retried = res2.status; rec.retryBody = res2.text.slice(0, 200); if (res2.status !== 400) { rec.status = res2.status; rec.ms = res2.ms; rec.body = res2.text.slice(0, 300); res.text = res2.text; res.ct = res2.ct; }
    }
    rec.mounted = !(res.status === 404 && /Cannot GET/.test(res.text));
    if (res.status >= 200 && res.status < 300 && /json/.test(res.ct)) {
      try { JSON.parse(res.text); rec.json = true; } catch { rec.json = false; }
      const s = SECRET_RE.exec(res.text); if (s) rec.secret = s[1];
      const b = SANE_BAD.exec(res.text); if (b) rec.insane = res.text.slice(Math.max(0, b.index - 80), b.index + 40);
    }
    // the denial half: a principal whose cell is D must get 403
    const den = r.auth === 'session' && !rec.skip ? pickDenied(r) : null;
    if (den && who[den]) { const d = await call(who[den], 'GET', url, undefined, opt); rec.denied = { principal: den, status: d.status }; }
    results.push(rec);
  }

  // ── every non-GET session route is MOUNTED: called with no session it must be refused by the guards (401/403) —
  //    a Nest "Cannot POST" 404 means the controller is in the manifest but not in the app. Nothing runs: no session.
  for (const r of routes.filter((x) => x.method !== 'GET' && x.auth === 'session' && (!ONLY || ONLY.test(x.path)))) {
    const url = r.path.replace(/\{([^}]+)\}/g, () => randomUUID());
    const res = await call(null, r.method, url, {}, { unversioned: r.unversioned });
    results.push({ path: `${r.method} ${r.path}`, mountOnly: true, skip: 'mount check (no session)', status: res.status, ms: res.ms, retries: res.retries ?? 0, body: res.text.slice(0, 160), mounted: !(res.status === 404 && /Cannot (POST|PUT|PATCH|DELETE)/.test(res.text)), refused: [401, 403, 400, 428].includes(res.status) });
  }
  const unrefused = results.filter((x) => x.mountOnly && !x.refused && x.mounted);
  check('every non-GET session route refuses a call with no session (401/403) — nothing runs unauthenticated', unrefused.length === 0, unrefused.map((x) => `${x.path} ${x.status}`).join(' | '));

  // ── the safe preview POSTs ──
  const PREVIEWS = [
    ['/owner/compensation/preview', 'OWNER', {}], ['/owner/compensation/validate', 'OWNER', {}], ['/owner/compensation/compliance-preview', 'OWNER', {}],
    ['/pos/access/preview', 'OWNER', { role: 'FRONT_DESK' }], ['/pos/deals/preview', 'OWNER', {}], ['/pos/turn-queue/settings/preview', 'OWNER', {}],
    ['/pos/ai-queue-assignment/fair-turn/simulate', 'OWNER', {}], ['/pos/queue/auto-balance/preview', 'OWNER', {}],
    ['/pos/ai-marketing/audience/preview', 'OWNER', {}], ['/promotions/validate', 'OWNER', { promotionId: 'NOPE' }],
    ['/super-admin/events/replay/preview', 'PLATFORM_SUPER_ADMIN', {}], ['/super-admin/security/sessions/revoke/preview', 'PLATFORM_SUPER_ADMIN', {}],
    ['/super-admin/security/ip-blocks/preview', 'PLATFORM_SUPER_ADMIN', { target: '203.0.113.0/24' }],
    ['/super-admin/smart-reminders/templates/preview', 'PLATFORM_SUPER_ADMIN', {}], ['/super-admin/communications/templates/preview', 'PLATFORM_SUPER_ADMIN', {}],
    [`/super-admin/plans/tenants/${A.id}/subscription/preview`, 'PLATFORM_SUPER_ADMIN', {}],
    [`/pos/checkout/tickets/${await fixture('tickets')}/recalculate`, 'OWNER', {}],
  ];
  for (const [path, p, body] of PREVIEWS) {
    if (ONLY && !ONLY.test(path)) continue;
    const res = await call(who[p], 'POST', path, body);
    results.push({ path: `POST ${path}`, principal: p, status: res.status, ms: res.ms, retries: res.retries ?? 0, body: res.text.slice(0, 300), preview: true, mounted: !(res.status === 404 && /Cannot POST/.test(res.text)) });
  }

  // ── verdicts ──
  const live = results.filter((r) => !r.skip);
  const unmounted = results.filter((r) => r.mounted === false);
  const fivexx = live.filter((r) => r.status >= 500 || r.status === 0);
  for (const r of live) if (r.status >= 400 && r.status < 500) r.explained = explain4xx(r);
  const fourxx = live.filter((r) => r.status >= 400 && r.status < 500 && !r.preview && r.fixtures === 'real' && !r.explained);
  const guessed4 = live.filter((r) => r.status >= 400 && r.status < 500 && r.fixtures === 'guessed' && ![400, 404, 403, 422].includes(r.status));
  const slow = live.filter((r) => r.ms > SLOW_MS);
  const leaks = live.filter((r) => r.denied && r.denied.status >= 200 && r.denied.status < 300);
  const notForbidden = live.filter((r) => r.denied && r.denied.status !== 403 && !(r.denied.status >= 200 && r.denied.status < 300));
  const secrets = live.filter((r) => r.secret), insane = live.filter((r) => r.insane);
  const previewBad = live.filter((r) => r.preview && (r.status >= 500 || r.status === 0));
  const previewInfo = live.filter((r) => r.preview && r.status >= 400 && r.status < 500).map((r) => `${r.path} ${r.status}`);
  check(`every manifest route is mounted (${results.length - unmounted.length}/${results.length})`, unmounted.length === 0, unmounted.map((r) => r.path).join(' | '));
  check(`no 5xx (${live.length} live calls)`, fivexx.length === 0, fivexx.map((r) => `${r.path} ${r.status}`).join(' | '));
  check('a permitted principal is served on every route with a real fixture (4xx listed)', fourxx.length === 0, `${fourxx.length}: ` + fourxx.map((r) => `${r.path} ${r.principal} ${r.status}`).join(' | '));
  check('a guessed id is refused with 400/403/404/422, never another status', guessed4.length === 0, guessed4.map((r) => `${r.path} ${r.status}`).join(' | '));
  check(`every response in under ${SLOW_MS} ms`, slow.length === 0, slow.map((r) => `${r.path} ${r.ms}ms`).join(' | '));
  { const limited = live.filter((r) => (r.retries ?? 0) > 0); note(`rate-limited then retried: ${limited.length} call(s)${limited.length ? ' — ' + limited.slice(0, 5).map((r) => r.path).join(', ') : ''}`); }
  check('no role the matrix denies is served (permission keys match the role matrix)', leaks.length === 0, leaks.map((r) => `${r.path} ${r.denied.principal} ${r.denied.status}`).join(' | '));
  check('a denied role gets 403 (not another status)', notForbidden.length === 0, notForbidden.map((r) => `${r.path} ${r.denied.principal} ${r.denied.status}`).join(' | '));
  check('no secret column in any response', secrets.length === 0, secrets.map((r) => `${r.path} ${r.secret}`).join(' | '));
  check('no "[object Object]" / NaN / "undefined" in any JSON body', insane.length === 0, insane.map((r) => `${r.path}: ${r.insane}`).join(' | '));
  check('every preview POST answers without a 5xx (a 4xx here is the input validation answering a minimal body)', previewBad.length === 0, previewBad.map((r) => `${r.path} ${r.status}`).join(' | ') + (previewInfo.length ? ` 4xx: ${previewInfo.join(' | ')}` : ''));
  // ── SILENT SQL: the PostgreSQL server log for this database during the run. A handler that catches its query's error
  //    and returns [] / 0 answers 200 — the sweep sees nothing — so the database's own error log is read: a query naming a
  //    column that does not exist, a uuid compared with '', `date >= integer`… is a broken screen hiding behind a 200.
  //    (w4 found nine such defects this way.) Constraint violations / append-only refusals are expected and ignored.
  const silent = await silentSqlErrors();
  if (silent === null) checks.push('SKIP  the PostgreSQL log is not readable here — silent-SQL scan skipped');
  else check(`no silent SQL failure in the PostgreSQL log during the run (${DB_NAME})`, silent.length === 0, silent.map((x) => `x${x.n} ${x.msg} :: ${x.stmt.slice(0, 140)}`).join(' | '));
  const count = (f) => results.filter(f).length;
  console.log(`\nroute sweep: ${results.length} routes · ${count((r) => r.status >= 200 && r.status < 300)} 2xx · ${count((r) => r.status >= 400 && r.status < 500)} 4xx · ${count((r) => r.status >= 500)} 5xx · ${count((r) => r.skip)} skipped · ${count((r) => r.denied)} denial probes · ${count((r) => r.fixtures === 'guessed')} guessed fixtures · seeded ${seedLog.length} rows`);
} catch (e) {
  check('the sweep ran to the end', false, String(e?.stack || e).split('\n').slice(0, 4).join(' | '));
} finally {
  if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, JSON.stringify({ results, stderr: errs.split('\n').filter((l) => /error|exception/i.test(l)).slice(-400) }, null, 1));
  if (process.env.SWEEP_VERBOSE) for (const r of results.filter((x) => !x.skip && (x.status >= 400 || x.status === 0))) console.log(`${String(r.status).padEnd(4)} ${r.principal ?? '-'} ${r.path}  ${r.body?.slice(0, 160)}`);
  await cleanup();
  console.log(checks.join('\n'));
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
