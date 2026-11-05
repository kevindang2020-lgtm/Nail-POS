// e2e-owner-journey.mjs — the OWNER aggregation/oversight journey over REAL HTTP against the live NestJS API on a real
// Postgres engine (PGlite over the wire protocol). The owner app is read-heavy: it surfaces what the other apps write.
// This proves, end-to-end, that the owner actually SEES live data over HTTP:
//   owner logs in -> every owner read surface returns 200 on the live DB -> owner creates a technician and SEES it in
//   Staff Performance -> a booking is created and the owner SEES it in Booking Overview (+ DB proof on the shared
//   pos_tech_appointments table) -> owner records an expense and SEES it in Expenses + Summary -> that mutation appears
//   in the owner Audit log.
//
// Two modes:
//   - Gate mode  (E2E_BASE set): runs against an already-running server (e.g. from e2e-live). No boot/teardown.
//   - Standalone (no E2E_BASE): boots Postgres (PGlite-socket) + migrate + seed + dist/main.js itself, then tears down.
//     Requires `npm run build` and `ln -sfn /tmp/pgtest/node_modules/@electric-sql node_modules/@electric-sql`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = !!process.env.E2E_BASE;
const PG = Number(process.env.OJ_PG_PORT || process.env.E2E_PG_PORT) || (GATE ? 5440 : 5445);
const APP = Number(process.env.OJ_APP_PORT) || 3005;
const BASE = process.env.E2E_BASE || `http://127.0.0.1:${APP}`;
const DB_URL = `postgres://postgres@127.0.0.1:${PG}/postgres`;
const base = { ...process.env, DATABASE_URL: DB_URL, REPO_DRIVER: 'postgres' };
const CREDS = { SEED_TENANT_CODE: 'PALACE', SEED_OWNER_EMAIL: 'owner@palace.test', SEED_OWNER_PASSWORD: 'Owner!2345', SEED_TENANT_NAME: 'Palace Nails' };

const sh = (cmd, args, extra = {}) => new Promise((res) => {
  const p = spawn(cmd, args, { cwd: API, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('exit', (code) => res({ code, o }));
});

let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 140); } catch { return String(j); } };
const mark = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' - ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
// first array found among the body itself or any of the candidate keys (owner endpoints vary: bare array vs wrapped)
const asArray = (j, keys) => Array.isArray(j) ? j : (keys.map((k) => j?.[k]).find(Array.isArray) || []);
async function req(method, path, body, jar) {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar?.cookie ? { Cookie: jar.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc && jar) { const m = sc.match(/aps_session=[^;]+/); if (m) jar.cookie = m[0]; }
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}

let db = null, server = null, app = null;
const teardown = async () => { try { app?.kill('SIGKILL'); } catch {} try { await server?.stop(); } catch {} try { await db?.close(); } catch {} };

async function boot() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  console.log(`> live Postgres (PGlite) on :${PG}`);
  db = await PGlite.create({ extensions: { pgcrypto } });
  server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1', maxConnections: 20 });
  await server.start();
  let r = await sh('node', ['scripts/migrate.mjs']); if (r.code) throw new Error('migrate failed\n' + r.o.slice(-800));
  console.log('> migrate: ok');
  r = await sh('npx', ['tsx', 'scripts/seed.ts'], CREDS); if (r.code) throw new Error('seed failed\n' + r.o.slice(-800));
  console.log('> seed: ok (PALACE + owner@palace.test)');
  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: '4', PORT: String(APP), AUTH_SESSION_SECRET: 'oj-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`${BASE}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) throw new Error('API did not start\n' + log.slice(-1200));
  console.log(`> API listening on :${APP}\n`);
}

try {
  if (!GATE) await boot();
  const rnd = Math.floor(1000 + Math.random() * 8999);
  const today = new Date().toISOString().slice(0, 10);
  const owner = {};

  // 1) Owner logs in.
  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' }, owner);
  if (!mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS' && !!owner.cookie, `${r.status} ${r.json?.outcome || snip(r.json)}`)) { console.log('\nABORT'); await teardown(); process.exit(1); }

  // 2) BREADTH — every owner read surface returns 200 on the live DB.
  const reads = [
    '/owner/context', '/owner/dashboard/state', '/owner/salons/overview', '/owner/branches', '/owner/branches/performance',
    '/owner/branches/comparison', '/owner/bookings/overview', '/owner/bookings/trend', '/owner/bookings/drill-down',
    '/owner/staff/performance', '/owner/staff/attendance', '/owner/finance/summary', '/owner/finance/payment-mix',
    '/owner/reports', '/owner/alerts', '/owner/alerts/summary', '/owner/audit', '/owner/expenses', '/owner/expenses/summary',
    '/owner/profile', '/owner/settings',
  ];
  const bad = [];
  for (const p of reads) {
    let x = await req('GET', p, null, owner);
    // one retry on a non-200: these reads fan out into several parallel sub-queries and the live gate runs a pool of 1,
    // so a tight sequential sweep can transiently starve a connection. A clean retry confirms the endpoint itself is fine.
    if (x.status !== 200) { await new Promise((s) => setTimeout(s, 300)); x = await req('GET', p, null, owner); }
    if (x.status !== 200) bad.push(`${p}=${x.status}`);
  }
  mark(`all ${reads.length} owner read surfaces return 200 over HTTP`, bad.length === 0, bad.length ? bad.join(' ') : `${reads.length}/${reads.length}`);

  // 3) CONNECTION — Staff Performance reflects the live technicians table. Owner creates a technician, then sees it.
  r = await req('POST', '/pos/services/categories', { name: 'OJ Nails ' + rnd, colorKey: 'gold' }, owner);
  const categoryId = r.json?.categoryId || r.json?.id;
  r = await req('POST', '/pos/services', { name: 'OJ Manicure ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }, owner);
  const serviceId = r.json?.serviceId || r.json?.id;
  r = await req('POST', '/pos/technicians', { firstName: 'Olivia', lastName: 'Owner' + rnd, status: 'active', serviceIds: [serviceId], email: `oj${rnd}@tech.test` }, owner);
  const technicianId = r.json?.technicianId || r.json?.id;
  mark('owner provisions a service + technician (HTTP)', !!categoryId && !!serviceId && !!technicianId, `tech=${technicianId || 'none'}`);
  r = await req('GET', '/owner/staff/performance', null, owner);
  const staff = asArray(r.json, ['topTechnicians', 'technicians', 'staff', 'rows', 'items']);
  mark('Staff Performance shows the newly-created technician (tech → owner)', r.status === 200 && staff.some((t) => (t.technicianId || t.id) === technicianId), `${r.status} count=${staff.length}`);

  // 4) CONNECTION — Booking Overview reflects the live pos_tech_appointments table. Create a booking, then see it.
  const custName = 'OJ Booking ' + rnd;
  r = await req('POST', '/pos/booking/appointments', { customerName: custName, serviceIds: [serviceId], date: today, startTime: '10:00', technicianId, source: 'manual', managerOverride: true }, owner);
  const appointmentId = r.json?.appointmentId || r.json?.id;
  mark('a booking is created via the live booking flow (HTTP)', r.status < 300 && !!appointmentId, `${r.status} ${appointmentId || snip(r.json)}`);
  r = await req('GET', '/owner/bookings/overview', null, owner);
  mark('Booking Overview loads with the booking counted', r.status === 200 && (r.json?.totalBookings ?? 0) >= 1, `${r.status} total=${r.json?.totalBookings}`);
  r = await req('GET', '/owner/bookings/drill-down', null, owner);
  const appts = asArray(r.json, ['rows', 'appointments', 'items', 'bookings']);
  mark('Booking Overview drill-down shows this specific booking (booking → owner)', r.status === 200 && appts.some((a) => a.customerName === custName), `${r.status} count=${appts.length}`);

  // DB proof — the booking endpoint wrote the shared pos_tech_appointments table the owner reads.
  const c = new pg.Client({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres' });
  await c.connect();
  const apptRow = (await c.query(`SELECT id, technician_id, status FROM pos_tech_appointments WHERE customer_name=$1 ORDER BY created_at DESC LIMIT 1`, [custName])).rows[0];
  mark('booking persisted to shared pos_tech_appointments (assigned to the tech)', !!apptRow && String(apptRow.technician_id) === String(technicianId), apptRow ? `id=${apptRow.id} status=${apptRow.status}` : 'no row');

  // 5) CONNECTION — Expenses round-trip + Audit. Owner records an expense, sees it in Expenses + Summary, and the
  //    mutation appears in the owner Audit log.
  const auditBefore = asArray((await req('GET', '/owner/audit?limit=200', null, owner)).json, ['entries', 'rows', 'items']).length;
  const vendor = 'OJ Vendor ' + rnd;
  r = await req('POST', '/owner/expenses', { category: 'Supplies', amountCents: 12345, incurredOn: today, vendor, description: 'OJ test expense' }, owner);
  const expenseId = r.json?.id;
  mark('owner records an expense (HTTP)', r.status < 300 && !!expenseId, `${r.status} ${expenseId || snip(r.json)}`);
  r = await req('GET', '/owner/expenses', null, owner);
  const expenses = asArray(r.json, ['expenses', 'items', 'rows']);
  mark('Expenses list shows the new expense (owner write → read)', r.status === 200 && expenses.some((e) => e.id === expenseId), `${r.status} count=${expenses.length}`);
  r = await req('GET', '/owner/expenses/summary', null, owner);
  mark('Expenses summary reflects the new expense', r.status === 200 && (r.json?.totalCents ?? 0) >= 12345 && (r.json?.count ?? 0) >= 1, `${r.status} total=${r.json?.totalCents} count=${r.json?.count}`);
  r = await req('GET', '/owner/audit?limit=200', null, owner);
  const auditAfter = asArray(r.json, ['entries', 'rows', 'items']);
  const sawExpense = auditAfter.some((a) => (a.entityId === expenseId) || (a.action === 'expense_create' && JSON.stringify(a).includes(String(expenseId))));
  mark('Audit log captured the expense mutation (mutation → owner audit)', r.status === 200 && auditAfter.length > auditBefore && sawExpense, `${r.status} before=${auditBefore} after=${auditAfter.length} sawExpense=${sawExpense}`);

  await c.end();
  console.log(`\n${fail === 0 ? 'OWNER JOURNEY ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('e2e-owner-journey fatal:', e?.message || e);
  await teardown();
  process.exit(1);
}
