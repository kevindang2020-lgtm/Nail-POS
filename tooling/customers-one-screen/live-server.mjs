// live-server.mjs — Customers one-screen harness (Oct 29 2026): the REAL Front Desk POS bundle (tooling/checkout-one-screen/
// build.mjs) served against the REAL Loyalty / Retention / Membership controllers, repositories and SQL, on a seeded TEST
// database (a copy of the migrated schema). Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/customers-one-screen/live-server.mjs
// Controls: GET /__tenant?name=pilot|empty · GET /__lang?l=en|vi · GET /__role?r=OWNER|FRONT_DESK · GET /__log · GET /__unhandled
// What is NOT the product here: the HTTP layer (no Nest guards / ListQuery interceptor — the controller methods are called
// directly with the session context), the shell's own routes (navigation, notifications … from the checkout harness
// fixtures), reward create / edit (the loyalty module's Kysely query builder is not available without node_modules — a
// raw-SQL adapter runs the real LoyaltyService validation), and SMS sending (a recording messenger: nothing leaves).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { sql } from 'kysely';
import { seed, PILOT, EMPTY, BRANCH, BRANCH2, OWNER_USER } from './seed.mjs';
import { LoyaltyProgramRepository } from '../../modules/customers/src/loyalty/loyalty-program.repository.ts';
import { LoyaltyProgramController } from '../../modules/customers/src/loyalty/loyalty-program.controller.ts';
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { RetentionSmsService } from '../../modules/customers/src/retention/retention-sms.service.ts';
import { RetentionController } from '../../modules/customers/src/retention/retention.controller.ts';
import { runRetentionSmsJob } from '../../modules/customers/src/retention/retention-sms.worker.ts';
import { runRetentionSnapshotJob } from '../../modules/customers/src/retention/retention-snapshots.ts';
import { MembershipListsRepository, MembershipListsController } from '../../modules/memberships/src/membership-lists.ts';
import { KyselyMembershipsRepository } from '../../modules/memberships/src/memberships.kysely.repository.ts';
import { MembershipsService } from '../../modules/memberships/src/memberships.service.ts';
import { MembershipsController } from '../../modules/memberships/src/memberships.controller.ts';
import { KyselyMembershipCommsRepository } from '../../modules/memberships/src/membership-comms.kysely.repository.ts';
import { MembershipCommsService } from '../../modules/memberships/src/membership-comms.service.ts';
import { MembershipCommsController } from '../../modules/memberships/src/membership-comms.controller.ts';
import { LoyaltyService } from '../../modules/loyalty/src/loyalty.service.ts';
import { dataset } from '../checkout-one-screen/fixtures.mjs';
import { ValidatedBody } from '../../packages/permissions/src/guards/validated-body.ts';
import { LOYALTY_ENROLL_BODY, LOYALTY_PROGRAM_ADJUST_BODY, LOYALTY_REDEEM_BODY, LOYALTY_VOID_BODY, RETENTION_SMS_PREVIEW_BODY, RETENTION_SMS_CONFIRM_BODY, RETENTION_SETTINGS_BODY, RETENTION_SNAPSHOT_BACKFILL_BODY, RETENTION_SMS_PRICING_BODY } from '../../modules/customers/src/request-schemas.ts';
/** the controllers' @Body(ValidatedBody(SCHEMA, { strict: true })) pipe, run explicitly (decorators are not wired here) */
const V = (schema, b) => ValidatedBody(schema, { strict: true }).transform(b);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tooling/checkout-one-screen/out');
const req = createRequire(import.meta.url);
const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js'));
const perms = (role) => [...(rbac.ROLE_PERMISSIONS?.[role] ?? [])];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const pg = await PGlite.create({ loadDataDir: true });   // FST_PG_TEMPLATE: a copy of the migrated schema
const db = kyselyFor(pg);
const t0 = Date.now(); const seeded = await seed(pg, db);
console.log(`seeded in ${Date.now() - t0} ms`, seeded, 'db', pg.dbname);

const audited = [];
const auditor = { record: async (c, i) => { audited.push({ at: new Date().toISOString(), tenantId: c.tenantId, userId: c.userId, ...i }); } };
const sent = [];
const messenger = { sendSms: async (m) => { sent.push({ tenantId: m.tenantId, to: m.to, body: m.body, purpose: m.purpose }); return { sent: true, status: 'sent', providerId: 'SMlive' + String(sent.length).padStart(26, '0'), simulated: true }; } };
const loyaltyRepo = new LoyaltyProgramRepository(db, auditor);
const retentionRepo = new RetentionRepository(db);
const retentionSms = new RetentionSmsService(db, retentionRepo, auditor);
const C = {
  loyalty: new LoyaltyProgramController(loyaltyRepo),
  retention: new RetentionController(retentionRepo, retentionSms),
  lists: new MembershipListsController(new MembershipListsRepository(db)),
  memberships: new MembershipsController(new MembershipsService(new KyselyMembershipsRepository(db))),
  comms: new MembershipCommsController(new MembershipCommsService(new KyselyMembershipCommsRepository(db), null)),
};
// reward create / edit: the real LoyaltyService (validation + permission) over a raw-SQL adapter of the module's repository
const rewardCols = sql`id, title, description, points_cost, active, reward_type, value_cents, percent, valid_days`;
const rewardRow = (r) => ({ id: String(r.id), title: r.title, description: r.description ?? '', pointsCost: Number(r.points_cost), active: !!r.active, rewardType: r.reward_type, valueCents: Number(r.value_cents), percent: Number(r.percent), validDays: r.valid_days == null ? null : Number(r.valid_days) });
const loyaltyService = new LoyaltyService({
  async createReward(ctx, r) { return rewardRow((await sql`insert into loyalty_rewards (tenant_id, title, description, points_cost, active, reward_type, value_cents, percent, valid_days) values (${ctx.tenantId}, ${r.title}, ${r.description ?? ''}, ${r.pointsCost}, ${r.active}, ${r.rewardType ?? 'amount_off'}, ${r.valueCents ?? 0}, ${r.percent ?? 0}, ${r.validDays ?? null}) returning ${rewardCols}`.execute(db)).rows[0]); },
  async updateReward(ctx, id, r) { const x = (await sql`update loyalty_rewards set title = ${r.title}, description = ${r.description ?? ''}, points_cost = ${r.pointsCost}, active = ${r.active}, reward_type = ${r.rewardType ?? 'amount_off'}, value_cents = ${r.valueCents ?? 0}, percent = ${r.percent ?? 0}, valid_days = ${r.validDays ?? null}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${id} returning ${rewardCols}`.execute(db)).rows[0]; return x ? rewardRow(x) : null; },
  async getReward(ctx, id) { const x = (await sql`select ${rewardCols} from loyalty_rewards where tenant_id = ${ctx.tenantId} and id = ${id}`.execute(db)).rows[0]; return x ? rewardRow(x) : null; },
});

let tenant = 'pilot', lang = 'en', role = 'OWNER';
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH2 : BRANCH, userId: OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: 'Linh Owner', email: null, subscriptionStatus: 'active' }; };
const unhandled = new Map(); const log = [];

/** the Nest exception filter, reduced: HttpException → its status + { error: { code, message, details } } */
async function call(fn) {
  try { return { status: 200, body: (await fn()) ?? null }; }
  catch (e) {
    const st = typeof e?.getStatus === 'function' ? e.getStatus() : e?.status ?? 500; const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const code = (r && typeof r === 'object' && r.code) || e?.apiCode || (st === 403 ? 'PERMISSION_DENIED' : st === 401 ? 'AUTH_REQUIRED' : st === 404 ? 'RESOURCE_NOT_FOUND' : 'INTERNAL_ERROR');
    const message = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message) || 'error';
    if (st >= 500) console.error('500', e);
    return { status: st, body: { error: { code, message, details: (r && typeof r === 'object' && r.details) || {} }, code, message } };
  }
}

async function route(method, path, query, body) {
  const r = { ctx: session() }; const m = (re) => path.match(re);
  // Loyalty & Rewards
  if (method === 'GET' && path === '/pos/loyalty/overview') return call(() => C.loyalty.overview(r));
  if (method === 'GET' && path === '/pos/loyalty/rewards') return call(() => C.loyalty.rewards(r, query));
  if (method === 'GET' && path === '/pos/loyalty/members') return call(() => C.loyalty.members(r, query));
  if (method === 'GET' && path === '/pos/loyalty/redemptions') return call(() => C.loyalty.redemptions(r, query));
  if (method === 'GET' && m(/^\/pos\/loyalty\/redemptions\/([^/]+)$/)) return call(() => C.loyalty.redemption(r, m(/^\/pos\/loyalty\/redemptions\/([^/]+)$/)[1]));
  if (method === 'GET' && path === '/pos/loyalty/ledger') return call(() => C.loyalty.ledger(r, query));
  if (method === 'POST' && path === '/pos/loyalty/enroll') return call(() => C.loyalty.enroll(r, V(LOYALTY_ENROLL_BODY, body)));
  if (method === 'POST' && path === '/pos/loyalty/adjust') return call(() => C.loyalty.adjust(r, V(LOYALTY_PROGRAM_ADJUST_BODY, body)));
  if (method === 'POST' && path === '/pos/loyalty/redeem') return call(() => C.loyalty.redeem(r, V(LOYALTY_REDEEM_BODY, body)));
  if (method === 'POST' && m(/^\/pos\/loyalty\/redemptions\/([^/]+)\/void$/)) return call(() => C.loyalty.void(r, m(/^\/pos\/loyalty\/redemptions\/([^/]+)\/void$/)[1], V(LOYALTY_VOID_BODY, body)));
  if (method === 'POST' && path === '/pos/loyalty/rewards') return call(() => loyaltyService.createReward(r.ctx, body));
  if (method === 'PATCH' && m(/^\/pos\/loyalty\/rewards\/([^/]+)$/)) return call(() => loyaltyService.updateReward(r.ctx, m(/^\/pos\/loyalty\/rewards\/([^/]+)$/)[1], body));
  // Customer Retention
  if (path.startsWith('/pos/retention/')) {
    const id2 = m(/^\/pos\/retention\/(?:customers|sms\/campaigns)\/([^/]+)$/)?.[1];
    if (method === 'GET' && path === '/pos/retention/summary') return call(() => C.retention.summary(r, query));
    if (method === 'GET' && path === '/pos/retention/recovery') return call(() => C.retention.recovery(r, query));
    if (method === 'GET' && path === '/pos/retention/settings') return call(() => C.retention.settings(r));
    if (method === 'PUT' && path === '/pos/retention/settings') return call(() => C.retention.saveSettings(r, V(RETENTION_SETTINGS_BODY, body)));
    if (method === 'GET' && path === '/pos/retention/customers/export') return call(() => C.retention.exportCsv(r, query));
    if (method === 'GET' && path === '/pos/retention/customers') return call(() => C.retention.customers(r, query));
    if (method === 'GET' && path.startsWith('/pos/retention/customers/')) return call(() => C.retention.customer(r, id2));
    if (method === 'GET' && path === '/pos/retention/sms/readiness') return call(() => C.retention.readiness(r));
    if (method === 'POST' && path === '/pos/retention/sms/preview') return call(() => C.retention.preview(r, V(RETENTION_SMS_PREVIEW_BODY, body)));
    if (method === 'POST' && path === '/pos/retention/sms/campaigns') {
      const out = await call(() => C.retention.confirm(r, V(RETENTION_SMS_CONFIRM_BODY, body)));
      // the job runner, inline (the durable queue's worker in production): every queued text goes through the recording messenger
      if (out.status === 200 && out.body?.campaignId) setTimeout(() => drain(out.body.campaignId), 1500);
      return out;
    }
    // Four-Module Completion Guide CR-01 / CR-03
    if (method === 'GET' && path === '/pos/retention/snapshots/day') return call(() => C.retention.snapshotDay(r, query));
    if (method === 'GET' && path === '/pos/retention/snapshots/members') return call(() => C.retention.snapshotMembers(r, query));
    if (method === 'GET' && path === '/pos/retention/snapshots/compare') return call(() => C.retention.snapshotCompare(r, query));
    if (method === 'GET' && path === '/pos/retention/snapshots/runs') return call(() => C.retention.snapshotRuns(r, query));
    if (method === 'POST' && path === '/pos/retention/snapshots/backfill') {
      const out = await call(() => C.retention.snapshotBackfill(r, V(RETENTION_SNAPSHOT_BACKFILL_BODY, body)));
      // the job runner, inline (the durable queue's worker in production)
      if (out.status === 200) setTimeout(() => { drainSnapshots().catch((e) => console.error('snapshot drain', e)); }, 800);
      return out;
    }
    if (method === 'GET' && path === '/pos/retention/sms/pricing') return call(() => C.retention.smsPricing(r));
    if (method === 'PUT' && path === '/pos/retention/sms/pricing') return call(() => C.retention.setSmsPricing(r, V(RETENTION_SMS_PRICING_BODY, body)));
    if (method === 'GET' && path === '/pos/retention/sms/campaigns') return call(() => C.retention.campaigns(r, query));
    if (method === 'GET' && path.startsWith('/pos/retention/sms/campaigns/')) return call(() => C.retention.campaign(r, id2, query));
  }
  // Membership Overview
  if (method === 'GET' && path === '/pos/memberships/overview') return call(() => C.memberships.overview(r, query));
  if (method === 'GET' && path === '/pos/memberships/members') return call(() => C.lists.members(r, query));
  if (method === 'GET' && path === '/pos/memberships/activity') return call(() => C.lists.activity(r, query));
  if (method === 'GET' && path === '/pos/memberships/payments') return call(() => C.lists.payments(r, query));
  if (method === 'GET' && path === '/pos/memberships/redemptions') return call(() => C.lists.redemptions(r, query));
  if (method === 'GET' && path === '/pos/memberships/plans-list') return call(() => C.lists.planList(r, query));
  { const md = path.match(/^\/pos\/memberships\/members\/([0-9a-f-]{36}|[^/]+)\/detail$/); if (method === 'GET' && md) return call(() => C.lists.memberDetail(r, decodeURIComponent(md[1]))); }
  if (method === 'GET' && path === '/pos/memberships/plan-performance') return call(() => C.lists.planPerformance(r));
  if (method === 'GET' && path === '/pos/memberships/discounts') return call(() => C.lists.discounts(r));
  if (method === 'GET' && path === '/pos/memberships/comms/reminders/preview') return call(() => C.comms.previewReminders(r, query));
  if (method === 'POST' && path === '/pos/memberships/comms/reminders/run') return call(() => C.comms.runReminders(r, body));
  if (method === 'GET' && path === '/pos/memberships/export/members') return call(() => C.memberships.exportMembers(r, query));
  if (method === 'GET' && path === '/pos/memberships/export/payments') return call(() => C.memberships.exportPayments(r, query));
  if (method === 'GET' && path === '/pos/memberships/export/redemptions') return call(() => C.memberships.exportRedemptions(r, query));
  // CR-04: the booking screen loads the preselected customer (GET /pos/customers/:id — this salon's record only; the same
  // fields the real POSCustomerDetail carries for the booking form)
  { const mc = path.match(/^\/pos\/customers\/([0-9a-f-]{36})$/); if (method === 'GET' && mc) {
    const x = (await sql`select id, first_name, last_name, full_name, phone_display, normalized_phone, status, avatar_url from customers where tenant_id = ${r.ctx.tenantId} and id = ${mc[1]}`.execute(db)).rows[0];
    if (!x) return { status: 404, body: { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found', details: {} }, code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } };
    return { status: 200, body: { customerId: String(x.id), tenantId: r.ctx.tenantId, firstName: x.first_name, lastName: x.last_name, displayName: x.full_name, phone: x.phone_display ?? x.normalized_phone ?? undefined,
      status: x.status === 'archived' ? 'archived' : 'active', avatarUrl: x.avatar_url ?? undefined, isVip: false, visitCount: 0, totalSpendCents: 0, averageSpendCents: 0, loyaltyPoints: 0, tags: [], marketingOptIn: false, smsOptIn: false, emailOptIn: false } };
  } }
  // CR-04 stand-ins: the New Appointment screen's READ calls (the booking module itself is not mounted here — its catalog
  // comes from the seeded services; no technicians / open times / drafts). Nothing here writes; a booking submit is not served.
  if (method === 'GET' && path === '/pos/booking/state') {
    const sv = (await sql`select id, name, price_cents, duration_minutes from services where tenant_id = ${r.ctx.tenantId} order by name`.execute(db)).rows;
    return { status: 200, body: { filters: { services: sv.map((x) => ({ serviceId: String(x.id), name: x.name, category: 'Nails', priceCents: Number(x.price_cents), durationMinutes: Number(x.duration_minutes) })), serviceCategories: ['Nails'] } } };
  }
  if (method === 'GET' && path === '/pos/booking/availability') return { status: 200, body: [] };
  if (method === 'GET' && path === '/pos/booking/drafts') return { status: 200, body: { drafts: [] } };
  if (method === 'GET' && path === '/pos/booking/technicians') return { status: 200, body: { technicians: [], page: 1, pageSize: Number(query.pageSize || 8), totalItems: 0, totalPages: 1 } };
  // the customer search the Enroll dialog uses (same response shape as GET /pos/customers/search)
  if (method === 'GET' && path === '/pos/customers/search') {
    const t = String(query.search ?? query.q ?? '').trim(); const s = r.ctx;
    const rows = (await sql`select id, full_name, phone_display from customers where tenant_id = ${s.tenantId} and status <> 'archived' and (full_name ilike ${'%' + t + '%'} or coalesce(normalized_phone, '') like ${'%' + t.replace(/\D/g, '') + '%'}) order by full_name, id limit 8`.execute(db)).rows;
    return { status: 200, body: { items: rows.map((x) => ({ customerId: String(x.id), fullName: x.full_name, phone: x.phone_display ?? '' })), pagination: { page: 1, pageSize: 8, totalItems: rows.length, totalPages: 1 } } };
  }
  return undefined;
}
async function drainSnapshots() {
  const jobs = (await sql`select id, payload from jobs where job_type = 'retention.snapshot.day' and status = 'queued' order by run_after`.execute(db)).rows;
  for (const j of jobs) { await runRetentionSnapshotJob(db, j.payload); await sql`update jobs set status = 'succeeded' where id = ${j.id}`.execute(db); }
}
async function drain(campaignId) {
  const jobs = (await sql`select payload from jobs where job_type = 'retention.sms.send' and status = 'queued' and payload->>'campaignId' = ${campaignId}`.execute(db)).rows;
  for (const j of jobs) { await runRetentionSmsJob(db, messenger, j.payload); await sql`update jobs set status = 'succeeded' where job_type = 'retention.sms.send' and payload->>'recipientId' = ${j.payload.recipientId}`.execute(db); }
}

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json') => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__tenant') { tenant = u.searchParams.get('name') === 'empty' ? 'empty' : 'pilot'; return send(200, { tenant }); }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l') === 'vi' ? 'vi' : 'en'; return send(200, { lang }); }
  if (u.pathname === '/__role') { role = u.searchParams.get('r') || 'OWNER'; return send(200, { role, perms: perms(role).length }); }
  if (u.pathname === '/__log') return send(200, log.slice(-400));
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__sent') return send(200, sent);
  if (u.pathname === '/__audit') return send(200, audited);
  if (u.pathname === '/__sql') { const k = u.searchParams.get('k'); const Q = { profiles: `select count(*)::int n from customer_loyalty_profiles where tenant_id = '${PILOT}'`, ledger: `select count(*)::int n from loyalty_ledger where tenant_id = '${PILOT}'`, jobs: `select status, count(*)::int n from jobs where job_type = 'retention.sms.send' group by status`,
    settings_audit: `select count(*)::int n from audit_events where tenant_id = '${PILOT}' and action = 'retention.settings.updated'`, export_audit: `select action from audit_events where tenant_id = '${PILOT}' and action like 'retention.export.%' order by occurred_at`,
    snapshot_runs: `select status, coverage, count(*)::int n from customer_retention_snapshot_runs where tenant_id = '${PILOT}' group by 1, 2 order by 1, 2`,
    snapshot_jobs: `select status, count(*)::int n from jobs where job_type = 'retention.snapshot.day' group by status`,
    backfill_audit: `select count(*)::int n from audit_events where tenant_id = '${PILOT}' and action = 'retention.snapshot.backfill.requested'`,
    pricing_audit: `select count(*)::int n from audit_events where tenant_id = '${PILOT}' and action = 'retention.sms_pricing.set'`,
    appointments: `select count(*)::int n from pos_tech_appointments where tenant_id = '${PILOT}'` };
    const a = u.searchParams.get('a') ?? ''; if (k === 'phone' && /^[0-9a-f-]{36}$/.test(a)) return send(200, (await pg.query(`select normalized_phone as p from customers where tenant_id = $1 and id = $2`, [PILOT, a])).rows);
    return send(200, (await pg.query(Q[k] ?? 'select 1')).rows); }
  const file = join(OUT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!u.pathname.startsWith('/api/') && existsSync(file) && !file.endsWith('/')) return send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
  if (!u.pathname.startsWith('/api/')) return send(200, readFileSync(join(OUT, 'index.html')), 'text/html');
  let raw = ''; for await (const c of rq) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const path = u.pathname.replace(/^\/api\/v1/, ''); const query = Object.fromEntries(u.searchParams.entries());
  log.push(`${rq.method} ${path}${u.search}${rq.method !== 'GET' && raw ? ' ' + raw.slice(0, 300) : ''}`);
  if (path === '/auth/me') return send(200, principal());
  if (path === '/pos/me/locale') return send(200, { language: lang, timeZone: 'America/New_York' });
  if (path === '/realtime/stream') { rs.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); rs.write(': connected\n\nevent: ready\ndata: {}\n\n'); const t = setInterval(() => rs.write(': ping\n\n'), 15000); rq.on('close', () => clearInterval(t)); return; }
  const hit = await route(rq.method, path, query, body);
  if (hit) return send(hit.status, hit.body, typeof hit.body === 'string' ? 'text/csv; charset=utf-8' : 'application/json');
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const key = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(key, (unhandled.get(key) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4318), '127.0.0.1', () => console.log('customers harness on', process.env.PORT || 4318));
