// live-server.mjs — Tips & Gratuity + Split Payments one-screen harness (Oct 29 2026): the REAL Front Desk POS bundle
// (tooling/checkout-one-screen/build.mjs) served against the REAL screen controllers + repositories + SQL (TipsScreen,
// SplitPaymentsScreen) on a seeded TEST database. Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/tips-split-one-screen/live-server.mjs
// Controls: /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK|TECHNICIAN · /__fail?on=1 ·
//           /__log · /__unhandled · /__audit · /__sql?k=…
// What is NOT the product here: the HTTP layer (no Nest guards / ListQuery / step-up — the controller methods are called
// directly with the session context); the tip re-allocation write (POST /pos/tickets/:id/tip-allocation —
// TipAllocationService, modules/workforce), whose writer uses the query builder this stand-in cannot run — the harness
// answers it with the same row changes (allocation rows replaced, posted tip_correction deltas on a paid ticket, an audit
// row), labelled SIMULATED in /__log. No processor is called; no money moves.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, PILOT, EMPTY, BRANCH, BRANCH_E, OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER } from './seed.mjs';
import { TipsScreenRepository } from '../../modules/payments/src/finance-screens/tips-screen.repository.ts';
import { TipsScreenController } from '../../modules/payments/src/finance-screens/tips-screen.controller.ts';
import { SplitPaymentsScreenRepository } from '../../modules/payments/src/finance-screens/split-payments-screen.repository.ts';
import { SplitPaymentsScreenController } from '../../modules/payments/src/finance-screens/split-payments-screen.controller.ts';
import { validateTipAllocation, tipCorrectionDeltas } from '../../modules/workforce/src/compensation/compensation-tip-allocation.service.ts';
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
const t0 = Date.now(); const seeded = await seed(pg);
console.log(`seeded in ${Date.now() - t0} ms`, seeded, 'db', pg.dbname);

const audited = [];
const auditor = { record: async (c, i) => { audited.push({ at: new Date().toISOString(), tenantId: c.tenantId, userId: c.userId, ...i }); } };
const C = { tp: new TipsScreenController(new TipsScreenRepository(db, auditor)), sp: new SplitPaymentsScreenController(new SplitPaymentsScreenRepository(db, auditor)) };

let tenant = 'pilot', lang = 'en', role = 'OWNER', fail = false;
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER, TECHNICIAN: TECH_USER };
const NAMES = { OWNER: 'Pat Owner', MANAGER: 'Mai Manager', FRONT_DESK: 'Vy Front Desk', TECHNICIAN: 'Vishal Verma' };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH_E : BRANCH, userId: USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: NAMES[role] ?? 'Pat Owner', email: null, subscriptionStatus: 'active' }; };
const has = (p) => hasPermission(session(), p);
const unhandled = new Map(); const log = [];
let coded = []; setCodedErrorSink((e) => coded.push(e));
async function call(fn) {
  coded = [];
  try {
    const headers = {}; const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; } };
    const body = await fn(res);
    return { status: 200, body: body ?? null, headers };
  } catch (e) {
    const st = typeof e?.getStatus === 'function' ? e.getStatus() : e?.status ?? 500; const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const message0 = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message);
    const code = (r && typeof r === 'object' && r.code) || e?.apiCode || coded.find((c) => c.message === message0)?.apiCode || e?.code || (st === 403 ? 'PERMISSION_DENIED' : st === 401 ? 'AUTH_REQUIRED' : st === 404 ? 'RESOURCE_NOT_FOUND' : st === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR');
    if (st >= 500) console.error('500', e);
    return { status: st, body: { error: { code, message: message0 || 'error', details: (r && typeof r === 'object' && r.details) || e?.details || {} }, code, message: message0 } };
  }
}
const denied = () => ({ status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' } } });
const bad = (code, message, status = 400) => ({ status, body: { error: { code, message } } });
const ok = (b) => ({ status: 200, body: b });
const SIM = (what) => log.push(`SIMULATED ${what}`);
const q = (s, p = []) => pg.query(s, p);

const SCREEN = /^\/pos\/payments\/(tips|split-payments)\//;
async function route(method, path, query, body) {
  const r = { ctx: session() }; const Q = query; const m = (re) => path.match(re); let x;
  if (fail && SCREEN.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  // ── Tips (read model — real) ──
  const TP = '/pos/payments/tips';
  if (method === 'GET' && path === TP + '/summary') return call(() => C.tp.summary(r, Q));
  if (method === 'GET' && path === TP + '/transactions') return call(() => C.tp.transactions(r, Q));
  if (method === 'GET' && path === TP + '/distribution') return call(() => C.tp.distribution(r, Q));
  if (method === 'GET' && path === TP + '/technicians') return call(() => C.tp.technicians(r));
  if (method === 'GET' && path === TP + '/adjustments') return call(() => C.tp.adjustments(r, Q));
  if (method === 'GET' && path === TP + '/export') return has('pos.reports.export') ? call(() => C.tp.exportCsv(r, Q)) : denied();
  if (method === 'GET' && (x = m(/^\/pos\/payments\/tips\/([^/]+)\/detail$/))) return call(() => C.tp.detail(r, x[1]));
  // ── Split Payments (read model — real) ──
  const SP = '/pos/payments/split-payments';
  if (method === 'GET' && path === SP + '/list') return call(() => C.sp.list(r, Q));
  if (method === 'GET' && path === SP + '/summary') return call(() => C.sp.summary(r, Q));
  if (method === 'GET' && path === SP + '/registers') return call(() => C.sp.registers(r));
  if (method === 'GET' && path === SP + '/export') return has('pos.reports.export') ? call(() => C.sp.exportCsv(r, Q)) : denied();
  if (method === 'GET' && (x = m(/^\/pos\/payments\/split-payments\/([^/]+)\/detail$/))) return call(() => C.sp.detail(r, x[1]));
  // ── the tip re-allocation (SIMULATED write with the product's own validation + delta rules; see the header) ──
  if ((x = m(/^\/pos\/tickets\/([^/]+)\/tip-allocation$/))) {
    if (!has('tips.adjust')) return denied();
    const T = session().tenantId; const tid = x[1];
    const t = (await q(`select id, tip_cents, status, branch_id from tickets where tenant_id = $1 and id = $2::uuid`, [T, tid])).rows[0]; if (!t) return bad('TICKET_NOT_FOUND', 'Ticket not found', 404);
    const techs = (await q(`select distinct l.technician_id, tc.full_name from ticket_service_lines l left join technicians tc on tc.id = l.technician_id where l.tenant_id = $1 and l.ticket_id = $2::uuid and l.removed_at is null and l.technician_id is not null`, [T, tid])).rows;
    const cur = (await q(`select technician_id, tip_cents from ticket_tip_allocations where tenant_id = $1 and ticket_id = $2::uuid`, [T, tid])).rows;
    const tip = Math.max(0, Number(t.tip_cents || 0));
    if (method === 'GET') return ok({ ticketId: tid, tipCents: tip, status: t.status, locked: t.status === 'paid', allocations: techs.map((k) => ({ technicianId: k.technician_id, name: k.full_name, tipCents: Number(cur.find((c) => c.technician_id === k.technician_id)?.tip_cents ?? 0) })) });
    const errors = validateTipAllocation(tip, body.allocations, new Set(techs.map((k) => k.technician_id)));
    if (errors.length) return bad('TIP_ALLOCATION_INVALID', errors.join(' '));
    const unchanged = body.allocations.length === cur.length && body.allocations.every((a) => Number(cur.find((c) => c.technician_id === a.technicianId)?.tip_cents) === a.tipCents);
    if (t.status === 'paid' && !unchanged && String(body.reason ?? '').trim().length < 3) return bad('TIP_ALLOCATION_LOCKED', 'This ticket is paid, so its tip is locked. Give a reason to record a tip adjustment.', 409);
    await q(`delete from ticket_tip_allocations where tenant_id = $1 and ticket_id = $2::uuid`, [T, tid]);
    for (const a of body.allocations) await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,$5)`, [T, t.branch_id, tid, a.technicianId, a.tipCents]);
    let corrections = 0;
    if (t.status === 'paid') {
      const snap = (await q(`select technician_id, card_tip_cents, cash_tip_cents from ticket_compensation_snapshots where tenant_id = $1 and ticket_id = $2::uuid`, [T, tid])).rows;
      const snapped = new Map(); for (const s of snap) if (s.technician_id) snapped.set(s.technician_id, (snapped.get(s.technician_id) ?? 0) + Number(s.card_tip_cents || 0) + Number(s.cash_tip_cents || 0));
      const prior = (await q(`select technician_id, amount_cents from compensation_adjustments where tenant_id = $1 and ticket_id = $2::uuid and category = 'tip_correction' and source = 'manual' and status in ('posted','approved','applied')`, [T, tid])).rows;
      const corrected = new Map(); for (const p of prior) corrected.set(p.technician_id, (corrected.get(p.technician_id) ?? 0) + Number(p.amount_cents || 0));
      for (const d of tipCorrectionDeltas(body.allocations, snapped, corrected)) { await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source, requested_by, approved_by, reason_code) values ($1,$2,$3,$4,'tip_correction',$5,$6,'posted','manual',$7,$7,'tip_adjustment')`, [T, t.branch_id, d.technicianId, tid, d.deltaCents, String(body.reason || 'Manual tip allocation').slice(0, 500), session().userId]); corrections++; }
    }
    await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json) values ($1,$2,$3,$4,'ticket.tip_allocation_set','ticket',$5,$6::jsonb)`, [T, t.branch_id, session().userId, role, tid, JSON.stringify({ tipCents: tip, after: body.allocations, reason: body.reason ?? null, corrections })]).catch((e) => log.push('audit insert failed: ' + e.message));
    SIM(`tip-allocation ${tid} (${corrections} corrections)`);
    return ok({ ok: true, ticketId: tid, tipCents: tip, allocations: body.allocations, corrections });
  }
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
      tips: [`select coalesce(sum(tip_cents),0)::int s, count(*) filter (where tip_cents = 0)::int no_tip from tickets where tenant_id = $1 and status = 'paid' and removed_at is null`, [PILOT]],
      alloc: [`select technician_id, tip_cents from ticket_tip_allocations where tenant_id = $1 and ticket_id = $2::uuid order by tip_cents desc`, [PILOT, a]],
      snapshot: [`select technician_id, sum(card_tip_cents + cash_tip_cents)::int s, count(*)::int n from ticket_compensation_snapshots where tenant_id = $1 and ticket_id = $2::uuid group by technician_id`, [PILOT, a]],
      corrections: [`select technician_id, amount_cents, source, status, reason from compensation_adjustments where tenant_id = $1 and ticket_id = $2::uuid and category = 'tip_correction' order by created_at`, [PILOT, a]],
      audit: [`select action_type, entity_id from audit_logs where tenant_id = $1 order by created_at desc limit 3`, [PILOT]],
      ticket: [`select id, ticket_number, tip_cents, status from tickets where tenant_id = $1 and ticket_number = $2`, [PILOT, a]],
      splits: [`select t.id, t.ticket_number, count(p.id) filter (where p.status = 'approved')::int confirmed from tickets t join payments p on p.ticket_id = t.id where t.tenant_id = $1 group by t.id, t.ticket_number having count(p.id) filter (where p.status = 'approved') >= 2 order by t.ticket_number`, [PILOT]],
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
  try { hit = await route(rq.method, path, query, body); } catch (e) { console.error('route', e); hit = { status: e?.getStatus?.() ?? 400, body: { error: { code: e?.getResponse?.()?.code ?? 'VALIDATION_FAILED', message: e?.message ?? 'error' } } }; }
  if (hit) {
    if (Buffer.isBuffer(hit.body)) return send(hit.status, hit.body, hit.headers?.['content-type'] ?? 'application/octet-stream');
    if (typeof hit.body === 'string') return send(hit.status, hit.body, 'text/csv; charset=utf-8');
    return send(hit.status, hit.body);
  }
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const k2 = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(k2, (unhandled.get(k2) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4349), '127.0.0.1', () => console.log('tips + split payments harness on', process.env.PORT || 4349));
