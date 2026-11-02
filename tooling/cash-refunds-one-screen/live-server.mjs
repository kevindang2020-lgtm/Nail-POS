// live-server.mjs — End-of-Day Cash + Refunds & Voids one-screen harness (Oct 29 2026): the REAL Front Desk POS bundle
// (tooling/checkout-one-screen/build.mjs) served against the REAL screen controllers + repositories + SQL (CashHandoffsScreen,
// RefundsVoidsScreen) on a seeded TEST database. Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/cash-refunds-one-screen/live-server.mjs
// Controls: /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK|TECHNICIAN · /__fail?on=1 ·
//           /__lost?on=1 (the next card refund loses its processor answer) · /__log · /__unhandled · /__audit · /__sql?k=…
// What is NOT the product here: the HTTP layer (no Nest guards / ListQuery / Idempotency interceptor / step-up — controller
// methods are called directly with the session context). The hand-off count / partial / resolve run the REAL
// TechCashHandoffRepository.reconcile / resolve (raw SQL) behind the service's own validation (the service's expected-cash
// read uses the query builder, so the harness computes the same sum). Checkout's refund / void use the query builder this
// stand-in cannot run: the harness answers them with the same rules and row changes (the refund cap with pending
// reservations, the refund + reversal rows, the lost-answer hold; the void marking the original and writing the zero-amount
// record + audit), each labelled SIMULATED in /__log. No processor is called; no money moves; nothing leaves this process.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, PILOT, EMPTY, BRANCH, BRANCH_E, OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, salonToday } from './seed.mjs';
import { CashHandoffsScreenRepository } from '../../modules/payments/src/finance-screens/cash-handoffs-screen.repository.ts';
import { CashHandoffsScreenController } from '../../modules/payments/src/finance-screens/cash-handoffs-screen.controller.ts';
import { RefundsVoidsScreenRepository } from '../../modules/payments/src/finance-screens/refunds-voids-screen.repository.ts';
import { RefundsVoidsScreenController } from '../../modules/payments/src/finance-screens/refunds-voids-screen.controller.ts';
import { parseDenominations } from '../../modules/workforce/src/tech-cash-handoff/tech-cash-handoff.service.ts';
import { TechCashHandoffRepository } from '../../modules/workforce/src/tech-cash-handoff/tech-cash-handoff.repository.ts';
import { TechCashHandoffVersionConflict, TechCashHandoffError } from '../../modules/workforce/src/tech-cash-handoff/tech-cash-handoff.dto.ts';
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
const handoffRepo = new TechCashHandoffRepository(db);   // the REAL writer (raw SQL — runs here)
const C = { ch: new CashHandoffsScreenController(new CashHandoffsScreenRepository(db, auditor)), rv: new RefundsVoidsScreenController(new RefundsVoidsScreenRepository(db, auditor)) };

let tenant = 'pilot', lang = 'en', role = 'OWNER', fail = false, lost = false;
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER, TECHNICIAN: TECH_USER };
const NAMES = { OWNER: 'Pat Owner', MANAGER: 'Mai Manager', FRONT_DESK: 'Vy Front Desk', TECHNICIAN: 'Anna Lee' };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH_E : BRANCH, userId: USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: NAMES[role] ?? 'Pat Owner', email: null, subscriptionStatus: 'active' }; };
const has = (p) => hasPermission(session(), p);
const unhandled = new Map(); const log = [];
let coded = []; setCodedErrorSink((e) => coded.push(e));
async function call(fn) {
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
const bad = (code, message, status = 400) => ({ status, body: { error: { code, message }, code, message } });
const ok = (b) => ({ status: 200, body: b });
const SIM = (what) => log.push(`SIMULATED ${what}`);
const q = (s, p = []) => pg.query(s, p);
const uuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s ?? ''));

/** The service's validation (posReconcile) around the REAL TechCashHandoffRepository.reconcile; the expected amount is computed
 *  as expectedCashForTech does (that read uses the query builder, which this stand-in cannot run). */
async function simReconcile(techId, b, idemKey) {
  if (!has('pos.checkout.take_payment')) return denied();
  const s = session(); const T = s.tenantId; const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? '')) ? b.date : salonToday();
  const counted = Math.round(Number(b.countedCents)); if (!Number.isFinite(counted) || counted < 0) return bad('COUNTED_CASH_INVALID', 'Enter the counted cash (0 or more).');
  const mode = b.mode === 'add' ? 'add' : 'replace'; if (mode === 'add' && counted <= 0) return bad('COUNTED_CASH_INVALID', 'A partial hand-off must be more than $0.');
  let den; try { den = parseDenominations(b.denominations); } catch (e) { return bad('VALIDATION_FAILED', e.message); }
  if (den && den.reduce((a, d) => a + d.denominationCents * d.quantity, 0) !== counted) return bad('COUNT_SHEET_MISMATCH', 'The count sheet does not add up to the counted amount.');
  const key = b.idempotencyKey || idemKey || null;
  if (key) { const seen = (await q(`select id from tech_cash_handoff_events where tenant_id = $1 and idempotency_key = $2`, [T, key])).rows[0]; if (seen) { SIM(`reconcile replay ${key}`); return ok({ ...(await unitOf(techId, date)), result: { replayed: true } }); } }
  const exp = (await q(`select coalesce(sum(amount_cents),0)::int e, count(*)::int n from cash_payment_confirmations where tenant_id = $1 and technician_id = $2 and status = 'confirmed' and (confirmed_at at time zone 'America/New_York')::date = $3::date`, [T, techId, date])).rows[0];
  let res;
  try { res = await handoffRepo.reconcile(s, techId, date, { expectedCents: exp.e, paymentCount: exp.n }, counted, typeof b.notes === 'string' ? b.notes.slice(0, 500) : null,
    { mode, denominations: den, expectedVersion: b.expectedVersion == null || b.expectedVersion === '' ? null : Number(b.expectedVersion), idempotencyKey: key, transferToDrawer: b.transferToDrawer === true, registerId: b.registerId || null }); }
  catch (e) { if (e instanceof TechCashHandoffVersionConflict) return bad('HANDOFF_VERSION_CONFLICT', e.message, 409); if (e instanceof TechCashHandoffError) return bad(e.apiCode || 'VALIDATION_FAILED', e.message, e.httpStatus); throw e; }
  const total = res.countedCents, variance = res.varianceCents, status = res.status, mv = res.drawerMovementId;
  await q(`insert into owner_audit_log (tenant_id, branch_id, user_id, role, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,'tech_cash_handoff_reconciled','tech_cash_handoff',$5,$6::jsonb)`, [T, s.branchId, s.userId, s.role, techId, JSON.stringify({ businessDate: date, countedCents: total, amountCents: counted, mode, varianceCents: variance, status })]);
  log.push(`REAL TechCashHandoffRepository.reconcile ${techId} ${date} ${mode} ${counted} → ${total} (${status})${mv ? ' + drawer ' + mv : ''}`);
  const u = await unitOf(techId, date);
  return ok({ ...u, countedCents: total, result: res });
}
async function unitOf(techId, date) { const r = (await q(`select full_name from technicians where id = $1`, [techId])).rows[0]; return { technicianId: techId, technicianName: r?.full_name ?? '', businessDate: date }; }
async function simResolve(techId, b) {
  if (!has('checkout.manage_overrides')) return denied();
  const s = session(); const reason = String(b.reason ?? '').trim(); if (!reason) return bad('HANDOFF_RESOLUTION_REASON_REQUIRED', 'Say how the difference was resolved.');
  try { await handoffRepo.resolve(s, techId, b.date, reason, b.expectedVersion == null ? null : Number(b.expectedVersion)); }
  catch (e) { if (e instanceof TechCashHandoffVersionConflict) return bad('HANDOFF_VERSION_CONFLICT', e.message, 409); if (e instanceof TechCashHandoffError) return bad(e.apiCode || 'VALIDATION_FAILED', e.message, e.httpStatus); throw e; }
  await q(`insert into owner_audit_log (tenant_id, branch_id, user_id, role, action, entity_type, entity_id, metadata) values ($1,$2,$3,$4,'tech_cash_handoff_resolved','tech_cash_handoff',$5,$6::jsonb)`, [s.tenantId, s.branchId, s.userId, s.role, techId, JSON.stringify({ businessDate: b.date, reason })]);
  log.push(`REAL TechCashHandoffRepository.resolve ${techId} ${b.date}`);
  return ok(await unitOf(techId, b.date));
}
/** Checkout's refund of one tender (claim-first cap, three outcomes) — the rules, in raw SQL. */
const idemSeen = new Map();
async function simRefund(pid, b, idemKey) {
  if (!has('pos.checkout.refund')) return denied();
  if (idemKey && idemSeen.has(idemKey)) { SIM(`refund replay ${idemKey}`); return idemSeen.get(idemKey); }
  const s = session(); const T = s.tenantId; if (!String(b.reason ?? '').trim()) return bad('REFUND_REASON_REQUIRED', 'Refund requires a reason');
  const p = (await q(`select * from payments where tenant_id = $1 and id = $2::uuid`, [T, pid])).rows[0]; if (!p) return bad('PAYMENT_NOT_FOUND', 'Payment not found', 404);
  if (!['approved', 'partial'].includes(p.status)) return bad('PAYMENT_NOT_REFUNDABLE', 'Only an approved or partial payment can be refunded');
  const amount = b.amountCents != null ? Math.round(Number(b.amountCents)) : Number(p.amount_cents);
  if (!Number.isInteger(amount) || amount <= 0) return bad('REFUND_AMOUNT_INVALID', 'Refund amount must be a positive whole number of cents');
  if ((await q(`select 1 from payment_refunds where tenant_id = $1 and payment_id = $2 and status = 'processing'`, [T, pid])).rows.length) return bad('REFUND_PENDING_VERIFICATION', 'A refund on this payment is waiting for the processor’s answer.', 409);
  const held = Number((await q(`select coalesce(sum(amount_cents),0)::int s from payment_refunds where tenant_id = $1 and payment_id = $2 and status in ('reserved','pending','processing','refunded')`, [T, pid])).rows[0].s);
  if (amount > Number(p.amount_cents) - held) return bad('REFUND_EXCEEDS_REFUNDABLE', `Refund exceeds the refundable balance (${Number(p.amount_cents) - held} cents remain)`);
  if (lost && p.method === 'card') {
    lost = false; await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, processor_type, amount_cents, reason, status, created_by_user_id, last_error) values ($1,$2,$3,'cardpointe',$4,$5,'processing',$6,'threw: ETIMEDOUT')`, [T, p.branch_id, pid, amount, b.reason, s.userId]);
    SIM(`refund ${pid} ${amount} — processor answer LOST (held as processing)`);
    return bad('REFUND_STATUS_UNKNOWN', 'The refund answer was lost. It is being verified with the card processor — do not refund again.', 409);
  }
  const ref = 'SIM-RF-' + Date.now().toString(36).toUpperCase();
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, processor_type, amount_cents, reason, status, processor_refund_id, created_by_user_id, settled_at, settled_by) values ($1,$2,$3,$4,$5,$6,'refunded',$7,$8,now(),'live')`, [T, p.branch_id, pid, p.method === 'card' ? 'cardpointe' : null, amount, b.reason, ref, s.userId]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id) values ($1,$2,$3,$4,$5,0,'refunded',$6)`, [T, p.branch_id, p.ticket_id, p.method, amount, ref]);
  await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json) values ($1,$2,$3,$4,'pos_checkout_refund_created','pos_refund',$5,$6::jsonb)`, [T, p.branch_id, s.userId, s.role, pid, JSON.stringify({ metadata: { reason: b.reason, refundedCents: amount } })]);
  SIM(`refund ${pid} ${amount} (${p.method})`);
  const out = ok({ refundId: ref, status: 'refunded' }); if (idemKey) idemSeen.set(idemKey, out); return out;
}
async function simVoid(pid, b, idemKey) {
  if (!has('pos.checkout.void')) return denied();
  if (idemKey && idemSeen.has(idemKey)) { SIM(`void replay ${idemKey}`); return idemSeen.get(idemKey); }
  const s = session(); const T = s.tenantId; if (!String(b.reason ?? '').trim()) return bad('VOID_REASON_REQUIRED', 'Void requires a reason');
  const p = (await q(`select * from payments where tenant_id = $1 and id = $2::uuid`, [T, pid])).rows[0]; if (!p) return bad('PAYMENT_NOT_FOUND', 'Payment not found', 404);
  if (!['approved', 'partial'].includes(p.status)) return bad('PAYMENT_NOT_VOIDABLE', 'Only an approved or partial payment can be voided');
  if (Number((await q(`select coalesce(sum(amount_cents),0)::int s from payment_refunds where tenant_id = $1 and payment_id = $2`, [T, pid])).rows[0].s) > 0) return bad('PAYMENT_ALREADY_REFUNDED', 'This payment has already been refunded and cannot be voided');
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id) values ($1,$2,$3,$4,0,0,'voided',$5)`, [T, p.branch_id, p.ticket_id, p.method, 'SIM-VD-' + Date.now().toString(36).toUpperCase()]);
  await q(`update payments set status = 'voided', updated_at = now() where id = $1`, [pid]);
  await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json) values ($1,$2,$3,$4,'pos_checkout_void_created','pos_void',$5,$6::jsonb)`, [T, p.branch_id, s.userId, s.role, pid, JSON.stringify({ metadata: { reason: b.reason } })]);
  SIM(`void ${pid}`);
  const out = ok({ status: 'voided' }); if (idemKey) idemSeen.set(idemKey, out); return out;
}

const SCREEN = /^\/pos\/payments\/(cash-handoffs|refunds-voids)\//;
async function route(method, path, query, body, headers) {
  const r = { ctx: session() }; const Q = query; const m = (re) => path.match(re); let x;
  if (fail && SCREEN.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  const CH = '/pos/payments/cash-handoffs';
  if (method === 'GET' && path === CH + '/list') return call(() => C.ch.list(r, Q));
  if (method === 'GET' && path === CH + '/summary') return call(() => C.ch.summary(r, Q));
  if (method === 'GET' && path === CH + '/technicians') return call(() => C.ch.technicians(r));
  if (method === 'GET' && path === CH + '/export') return has('pos.reports.export') ? call(() => C.ch.exportCsv(r, Q)) : denied();
  if (method === 'GET' && (x = m(/^\/pos\/payments\/cash-handoffs\/([^/]+)\/([^/]+)\/detail$/))) return call(() => C.ch.detail(r, x[1], decodeURIComponent(x[2])));
  if (method === 'POST' && (x = m(/^\/pos\/cash-handoffs\/([^/]+)\/reconcile$/))) return uuid(x[1]) ? simReconcile(x[1], body, headers['idempotency-key']) : bad('TECHNICIAN_NOT_FOUND', 'Invalid technician.');
  if (method === 'POST' && (x = m(/^\/pos\/cash-handoffs\/([^/]+)\/resolve$/))) return simResolve(x[1], body);
  const RV = '/pos/payments/refunds-voids';
  if (method === 'GET' && path === RV + '/list') return call(() => C.rv.list(r, Q));
  if (method === 'GET' && path === RV + '/summary') return call(() => C.rv.summary(r, Q));
  if (method === 'GET' && path === RV + '/facets') return call(() => C.rv.facets(r));
  if (method === 'GET' && path === RV + '/find') return call(() => C.rv.find(r, Q));
  if (method === 'GET' && path === RV + '/export') return has('pos.reports.export') ? call(() => C.rv.exportCsv(r, Q)) : denied();
  if (method === 'GET' && (x = m(/^\/pos\/payments\/refunds-voids\/(refund|void)\/([^/]+)\/detail$/))) return call(() => C.rv.detail(r, x[1], x[2]));
  if (method === 'POST' && (x = m(/^\/pos\/checkout\/payments\/([^/]+)\/refund$/))) return simRefund(x[1], body, headers['idempotency-key']);
  if (method === 'POST' && (x = m(/^\/pos\/checkout\/payments\/([^/]+)\/void$/))) return simVoid(x[1], body, headers['idempotency-key']);
  return undefined;
}

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json', extra = {}) => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__tenant') { tenant = u.searchParams.get('name') === 'empty' ? 'empty' : 'pilot'; return send(200, { tenant }); }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l') === 'vi' ? 'vi' : 'en'; return send(200, { lang }); }
  if (u.pathname === '/__role') { role = u.searchParams.get('r') || 'OWNER'; return send(200, { role, perms: perms(role).length }); }
  if (u.pathname === '/__fail') { fail = u.searchParams.get('on') === '1'; return send(200, { fail }); }
  if (u.pathname === '/__lost') { lost = u.searchParams.get('on') === '1'; return send(200, { lost }); }
  if (u.pathname === '/__log') return send(200, log.slice(-400));
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__audit') return send(200, audited);
  if (u.pathname === '/__seeded') return send(200, seeded);
  if (u.pathname === '/__sql') {
    const k = u.searchParams.get('k'), a = u.searchParams.get('a') ?? '';
    const QQ = {
      unit: [`select technician_id, to_char(business_date,'YYYY-MM-DD') d, expected_cents, counted_cents, variance_cents, status, version, drawer_transfer_cents, resolution_reason from tech_cash_handoffs where tenant_id = $1 and technician_id = $2::uuid order by business_date desc limit 1`, [PILOT, a]],
      events: [`select event_type, amount_cents, counted_total_cents, idempotency_key, denominations_json is not null as denominations from tech_cash_handoff_events where tenant_id = $1 and technician_id = $2::uuid and business_date = $3::date order by created_at`, [PILOT, a, salonToday()]],
      drawer: [`select direction, amount_cents, source_type from cash_drawer_movements where tenant_id = $1 and source_type = 'tech_cash_handoff'`, [PILOT]],
      sales: [`select count(*)::int n from payments where tenant_id = $1 and status = 'approved' and method = 'cash'`, [PILOT]],
      refunds: [`select status, amount_cents from payment_refunds where tenant_id = $1 and payment_id = $2::uuid order by created_at`, [PILOT, a]],
      payment: [`select status, amount_cents from payments where tenant_id = $1 and id = $2::uuid`, [PILOT, a]],
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
}).listen(Number(process.env.PORT || 4369), '127.0.0.1', () => console.log('end-of-day cash + refunds & voids harness on', process.env.PORT || 4369));
