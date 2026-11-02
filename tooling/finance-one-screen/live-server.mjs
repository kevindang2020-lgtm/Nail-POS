// live-server.mjs — Payments & Money one-screen harness (Oct 29 2026): the REAL Front Desk POS bundle (tooling/checkout-one-screen/
// build.mjs) served against the REAL Settlements / Deposit Reconciliation / Invoices controllers, repositories and SQL, on a
// seeded TEST database (a copy of the migrated schema). Tooling only — never shipped, never pointed at production.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs \
//     tooling/finance-one-screen/live-server.mjs
// Controls: GET /__tenant?name=pilot|empty · /__lang?l=en|vi · /__role?r=OWNER|MANAGER|FRONT_DESK · /__fail?on=1 (every
// finance route answers 503 — the "provider / server unavailable" state) · /__log · /__unhandled · /__audit · /__sql?k=…
// What is NOT the product here: the HTTP layer (no Nest guards / ListQuery interceptor / async-export worker — the controller
// methods are called directly with the session context and the request-body pipes run explicitly), step-up (bank account
// administration answers without the password prompt), and the shell's own routes (from the checkout harness fixtures).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { seed, PILOT, EMPTY, BRANCH, BRANCH2, OWNER_USER, MANAGER_USER, DESK_USER } from './seed.mjs';
import { SettlementsScreenRepository } from '../../modules/payments/src/finance-screens/settlements-screen.repository.ts';
import { SettlementsScreenController } from '../../modules/payments/src/finance-screens/settlements-screen.controller.ts';
import { ReconWorkspaceRepository } from '../../modules/payments/src/finance-screens/recon-workspace.repository.ts';
import { ReconWorkspaceController } from '../../modules/payments/src/finance-screens/recon-workspace.controller.ts';
import { ExceptionWorkflowService } from '../../modules/payments/src/deposit-reconciliation/deposit-reconciliation.exceptions.service.ts';
import { KyselyExceptionsRepository } from '../../modules/payments/src/deposit-reconciliation/deposit-reconciliation.exceptions.repository.ts';
import { InvoicesLedgerRepository } from '../../modules/payments/src/invoices/invoices-ledger.repository.ts';
import { InvoicesController } from '../../modules/payments/src/invoices/invoices.controller.ts';
import { InvoicesService } from '../../modules/payments/src/invoices/invoices.service.ts';
import { InMemoryInvoicesRepository } from '../../modules/payments/src/invoices/invoices.repository.ts';
import { dataset } from '../checkout-one-screen/fixtures.mjs';
import { ValidatedBody } from '../../packages/permissions/src/guards/validated-body.ts';
import * as B from '../../modules/payments/src/request-schemas.ts';
const V = (schema, b) => ValidatedBody(schema, { strict: true }).transform(b);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tooling/checkout-one-screen/out');
const req = createRequire(import.meta.url);
const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js'));
const perms = (role) => [...(rbac.ROLE_PERMISSIONS?.[role] ?? [])];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const pg = await PGlite.create({ loadDataDir: true });
const db = kyselyFor(pg);
const t0 = Date.now(); const seeded = await seed(pg, db);
console.log(`seeded in ${Date.now() - t0} ms`, seeded, 'db', pg.dbname);

const audited = [];
const auditor = { record: async (c, i) => { audited.push({ at: new Date().toISOString(), tenantId: c.tenantId, userId: c.userId, ...i }); } };
const stRepo = new SettlementsScreenRepository(db, auditor);
const wsRepo = new ReconWorkspaceRepository(db, auditor);
const ivRepo = new InvoicesLedgerRepository(db, auditor);
const C = {
  st: new SettlementsScreenController(stRepo),
  ws: new ReconWorkspaceController(wsRepo, new ExceptionWorkflowService(new KyselyExceptionsRepository(db))),
  iv: new InvoicesController(new InvoicesService(new InMemoryInvoicesRepository()), ivRepo),
};

let tenant = 'pilot', lang = 'en', role = 'OWNER', fail = false;
const USERS = { OWNER: OWNER_USER, MANAGER: MANAGER_USER, FRONT_DESK: DESK_USER };
const session = () => { const t = tenant === 'empty' ? EMPTY : PILOT; return { tenantId: t, branchId: tenant === 'empty' ? BRANCH2 : BRANCH, userId: USERS[role] ?? OWNER_USER, role, permissions: perms(role), salonName: tenant === 'empty' ? 'New Salon' : 'Pilot Nail Salon' }; };
const principal = () => { const s = session(); return { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, role: s.role, permissions: s.permissions, fullName: role === 'OWNER' ? 'Linh Owner' : role === 'MANAGER' ? 'Mai Manager' : 'Vy Front Desk', email: null, subscriptionStatus: 'active' }; };
const unhandled = new Map(); const log = [];

/** the Nest exception filter, reduced: HttpException → its status + { error: { code, message, details } } */
async function call(fn) {
  try {
    const headers = {}; const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; } };
    const body = await fn(res);
    return { status: 200, body: body ?? null, headers };
  } catch (e) {
    const st = typeof e?.getStatus === 'function' ? e.getStatus() : e?.status ?? 500; const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
    const code = (r && typeof r === 'object' && r.code) || e?.apiCode || e?.code || (st === 403 ? 'PERMISSION_DENIED' : st === 401 ? 'AUTH_REQUIRED' : st === 404 ? 'RESOURCE_NOT_FOUND' : 'INTERNAL_ERROR');
    const message = (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : e?.message) || 'error';
    if (st >= 500) console.error('500', e);
    return { status: st, body: { error: { code, message, details: (r && typeof r === 'object' && r.details) || e?.details || {} }, code, message } };
  }
}
const FIN = /^\/pos\/(payments\/settlements|deposit-reconciliation\/workspace|invoices)/;
async function route(method, path, query, body) {
  const r = { ctx: session() }; const m = (re) => path.match(re);
  if (fail && FIN.test(path)) return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'This is temporarily unavailable. Please try again shortly.' } } };
  const Q = query;
  // ── Deposits & Settlements ──
  if (method === 'GET' && path === '/pos/payments/settlements') return call(() => C.st.list(r, Q.tab, Q.preset, Q.from, Q.to, Q.dateField, Q.search, Q.processor, Q.status, Q.bank, Q.sort, Q.page, Q.pageSize));
  if (method === 'GET' && path === '/pos/payments/settlements/summary') return call(() => C.st.summary(r, Q.preset, Q.from, Q.to, Q.dateField, Q.search, Q.processor, Q.status, Q.bank));
  if (method === 'GET' && path === '/pos/payments/settlements/export') return call(() => C.st.exportCsv(r, Q.tab, Q.preset, Q.from, Q.to, Q.dateField, Q.search, Q.processor, Q.status, Q.bank, Q.sort));
  let x;
  if (method === 'GET' && (x = m(/^\/pos\/payments\/settlements\/([^/]+)\/export$/))) return call(() => C.st.exportDetail(r, x[1]));
  if (method === 'GET' && (x = m(/^\/pos\/payments\/settlements\/([^/]+)\/transactions$/))) return call(() => C.st.transactions(r, x[1], Q.search, Q.page, Q.pageSize));
  if (method === 'GET' && (x = m(/^\/pos\/payments\/settlements\/([^/]+)$/))) return call(() => C.st.detail(r, x[1]));
  // ── AI Deposit Reconciliation (workspace) ──
  const W = '/pos/deposit-reconciliation/workspace';
  if (path.startsWith(W)) {
    const p = path.slice(W.length);
    if (method === 'GET' && p === '/kpis') return call(() => C.ws.kpis(r, Q.preset, Q.from, Q.to, Q.dateField, Q.search, Q.processor, Q.bankAccountId));
    if (method === 'GET' && p === '/settlements') return call(() => C.ws.settlements(r, Q.preset, Q.from, Q.to, Q.dateField, Q.search, Q.status, Q.processor, Q.bankAccountId, Q.sort, Q.open, Q.page, Q.pageSize));
    if (method === 'GET' && (x = p.match(/^\/settlements\/([^/]+)$/))) return call(() => C.ws.settlement(r, x[1]));
    if (method === 'GET' && p === '/deposits') return call(() => C.ws.deposits(r, Q.preset, Q.from, Q.to, Q.search, Q.bankAccountId, Q.unmatched, Q.page, Q.pageSize));
    if (method === 'GET' && (x = p.match(/^\/deposits\/([^/]+)\/suggestions$/))) return call(() => C.ws.suggestions(r, x[1]));
    if (method === 'GET' && (x = p.match(/^\/deposits\/([^/]+)$/))) return call(() => C.ws.deposit(r, x[1]));
    if (method === 'GET' && p === '/search') return call(() => C.ws.search(r, Q.search));
    if (method === 'POST' && p === '/allocations') return call(() => C.ws.allocate(r, V(B.RECON_ALLOCATION_BODY, body)));
    if (method === 'POST' && (x = p.match(/^\/allocations\/([^/]+)\/unmatch$/))) return call(() => C.ws.unmatch(r, x[1], V(B.RECON_UNMATCH_BODY, body)));
    if (method === 'GET' && p === '/bank-accounts') return call(() => C.ws.bankAccounts(r));
    if (method === 'POST' && p === '/bank-accounts') return call(() => C.ws.addBankAccount(r, V(B.RECON_BANK_ACCOUNT_BODY, body)));
    if (method === 'POST' && (x = p.match(/^\/bank-accounts\/([^/]+)$/))) return call(() => C.ws.updateBankAccount(r, x[1], V(B.RECON_BANK_ACCOUNT_UPDATE_BODY, body)));
    if (method === 'POST' && p === '/deposits') return call(() => C.ws.recordDeposit(r, V(B.RECON_DEPOSIT_BODY, body)));
    if (method === 'POST' && p === '/notes') return call(() => C.ws.note(r, V(B.RECON_WORKSPACE_NOTE_BODY, body)));
    if (method === 'GET' && p === '/fees') return call(() => C.ws.fees(r, Q.preset, Q.from, Q.to, Q.search, Q.processor, Q.feeCategory, Q.sort, Q.page, Q.pageSize));
    if (method === 'GET' && p === '/exceptions') return call(() => C.ws.exceptions(r, Q.preset, Q.from, Q.to, Q.search, Q.status, Q.severity, Q.class, Q.page, Q.pageSize));
    if (method === 'GET' && p === '/reviewers') return call(() => C.ws.reviewers(r));
    if (method === 'POST' && p === '/exceptions') return call(() => C.ws.raise(r, V(B.RECON_RAISE_BODY, body)));
    if (method === 'GET' && (x = p.match(/^\/exceptions\/([^/]+)$/))) return call(() => C.ws.exception(r, x[1]));
    if (method === 'POST' && (x = p.match(/^\/exceptions\/([^/]+)\/assign$/))) return call(() => C.ws.assign(r, x[1], V(B.RECON_WORKSPACE_ASSIGN_BODY, body)));
    if (method === 'POST' && (x = p.match(/^\/exceptions\/([^/]+)\/review$/))) return call(() => C.ws.review(r, x[1]));
    if (method === 'POST' && (x = p.match(/^\/exceptions\/([^/]+)\/resolve$/))) return call(() => C.ws.resolve(r, x[1], V(B.RECON_RESOLVE_BODY, body)));
    if (method === 'POST' && (x = p.match(/^\/exceptions\/([^/]+)\/reopen$/))) return call(() => C.ws.reopen(r, x[1]));
    if (method === 'GET' && (x = p.match(/^\/reports\/([^/]+)\/export$/))) return call(() => C.ws.reportCsv(r, x[1], Q.preset, Q.from, Q.to, Q.dateField, Q.processor, Q.bankAccountId, Q.status));
    if (method === 'GET' && (x = p.match(/^\/reports\/([^/]+)\/export-pdf$/))) return call((res) => C.ws.reportPdf(r, res, x[1], Q.preset, Q.from, Q.to, Q.dateField, Q.processor, Q.bankAccountId, Q.status));
    if (method === 'GET' && (x = p.match(/^\/reports\/([^/]+)$/))) return call(() => C.ws.report(r, x[1], Q.preset, Q.from, Q.to, Q.dateField, Q.processor, Q.bankAccountId, Q.status, Q.page, Q.pageSize));
  }
  // ── Invoices ──
  if (method === 'GET' && path === '/pos/invoices') return call(() => C.iv.list(r, Q.search, Q.status, Q.preset, Q.from, Q.to, Q.dateField, Q.amountMin, Q.amountMax, Q.customerId, Q.sort, Q.page, Q.pageSize));
  if (method === 'GET' && path === '/pos/invoices/summary') return call(() => C.iv.summary(r, Q.search, Q.preset, Q.from, Q.to, Q.dateField, Q.amountMin, Q.amountMax, Q.customerId));
  if (method === 'GET' && path === '/pos/invoices/export') return call(() => C.iv.exportCsv(r, Q.search, Q.status, Q.preset, Q.from, Q.to, Q.dateField, Q.amountMin, Q.amountMax, Q.customerId, Q.sort));
  if (method === 'GET' && path === '/pos/invoices/customers/lookup') return call(() => C.iv.lookup(r, Q.search));
  if (method === 'POST' && path === '/pos/invoices/new') return call(() => C.iv.createInvoice(r, V(B.INVOICE_DRAFT_BODY, body)));
  if (method === 'GET' && (x = m(/^\/pos\/invoices\/([^/]+)\/detail$/))) return call(() => C.iv.detail(r, x[1]));
  if (method === 'GET' && (x = m(/^\/pos\/invoices\/([^/]+)\/pdf$/))) return call((res) => C.iv.pdf(r, res, x[1], Q.disposition));
  if (method === 'POST' && (x = m(/^\/pos\/invoices\/([^/]+)\/edit$/))) return call(() => C.iv.edit(r, x[1], V(B.INVOICE_DRAFT_BODY, body)));
  if (method === 'POST' && (x = m(/^\/pos\/invoices\/([^/]+)\/send$/))) return call(() => C.iv.send(r, x[1], V(B.INVOICE_SEND_BODY, body)));
  if (method === 'POST' && (x = m(/^\/pos\/invoices\/([^/]+)\/payments$/))) return call(() => C.iv.recordPayment(r, x[1], V(B.INVOICE_PAYMENT_BODY, body)));
  if (method === 'POST' && (x = m(/^\/pos\/invoices\/([^/]+)\/void$/))) return call(() => C.iv.voidInvoice(r, x[1], V(B.INVOICE_VOID_BODY, body)));
  if (method === 'POST' && (x = m(/^\/pos\/invoices\/([^/]+)\/link-customer$/))) return call(() => C.iv.linkCustomer(r, x[1], V(B.INVOICE_LINK_CUSTOMER_BODY, body)));
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
  // a processor webhook delivering a new settlement batch (test only): created now, settled today
  if (u.pathname === '/__newSettlement') {
    const n = Number(u.searchParams.get('n') || 900); const sid = `5e710000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    await pg.query(`insert into payment_settlements (id, tenant_id, branch_id, payment_gateway_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, currency, status, settled_at, created_at, transaction_count, refunds_cents, adjustments_cents, event_id)
      values ($1,$2,$3,$2,'cardpointe',$4,10000,300,9700,'USD','settled', now(), now(), 1, 0, 0, $5)`, [sid, PILOT, BRANCH, `CP-NEW-${n}`, `evt_new_${n}`]);
    return send(200, { id: sid, ref: `CP-NEW-${n}` });
  }
  if (u.pathname === '/__sql') {
    const k = u.searchParams.get('k');
    const QQ = { allocations: `select count(*)::int n, coalesce(sum(amount_cents),0)::int s from reconciliation_allocations where tenant_id = '${PILOT}' and unmatched_at is null`,
      deposits: `select count(*)::int n from bank_deposits where tenant_id = '${PILOT}'`, invoices: `select count(*)::int n from invoices where tenant_id = '${PILOT}'`,
      payments: `select count(*)::int n, coalesce(sum(amount_cents),0)::int s from invoice_payments where tenant_id = '${PILOT}'`,
      accounts: `select nickname, status, is_default from bank_accounts where tenant_id = '${PILOT}' order by created_at`,
      unmatched: `select count(*)::int n from reconciliation_allocations where tenant_id = '${PILOT}' and unmatched_at is not null`,
      exceptions: `select title, status, resolution_note from reconciliation_exceptions where tenant_id = '${PILOT}' order by created_at`,
      latestInvoice: `select invoice_number, status, customer_id, bill_to_name, total_cents, voided_at, void_reason from invoices where tenant_id = '${PILOT}' order by created_at desc limit 1`,
      inv0002: `select invoice_number, status, customer_id, bill_to_name from invoices where tenant_id = '${PILOT}' and invoice_number = 'INV-0002'` };
    return send(200, (await pg.query(QQ[k] ?? 'select 1')).rows);
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
  const hit = await route(rq.method, path, query, body);
  if (hit) {
    if (Buffer.isBuffer(hit.body)) return send(hit.status, hit.body, hit.headers?.['content-type'] ?? 'application/octet-stream', hit.headers?.['content-disposition'] ? { 'content-disposition': hit.headers['content-disposition'] } : {});
    if (typeof hit.body === 'string') return send(hit.status, hit.body, 'text/csv; charset=utf-8');
    return send(hit.status, hit.body);
  }
  const ds = dataset('normal').route(rq.method, path, u.searchParams, body, { perms: session().permissions, branchId: session().branchId });
  if (ds !== undefined) return send(ds?.__status ?? 200, ds?.__status ? ds.body : ds);
  const k2 = `${rq.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`; unhandled.set(k2, (unhandled.get(k2) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness' } });
}).listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log('finance harness on', process.env.PORT || 4319));
