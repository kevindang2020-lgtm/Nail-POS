// live-server.mjs — Stock Alerts + Transactions + Payments & Money one-screen harness (Oct 29 2026): the REAL Front Desk POS
// bundle (tooling/checkout-one-screen/build.mjs) served against the REAL controllers + repositories + SQL — StockAlertsController
// (InventoryService's product-usage writer + StockAlertsRepository), TransactionsScreenController, MoneyOverviewScreenController
// and the tenants sidebar badge (TenantNavigationService.badges, the ONE alert scope) — on a seeded TEST database.
// Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/stock-money-one-screen/live-server.mjs
// Controls: /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK|TECHNICIAN · /__fail?on=1 ·
//           /__log · /__unhandled · /__sql?k=…
// What is NOT the product here: the HTTP layer (Nest guards / ListQuery / the Idempotency interceptor / body schemas — the
// controller methods are called directly with the session context; the writer's own idempotency key check IS the product's).
// A receipt resend is answered SIMULATED (no SMS / email leaves this process). No processor is called; no money moves.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, PILOT, EMPTY, BRANCH, BRANCH_E, OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER } from './seed.mjs';
import { InventoryService } from '../../modules/inventory/src/inventory.service.ts';
import { StockAlertsRepository } from '../../modules/inventory/src/stock-alerts.repository.ts';
import { StockAlertsController } from '../../modules/inventory/src/stock-alerts.controller.ts';
import { TransactionsScreenRepository } from '../../modules/payments/src/finance-screens/transactions-screen.repository.ts';
import { TransactionsScreenController } from '../../modules/payments/src/finance-screens/transactions-screen.controller.ts';
import { MoneyOverviewScreenRepository } from '../../modules/payments/src/finance-screens/money-overview-screen.repository.ts';
import { MoneyOverviewScreenController } from '../../modules/payments/src/finance-screens/money-overview-screen.controller.ts';
import { TenantNavigationService } from '../../modules/tenants/src/tenant-navigation/tenant-navigation.service.ts';
import { dataset } from '../checkout-one-screen/fixtures.mjs';
import { hasPermission } from '../../packages/permissions/src/security-core.ts';
import { setCodedErrorSink } from '../../packages/api-contracts/src/coded-error.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tooling/checkout-one-screen/out');
const req = createRequire(import.meta.url);
const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js'));
const perms = (role) => [...(rbac.ROLE_PERMISSIONS?.[role] ?? [])];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const pg = await PGlite.create({ loadDataDir: true });
const db = kyselyFor(pg);
const inv = new InventoryService(db);
const t0 = Date.now(); const seeded = await seed(pg, inv);
console.log(`seeded in ${Date.now() - t0} ms`, JSON.stringify(seeded).slice(0, 300), 'db', pg.dbname);

const audited = [];
const auditor = { record: async (c, i) => { audited.push({ at: new Date().toISOString(), tenantId: c.tenantId, userId: c.userId, ...i }); } };
const C = {
  sa: new StockAlertsController(inv, new StockAlertsRepository(db)),
  tx: new TransactionsScreenController(new TransactionsScreenRepository(db, auditor)),
  mo: new MoneyOverviewScreenController(new MoneyOverviewScreenRepository(db)),
};
const nav = new TenantNavigationService(db);

let tenant = 'pilot', lang = 'en', role = 'OWNER', fail = false;
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER, TECHNICIAN: TECH_USER };
const NAMES = { OWNER: 'Pat Owner', MANAGER: 'Mai Manager', FRONT_DESK: 'Vy Front Desk', TECHNICIAN: 'Anna Lee' };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH_E : BRANCH, userId: USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: NAMES[role] ?? 'Pat Owner', email: null, subscriptionStatus: 'active' }; };
const has = (p) => hasPermission(session(), p);
const unhandled = new Map(); const log = [];
let coded = []; setCodedErrorSink((e) => coded.push(e));
async function call(fn, need) {
  if (need && !has(need)) return denied();
  coded = [];
  try { const body = await fn(); return { status: 200, body: body ?? null }; }
  catch (e) {
    const st = typeof e?.getStatus === 'function' ? e.getStatus() : e?.status ?? 500; const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const message0 = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message);
    const code = (r && typeof r === 'object' && r.code) || e?.apiCode || coded.find((c) => c.message === message0)?.apiCode || e?.code || (st === 403 ? 'PERMISSION_DENIED' : st === 404 ? 'RESOURCE_NOT_FOUND' : st === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR');
    if (st >= 500) console.error('500', e);
    return { status: st, body: { error: { code, message: message0 || 'error', details: (r && typeof r === 'object' && r.details) || {} }, code, message: message0 } };
  }
}
const denied = () => ({ status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' }, code: 'PERMISSION_DENIED' } });
const ok = (b) => ({ status: 200, body: b });
const q = (s, p = []) => pg.query(s, p);

const SCREEN = /^\/(tenant\/inventory\/stock-alerts|pos\/payments\/(transactions|money))\//;
async function route(method, path, query, body, headers) {
  const r = { ctx: session() }; const Q = query; const m = (re) => path.match(re); let x;
  if (fail && SCREEN.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  if (method === 'GET' && path === '/tenant/navigation/badges') return call(() => nav.badges({ tenantId: session().tenantId, branchId: session().branchId, role, permissions: session().permissions }));
  // Stock Alerts — the controller's own permission per route (RequirePermission) is checked here as the guard would
  const SA = '/tenant/inventory/stock-alerts';
  if (method === 'GET' && path === SA + '/summary') return call(() => C.sa.summary(r), 'inventory.view');
  if (method === 'GET' && path === SA + '/active') return call(() => C.sa.active(r, Q), 'inventory.view');
  if (method === 'GET' && path === SA + '/history') return call(() => C.sa.history(r, Q), 'inventory.view');
  if (method === 'GET' && path === SA + '/usage') return call(() => C.sa.usage(r, Q), 'inventory.view');
  if (method === 'GET' && path === SA + '/technicians') return call(() => C.sa.technicians(r, Q), 'inventory.view');
  if (method === 'GET' && path === SA + '/pickers') return call(() => C.sa.pickers(r, Q.search), 'inventory.view');
  if (method === 'GET' && path === SA + '/export') return call(() => C.sa.exportCsv(r, Q), 'inventory.reports.view');
  if (method === 'GET' && (x = m(/^\/tenant\/inventory\/stock-alerts\/usage\/products\/([^/]+)$/))) return call(() => C.sa.ledger(r, x[1], Q), 'inventory.view');
  if (method === 'GET' && (x = m(/^\/tenant\/inventory\/stock-alerts\/events\/([^/]+)$/))) return call(() => C.sa.event(r, x[1]), 'inventory.view');
  if (method === 'POST' && (x = m(/^\/tenant\/inventory\/stock-alerts\/active\/([^/]+)\/acknowledge$/))) return call(() => C.sa.acknowledge(r, x[1], body), 'inventory.view');
  if (method === 'POST' && path === SA + '/usage') { log.push(`REAL recordProductUsage key=${headers['idempotency-key']}`); return call(() => C.sa.record(r, headers['idempotency-key'], body), 'inventory.product_usage.submit'); }
  if (method === 'POST' && (x = m(/^\/tenant\/inventory\/stock-alerts\/usage\/([^/]+)\/adjustments$/))) { log.push(`REAL adjustProductUsage ${x[1]}`); return call(() => C.sa.adjust(r, x[1], headers['idempotency-key'], body), 'inventory.stock.adjust'); }
  // Transactions + Payments & Money (the controllers check their own permission first)
  const TX = '/pos/payments/transactions';
  if (method === 'GET' && path === TX + '/list') return call(() => C.tx.list(r, Q));
  if (method === 'GET' && path === TX + '/summary') return call(() => C.tx.summary(r, Q));
  if (method === 'GET' && path === TX + '/technicians') return call(() => C.tx.technicians(r));
  if (method === 'GET' && path === TX + '/export') return call(() => C.tx.exportCsv(r, Q));
  if (method === 'GET' && (x = m(/^\/pos\/payments\/transactions\/([^/]+)$/))) return call(() => C.tx.detail(r, x[1]));
  const MO = '/pos/payments/money';
  if (method === 'GET' && path === MO + '/overview') return call(() => C.mo.overview(r, Q));
  if (method === 'GET' && path === MO + '/services') return call(() => C.mo.services(r, Q));
  if (method === 'GET' && path === MO + '/payouts') return call(() => C.mo.payouts(r, Q));
  if (method === 'GET' && path === MO + '/search') return call(() => C.mo.search(r, Q));
  if (method === 'POST' && (x = m(/^\/pos\/checkout\/tickets\/([^/]+)\/receipt\/send-all$/))) { log.push(`SIMULATED receipt ${x[1]} ${JSON.stringify(body)} — nothing sent`); return has('pos.receipts.send') ? ok({ sent: body?.channels ?? [], simulated: true }) : denied(); }
  return undefined;
}

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json', extra = {}) => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__tenant') { tenant = u.searchParams.get('name') === 'empty' ? 'empty' : 'pilot'; return send(200, { tenant }); }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l') === 'vi' ? 'vi' : 'en'; return send(200, { lang }); }
  if (u.pathname === '/__role') { role = u.searchParams.get('r') || 'OWNER'; return send(200, { role, perms: perms(role).length }); }
  if (u.pathname === '/__fail') { fail = u.searchParams.get('on') === '1'; return send(200, { fail }); }
  if (u.pathname === '/__log') return send(200, log.slice(-400));
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__audit') return send(200, audited);
  if (u.pathname === '/__seeded') return send(200, seeded);
  if (u.pathname === '/__sql') {
    const k = u.searchParams.get('k'), a = u.searchParams.get('a') ?? '';
    const QQ = {
      events: [`select id, technician_id, quantity_hundredths, status, idempotency_key from product_usage_events where tenant_id = $1 order by created_at desc limit 50`, [PILOT]],
      moves: [`select movement_type, related_type, related_id, quantity_change from inventory_stock_movements where tenant_id = $1 and related_type in ('product_usage_event','product_usage_adjustment') order by created_at desc limit 50`, [PILOT]],
      units: [`select status, estimated_remaining_percent from inventory_units where tenant_id = $1 and product_id = $2::uuid order by created_at`, [PILOT, a]],
      alerts: [`select product_id, status, acknowledged_at is not null as acked, resolved_at is not null as resolved from inventory_alerts where tenant_id = $1 order by created_at desc`, [PILOT]],
      audit: [`select action_type, entity_id from audit_logs where tenant_id = $1 order by created_at desc limit 20`, [PILOT]],
    };
    const [sq, sp] = QQ[k] ?? ['select 1', []];
    return send(200, (await q(sq, sp)).rows);
  }
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
  let hit;
  try { hit = await route(rq.method, path, query, body, rq.headers); } catch (e) { console.error('route', e); hit = { status: e?.getStatus?.() ?? 400, body: { error: { code: e?.getResponse?.()?.code ?? 'VALIDATION_FAILED', message: e?.message ?? 'error' } } }; }
  if (hit) {
    if (typeof hit.body === 'string') return send(hit.status, hit.body, 'text/csv; charset=utf-8');
    return send(hit.status, hit.body);
  }
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const k2 = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(k2, (unhandled.get(k2) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4389), '127.0.0.1', () => console.log('stock alerts + transactions + payments & money harness on', process.env.PORT || 4389));
