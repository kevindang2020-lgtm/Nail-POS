// live-server.mjs — Inventory · Products · Suppliers (+ Membership · Discounts) one-screen harness (Oct 29 2026): the REAL Front
// Desk POS bundle (tooling/checkout-one-screen/build.mjs) served against the REAL controllers + repositories + SQL on a seeded
// TEST database: InventoryController (every existing inventory route — products, stock, bottles, vendors, purchase orders,
// transfers, counts, recipes), InventoryScreenController, SuppliersScreenController, StockAlertsController and the tenants
// sidebar badge. Routes are read from each controller's own decorators (method, path, RequirePermission) so the harness can't
// drift from the code. Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/catalog-one-screen/live-server.mjs
// Controls: /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK|TECHNICIAN · /__fail?on=1 · /__log ·
//           /__unhandled · /__sql?k=…
// Not the product here: the HTTP layer (Nest guards / ListQuery / body schemas) — controller methods are called directly with the
// session context; the route's RequirePermission is checked exactly as the guard would.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, PILOT, EMPTY, BRANCH, BRANCH_E, OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER } from './seed.mjs';
import { InventoryService } from '../../modules/inventory/src/inventory.service.ts';
import { InventoryController } from '../../modules/inventory/src/inventory.controller.ts';
import { StockAlertsRepository } from '../../modules/inventory/src/stock-alerts.repository.ts';
import { StockAlertsController } from '../../modules/inventory/src/stock-alerts.controller.ts';
import { InventoryScreenRepository } from '../../modules/inventory/src/inventory-screen.repository.ts';
import { InventoryScreenController } from '../../modules/inventory/src/inventory-screen.controller.ts';
import { SuppliersScreenRepository } from '../../modules/inventory/src/suppliers-screen.repository.ts';
import { SuppliersScreenController } from '../../modules/inventory/src/suppliers-screen.controller.ts';
import { TenantNavigationService } from '../../modules/tenants/src/tenant-navigation/tenant-navigation.service.ts';
import { dataset } from '../checkout-one-screen/fixtures.mjs';
import { hasPermission } from '../../packages/permissions/src/security-core.ts';
import { setCodedErrorSink } from '../../packages/api-contracts/src/coded-error.ts';
import { extra, extraSeed } from './extra.mjs';
import { inboxControl } from './inbox-extra.mjs';
import { rnExtra } from './rn-extra.mjs';
import { segExtra } from './seg-extra.mjs';
import { cpExtra } from './cp-extra.mjs';
import { doExtra } from './do-extra.mjs';
import { promoExtra } from './promo-extra.mjs';
import { ccExtra } from './cc-extra.mjs';
import { mgExtra } from './mg-extra.mjs';
import { mtExtra } from './mt-extra.mjs';
import { cnExtra } from './cn-extra.mjs';
import { pmExtra } from './pm-extra.mjs';
import { bvExtra } from './bv-extra.mjs';
import { eodExtra } from './eod-extra.mjs';
import { fuqExtra } from './fuq-extra.mjs';
import { wbExtra } from './wb-extra.mjs';
import { bdExtra } from './bd-extra.mjs';
import { rfExtra } from './rf-extra.mjs';
import { rvExtra } from './rv-extra.mjs';
import { bsExtra } from './bs-extra.mjs';
import { rcpExtra } from './rcp-extra.mjs';
import { fdExtra } from './fd-extra.mjs';
import { rccExtra } from './rcc-extra.mjs';
import { aicalExtra } from './aical-extra.mjs';
import { fuExtra } from './fu-extra.mjs';
import { aicExtra } from './aic-extra.mjs';
import { rmdExtra } from './rmd-extra.mjs';
import { emExtra } from './em-extra.mjs';
import { screensToRefetch } from '../../packages/realtime-contracts/src/realtime-core.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
// HARNESS_APP=admin serves the Super Admin bundle (APP=admin-web build.mjs → out-admin) as a SUPER_ADMIN session
const ADMIN = process.env.HARNESS_APP === 'admin';
// HARNESS_APP=customer | owner serves that app's bundle (APP=customer-web / owner-web build.mjs) as a CUSTOMER / OWNER session
const APPMODE = process.env.HARNESS_APP ?? 'pos';
const OUT = join(ROOT, ADMIN ? 'tooling/checkout-one-screen/out-admin' : APPMODE === 'customer' ? 'tooling/checkout-one-screen/out-customer' : APPMODE === 'owner' ? 'tooling/checkout-one-screen/out-owner' : 'tooling/checkout-one-screen/out');
const req = createRequire(import.meta.url);
const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js'));
const perms = (role) => [...(rbac.ROLE_PERMISSIONS?.[role] ?? [])];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const pg = await PGlite.create({ loadDataDir: true });
const db = kyselyFor(pg);
const inv = new InventoryService(db);
const t0 = Date.now(); const seeded = { ...(await seed(pg, inv)), ...(await extraSeed(pg, db)) };
console.log(`seeded in ${Date.now() - t0} ms`, JSON.stringify(seeded).slice(0, 300));

/** The routes of a controller, read from its source: [{ verb, re, keys, perm, method, params: ['req'|'param:x'|'query'|'query:x'|'body'|'header:x'] }]. */
function routesOf(file, base, instance, from = null) {
  let src = readFileSync(join(ROOT, file), 'utf8').replace(/\r/g, '');
  if (from) src = src.slice(src.indexOf(from));   // a file holding two controllers: parse from this marker on
  // either decorator order: `@RequirePermission('x') @Post('y')` (older controllers) is read as `@Post('y') @RequirePermission('x')`
  src = src.replace(/@RequirePermission\('([^']+)'\)\s+@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/g, "@$2('$3') @RequirePermission('$1')");
  const out = [];
  const rx = /@(Get|Post|Patch|Put|Delete)\('([^']*)'\)[^\n]*?@RequirePermission\('([^']+)'\)[^\n]*?\n?\s*(?:@(?:Header|ListQuery|AsyncExport)\([^\n]*\)\s*)*(?:async\s+)?(?<![@\w.])(\w+)\(/g;   // `async name(` too (Oct 31 2026)
  let m;
  while ((m = rx.exec(src))) {
    const [, verb, sub, perm, method] = m;
    // the parameter list: balanced parentheses from the method's "("
    let i = rx.lastIndex, depth = 1; const start = i;
    while (i < src.length && depth > 0) { const ch = src[i++]; if (ch === '(') depth++; else if (ch === ')') depth--; }
    const plist = src.slice(start, i - 1);
    const params = [];
    const parts = []; let d = 0, cur = '';
    for (const ch of plist) { if (ch === '(' || ch === '{') d++; if (ch === ')' || ch === '}') d--; if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    for (const p of parts) {
      const t = p.trim(); if (!t) continue;
      if (t.startsWith('@Req')) params.push('req');
      else if (t.startsWith('@Param')) params.push('param:' + (t.match(/@Param\('(\w+)'\)/) || [])[1]);
      else if (t.startsWith('@Query()')) params.push('query');
      else if (t.startsWith('@Query(')) params.push('query:' + (t.match(/@Query\('(\w+)'\)/) || [])[1]);
      else if (t.startsWith('@Body')) params.push('body');
      else if (t.startsWith('@Headers')) params.push('header:' + (t.match(/@Headers\('([\w-]+)'\)/) || [])[1]);
      else params.push('?');
    }
    const full = (base + (sub ? '/' + sub : '')).replace(/\/+/g, '/');
    const keys = []; const re = new RegExp('^' + full.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    out.push({ verb: verb.toUpperCase(), re, keys, perm, method, params, fn: instance[method].bind(instance) });
  }
  return out;
}
const ROUTES = [
  ...routesOf('modules/inventory/src/inventory-screen.controller.ts', '/tenant/inventory/screen', new InventoryScreenController(inv, new InventoryScreenRepository(db))),
  ...routesOf('modules/inventory/src/suppliers-screen.controller.ts', '/tenant/inventory/suppliers', new SuppliersScreenController(inv, new SuppliersScreenRepository(db))),
  ...routesOf('modules/inventory/src/stock-alerts.controller.ts', '/tenant/inventory/stock-alerts', new StockAlertsController(inv, new StockAlertsRepository(db))),
  ...routesOf('modules/inventory/src/inventory.controller.ts', '/tenant/inventory', new InventoryController(inv)),
  ...extra.routes(db, routesOf),
];
const RN = rnExtra(db, pg, ROOT);   // Loyalty → Rewards Network (Oct 30 2026)
ROUTES.push(...RN.routes(routesOf));
const SEG = segExtra(db, pg);   // Marketing → Customer Segments (Oct 30 2026)
Object.assign(seeded, await SEG.seed(PILOT, BRANCH));
ROUTES.push(...SEG.routes(routesOf));
const CP = cpExtra(db, pg);   // Marketing → Coupons (Coupons & Promotions guide, Oct 30 2026)
Object.assign(seeded, await CP.seed(PILOT, BRANCH));
ROUTES.push(...CP.routes(routesOf));
const DO = doExtra(db, pg, { OWNER_USER, TECH_USER });   // Marketing → Deals & Offers (Deals & Offers guide, Oct 30 2026)
Object.assign(seeded, await DO.seed(PILOT, BRANCH));
ROUTES.push(...DO.routes(routesOf));
const PROMO = promoExtra(db, pg, { OWNER_USER });   // Marketing → Promotions (Promotions Management guide, Oct 30 2026)
Object.assign(seeded, await PROMO.seed(PILOT, BRANCH));
ROUTES.push(...PROMO.routes(routesOf));
const CC = ccExtra(db, pg);   // Marketing → Campaign Center (Campaign Center guide, Oct 30 2026) — seeded on demand (/__cc?seed=1) so the
                              // other sections' fixtures (newest customer, drafts, campaigns) are exactly as before
ROUTES.push(...CC.routes(routesOf));
const MG = mgExtra(db, pg);   // Marketing → Marketing & Growth (Marketing & Growth guide, Oct 30 2026) — seeded on demand (/__mg?seed=1)
ROUTES.push(...MG.routes(routesOf));
const MT = mtExtra(db, pg, { OWNER_USER });   // Communications → Message Templates (Message Templates & Automation Center guide, Oct 30 2026) — seeds nothing
ROUTES.push(...MT.routes(routesOf));
const CN = cnExtra(db, pg, { OWNER_USER });   // Communications → Customer Notifications (Customer Notifications guide, 741) — seeds on /__cn?seed=1
ROUTES.push(...CN.routes(routesOf));
const PMX = pmExtra(db, pg);   // Customers → Phone Number Management (Phone Number Management guide, 742) — seeds on /__pm?seed=1
ROUTES.push(...PMX.routes(routesOf));
const BVX = bvExtra(db, pg);   // Communications → Booking Phone Verification (guide 10, 743) — seeds on /__bv?seed=1
ROUTES.push(...BVX.routes(routesOf));
const EODX = eodExtra(db, pg);   // Communications → End-of-Day Follow-Ups (guide 12, 745) — seeds on /__eod?seed=1
ROUTES.push(...EODX.routes(routesOf));
const FUQX = fuqExtra(db, pg, EODX.svc);   // Communications → Follow-Up Queue (guide 13, 746) — seeds on /__fuq?seed=1
ROUTES.push(...FUQX.routes(routesOf));
const WBX = wbExtra(db, pg);   // Customer Retention & Win-Back (guide 16, 749) — seeds on /__wb?seed=1
ROUTES.push(...WBX.routes(routesOf));
const BDX = bdExtra(db, pg);   // Birthday Campaigns (guide 17, 750) — seeds on /__bd?seed=1
ROUTES.push(...BDX.routes(routesOf));
const RFX = rfExtra(db, pg);   // Referral Program (guide 18, 751) — seeds on /__rf?seed=1
ROUTES.push(...RFX.routes(routesOf));
const RVX = rvExtra(db, pg);   // Reviews & Reputation (guide 19, 752) — seeds on /__rv?seed=1
ROUTES.push(...RVX.routes(routesOf));
const BSX = bsExtra(db, pg);   // AI Business Setup (guide 20, 753) — seeds on /__bs?seed=1
ROUTES.push(...BSX.routes(routesOf));
const RCPX = rcpExtra(db, pg);
const AICX = aicExtra(db, pg);   // AI Calls (guide 22, 755) — seeds through the real provider-event merge on /__aic?seed=1   // AI Receptionist (guide 21, 754) — seeds on /__rcp?seed=1
ROUTES.push(...RCPX.routes(routesOf));
ROUTES.push(...AICX.routes(routesOf));
const FDX = fdExtra(db, pg);   // AI Front Desk (guide 23, 756) — /__fd?reset|bulk|gates|state
ROUTES.push(...FDX.routes(routesOf));
const RCCX = rccExtra(db, pg);   // Reception Copilot (guide 24, 757) — /__rcc?reset|seed|state
ROUTES.push(...RCCX.routes(routesOf));
const AICALX = aicalExtra(db, pg);   // AI Calendar (guide 25, 758) — /__aical?reset|seed|state
const FUX = fuExtra(db, pg, RCCX.center);   // AI Follow-Ups (guide 26, 759) — /__fu?reset|seed|state|task|attempts
ROUTES.push(...AICALX.routes(routesOf));
ROUTES.push(...FUX.routes(routesOf));
const RMDX = rmdExtra(db, pg);   // Communications → Appointment Reminders (guide 14, 747) — seeds on /__rmd?seed=1
ROUTES.push(...RMDX.routes(routesOf));
const EMX = emExtra(db, pg);   // Communications → Email (guide 15, 748) — seeds on /__em?seed=1
ROUTES.push(...EMX.routes(routesOf));
console.log('routes', ROUTES.length);
const nav = new TenantNavigationService(db);

let tenant = 'pilot', lang = 'en', role = ADMIN ? 'SUPER_ADMIN' : APPMODE === 'customer' ? 'CUSTOMER' : 'OWNER', fail = false;
// TEST-ONLY realtime control (Team Management round 2A, TM-05): the open /realtime/stream responses, a "stream down" switch
// (close every stream and answer 503 to new ones) and an emitter that writes one frame to every open stream.
const streams = new Set(); let rtDown = false; let rtSeq = 0;
// SMS Inbox (Oct 30 2026): the inbox / webhook services publish through this — one frame per event to every open stream,
// exactly what the SSE gateway sends (ids-only payload + the registry's screens)
globalThis.__harnessRealtime = { toTenant: (ctx, event, payload) => { const frame = { event, seq: ++rtSeq, screens: screensToRefetch(event), payload: { eventId: 'inbox-' + rtSeq, resourceType: 'conversation', resourceId: payload?.threadId ?? null, ...payload } }; for (const s0 of streams) s0.write(`data: ${JSON.stringify(frame)}\n\n`); } };
const RT_EXEC = {   // harness fixtures the live step flips before it emits (ids by name: the seed's Vishal verma)
  vishal_break: `update technician_workforce_state set queue_status = 'BREAK', clock_status = 'ON_BREAK', updated_at = now() where tenant_id = $1 and technician_id = (select id from technicians where tenant_id = $1 and full_name = 'Vishal verma')`,
  vishal_available: `update technician_workforce_state set queue_status = 'AVAILABLE', clock_status = 'CLOCKED_IN', updated_at = now() where tenant_id = $1 and technician_id = (select id from technicians where tenant_id = $1 and full_name = 'Vishal verma')`,
};
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER, TECHNICIAN: TECH_USER };
const NAMES = { OWNER: 'Pat Owner', MANAGER: 'Mai Manager', FRONT_DESK: 'Vy Front Desk', TECHNICIAN: 'Anna Lee' };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH_E : BRANCH, userId: role === 'CUSTOMER' && globalThis.__rnCustomerUser ? globalThis.__rnCustomerUser : USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
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
    const { message: _m, code: _c, ok: _o, ...rest } = (r && typeof r === 'object') ? r : {};
    return { status: st, body: { error: { code, message: message0 || 'error', details: rest }, code, message: message0, ...rest } };
  }
}
const denied = () => ({ status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' }, code: 'PERMISSION_DENIED' } });
const q = (s, p = []) => pg.query(s, p);
async function route(method, path, query, body, headers) {
  const r = { ctx: session(), headers: headers ?? {} };
  if (fail && /^\/(tenant\/inventory|pos\/memberships|pos\/salon-promotions|pos\/discounts|pos\/catalog|pos\/services|pos\/bundles|pos\/technicians-screen|pos\/tech-appointments|pos\/live-schedule-screen|pos\/tech-queue-screen|pos\/commission-screen|pos\/team-performance-screen|pos\/tech-queue\/|pos\/technicians\/live-schedule)/.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  if (method === 'GET' && path === '/tenant/navigation/badges') return call(() => nav.badges({ tenantId: session().tenantId, branchId: session().branchId, role, permissions: session().permissions }));
  for (const rt of ROUTES) {
    if (rt.verb !== method) continue; const m = path.match(rt.re); if (!m) continue;
    const pv = Object.fromEntries(rt.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const args = rt.params.map((p) => p === 'req' ? r : p.startsWith('param:') ? pv[p.slice(6)] : p === 'query' ? query : p.startsWith('query:') ? query[p.slice(6)] : p === 'body' ? body : p.startsWith('header:') ? headers[p.slice(7)] : undefined);
    if (method !== 'GET') log.push(`REAL ${rt.method} ${JSON.stringify(pv)}`);
    const gated = RN.gate(rt); if (gated) return gated;
    return call(() => rt.fn(...args), rt.perm);
  }
  return (await SEG.route(method, path, query, body, { session, has, call })) ?? (await CP.route(method, path, query, body, { session, has, call })) ?? extra.route?.(method, path, query, body, { session, has, call });
}

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json', x = {}) => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...x }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__tenant') { tenant = u.searchParams.get('name') === 'empty' ? 'empty' : 'pilot'; return send(200, { tenant }); }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l') === 'vi' ? 'vi' : 'en'; return send(200, { lang }); }
  if (u.pathname === '/__role') { role = u.searchParams.get('r') || 'OWNER'; return send(200, { role, perms: perms(role).length }); }
  if (u.pathname === '/__fail') { fail = u.searchParams.get('on') === '1'; return send(200, { fail }); }
  if (u.pathname === '/__log') return send(200, log.slice(-400));
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__seeded') return send(200, seeded);
  if (u.pathname === '/__inbox') return send(200, await inboxControl(u.searchParams));
  if (u.pathname === '/__do') { try { return send(200, await DO.control(u.searchParams, PILOT)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__cc') { try { if (u.searchParams.get('seed')) return send(200, await CC.seed(PILOT, BRANCH)); return send(200, await CC.control(u.searchParams, PILOT)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__em') { try { return send(200, await EMX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rmd') { try { return send(200, await RMDX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__aic') { try { return send(200, await AICX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__fu') { try { return send(200, await FUX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__aical') { try { return send(200, await AICALX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rcc') { try { return send(200, await RCCX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__fd') { try { return send(200, await FDX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rcp') { try { return send(200, await RCPX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__bs') { try { return send(200, await BSX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rv') { try { return send(200, await RVX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rf') { try { return send(200, await RFX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__bd') { try { return send(200, await BDX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__wb') { try { return send(200, await WBX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__fuq') { try { return send(200, await FUQX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__eod') { try { return send(200, await EODX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__bv') { try { return send(200, await BVX.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__pm') { try { return send(200, await PMX.control(u.searchParams, PILOT, BRANCH, { DESK_USER })); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__cn') { try { return send(200, await CN.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__mt') { try { return send(200, await MT.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__mg') { try { return send(200, await MG.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__promo') { try { return send(200, await PROMO.control(u.searchParams, PILOT, BRANCH)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__cp') { try { return send(200, await CP.control(u.searchParams, PILOT)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__seg') { try { return send(200, await SEG.control(u.searchParams, PILOT)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rn') { try { return send(200, await RN.control(u.searchParams, PILOT)); } catch (e) { return send(400, { error: e?.code ?? 'ERR', message: e?.message }); } }
  if (u.pathname === '/__rt') {
    const sp = u.searchParams;
    if (sp.has('down')) { rtDown = sp.get('down') === '1'; if (rtDown) { for (const s0 of streams) { try { s0.end(); } catch (e) { console.warn('rt close', e?.message); } } streams.clear(); } }
    if (sp.get('exec') && RT_EXEC[sp.get('exec')]) await pg.query(RT_EXEC[sp.get('exec')], [PILOT]);
    if (sp.get('emit')) {
      const rv = sp.get('rv'); const frame = { event: sp.get('emit'), seq: ++rtSeq, ...(sp.get('screens') ? { screens: sp.get('screens').split(',') } : {}),
        payload: { eventId: 'harness-' + rtSeq, resourceType: sp.get('rtype') || 'technician', resourceId: sp.get('rid') || 'harness', ...(rv ? { resourceVersion: Number(rv), resourceVersionSource: 'aggregate' } : {}) } };
      for (const s0 of streams) s0.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
    return send(200, { streams: streams.size, down: rtDown, seq: rtSeq });
  }
  if (u.pathname === '/__sql') {
    const k = u.searchParams.get('k'), a = u.searchParams.get('a') ?? '';
    const QQ = {
      moves: [`select movement_type, quantity_change, related_type from inventory_stock_movements where tenant_id = $1 and product_id = $2::uuid order by created_at desc limit 20`, [PILOT, a]],
      products: [`select id, name, sku, archived_at is not null as archived from inventory_products where tenant_id = $1 order by created_at desc limit 5`, [PILOT]],
      vendors: [`select id, name, active from inventory_vendors where tenant_id = $1 order by created_at desc limit 5`, [PILOT]],
      contacts: [`select name, is_primary, active from inventory_vendor_contacts where tenant_id = $1 and vendor_id = $2::uuid order by created_at`, [PILOT, a]],
      audit: [`select action_type, entity_id, metadata_json from audit_logs where tenant_id = $1 order by created_at desc limit 20`, [PILOT]],
      po: [`select status, vendor_id from purchase_orders where tenant_id = $1 and id = $2::uuid`, [PILOT, a]],
      ...(extra.sql?.(PILOT, a) ?? {}),
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
  if (path === '/auth/step-up' && rq.method === 'POST') { const r0 = RN.stepUp(body); return send(r0.status, r0.body); }
  if (path === '/pos/me/locale') return send(200, { language: lang, timeZone: 'America/New_York' });
  if (path === '/realtime/stream') {
    if (rtDown) return send(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'stream down (harness)' } });
    rs.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); rs.write(': connected\n\nevent: ready\ndata: {}\n\n'); streams.add(rs);
    const t = setInterval(() => rs.write(': ping\n\n'), 15000); rq.on('close', () => { clearInterval(t); streams.delete(rs); }); return;
  }
  let hit;
  try { hit = await route(rq.method, path, query, body, rq.headers); } catch (e) { console.error('route', e); hit = { status: e?.getStatus?.() ?? 400, body: { error: { code: e?.getResponse?.()?.code ?? 'VALIDATION_FAILED', message: e?.message ?? 'error' } } }; }
  if (hit) { if (typeof hit.body === 'string') return send(hit.status, hit.body, 'text/csv; charset=utf-8'); return send(hit.status, hit.body); }
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const k2 = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(k2, (unhandled.get(k2) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4391), '127.0.0.1', () => console.log('catalog harness on', process.env.PORT || 4391));
