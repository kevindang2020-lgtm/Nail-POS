// e2e-customer-journey.mjs — the CUSTOMER self-service journey over REAL HTTP against the live NestJS API on a real
// Postgres engine (PGlite over the wire protocol). Drives:
//   owner seeds a service + technician  ->  customer SELF-REGISTERS  ->  logs in  ->  browses bookable services +
//   availability  ->  BOOKS an appointment with that technician  ->  sees it in their own list  ->  CHECKS IN.
// Connection proof (customer <-> tech): opens a direct pg client to the SAME database and confirms the booking landed
//   in `pos_tech_appointments` carrying the technician_id — the exact row the technician app reads as its schedule.
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
const PG = Number(process.env.CJ_PG_PORT || process.env.E2E_PG_PORT) || (GATE ? 5440 : 5441);
const APP = Number(process.env.CJ_APP_PORT) || 3002;
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
const snip = (j) => { try { return JSON.stringify(j).slice(0, 160); } catch { return String(j); } };
const mark = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' - ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
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
  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: '4', PORT: String(APP), AUTH_SESSION_SECRET: 'cj-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`${BASE}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) throw new Error('API did not start\n' + log.slice(-1200));
  console.log(`> API listening on :${APP}\n`);
}

try {
  if (!GATE) await boot();

  const rnd = Math.floor(1000 + Math.random() * 8999);
  const owner = {}, cust = {};

  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' }, owner);
  if (!mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS' && !!owner.cookie, `${r.status} ${r.json?.outcome || snip(r.json)}`)) { console.log('\nABORT: no owner session'); await teardown(); process.exit(1); }
  r = await req('POST', '/pos/services/categories', { name: 'CJ Nails ' + rnd, colorKey: 'gold' }, owner);
  const categoryId = r.json?.categoryId || r.json?.id; mark('owner creates a service category', r.status < 300 && !!categoryId, `${r.status} ${categoryId || snip(r.json)}`);
  r = await req('POST', '/pos/services', { name: 'CJ Manicure ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }, owner);
  const serviceId = r.json?.serviceId || r.json?.id; mark('owner creates a service', r.status < 300 && !!serviceId, `${r.status} ${serviceId || snip(r.json)}`);
  r = await req('POST', '/pos/technicians', { firstName: 'CJ', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }, owner);
  const technicianId = r.json?.technicianId || r.json?.id; mark('owner creates a technician (linked to the service)', r.status < 300 && !!technicianId, `${r.status} ${technicianId || snip(r.json)}`);

  const email = `cj${rnd}@cust.test`;
  r = await req('POST', '/customer/auth/register', { salonCode: 'PALACE', firstName: 'Casey', lastName: 'Customer', email, phone: `+1609${rnd}0123`, password: 'Cust!2345' });
  mark('customer self-registration (public endpoint, no session)', r.status < 300 && (r.json?.ok === true || r.json?.outcome === 'SUCCESS' || r.status === 201), `${r.status} ${snip(r.json)}`);

  r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: email, password: 'Cust!2345' }, cust);
  if (!mark('customer login', r.status === 200 && r.json?.outcome === 'SUCCESS' && !!cust.cookie, `${r.status} ${r.json?.outcome || snip(r.json)}`)) { console.log('\nABORT: no customer session'); await teardown(); process.exit(1); }

  r = await req('GET', '/customer/home', null, cust); mark('customer home loads (authed)', r.status === 200, `${r.status}`);
  r = await req('GET', '/customer/booking/options', null, cust);
  const optHasService = JSON.stringify(r.json || '').includes(serviceId);
  mark('booking options list the salon service', r.status === 200 && optHasService, `${r.status} hasService=${optHasService}`);

  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  r = await req('GET', `/customer/booking/availability?serviceId=${serviceId}&date=${date}&technicianId=${technicianId}`, null, cust);
  const slots = r.json?.slots || [];
  mark('availability returns open slots', r.status === 200 && Array.isArray(slots) && slots.length > 0, `${r.status} slots=${slots.length}`);
  let startTime = slots[0]?.startTime || slots[0]?.time || (typeof slots[0] === 'string' ? slots[0] : '');
  if (!/^\d{2}:\d{2}$/.test(startTime)) startTime = '10:00';
  r = await req('POST', '/customer/booking', { serviceId, technicianId, date, startTime }, cust);
  const appointmentId = r.json?.appointmentId;
  mark('customer books an appointment with the technician', r.status < 300 && !!appointmentId, `${r.status} ${appointmentId ? appointmentId + ' @' + startTime + ' w/ ' + (r.json?.technicianName || '') : snip(r.json)}`);

  r = await req('GET', '/customer/appointments', null, cust);
  const listed = !!appointmentId && JSON.stringify(r.json || '').includes(appointmentId);
  mark('appointment appears in the customer list', r.status === 200 && listed, `${r.status} listed=${listed}`);

  r = await req('POST', `/customer/appointments/${appointmentId}/check-in`, {}, cust);
  mark('customer self check-in', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  const c = new pg.Client({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres' });
  await c.connect();
  const row = (await c.query(`SELECT technician_id, customer_id, status FROM pos_tech_appointments WHERE id = $1`, [appointmentId])).rows[0];
  await c.end();
  mark('booking persisted to pos_tech_appointments with the technician_id (tech app schedule source)',
    !!row && String(row.technician_id) === String(technicianId), row ? `tech=${row.technician_id} status=${row.status}` : 'no row');

  console.log(`\n${fail === 0 ? 'CUSTOMER JOURNEY ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('e2e-customer-journey fatal:', e?.message || e);
  await teardown();
  process.exit(1);
}
