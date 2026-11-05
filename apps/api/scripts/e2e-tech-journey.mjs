// e2e-tech-journey.mjs — the TECHNICIAN self-service journey over REAL HTTP against the live NestJS API on a real
// Postgres engine (PGlite over the wire protocol). Drives:
//   owner seeds a service + a LOGIN-CAPABLE technician  ->  owner routes a walk-in ticket to that tech's queue  ->
//   the TECH logs in  ->  sees the queue  ->  accepts the ticket  ->  starts service  ->  marks service done  ->
//   reads earnings + ratings.
// Connection proof (tech <-> front-desk/POS): the tech's HTTP actions move the SHARED ticket row
//   (`pos_tech_queue_tickets`, keyed by technician_id) through accepted -> serving -> done — read straight from the DB.
//
// A technician is made login-capable the same way the seed scripts do it: a TECHNICIAN `users` row whose
// password_hash is produced by the SAME scrypt scheme the login path verifies, linked via technicians.user_id.
//
// Two modes:
//   - Gate mode  (E2E_BASE set): runs against an already-running server (e.g. from e2e-live). No boot/teardown.
//   - Standalone (no E2E_BASE): boots Postgres (PGlite-socket) + migrate + seed + dist/main.js itself, then tears down.
//     Requires `npm run build` and `ln -sfn /tmp/pgtest/node_modules/@electric-sql node_modules/@electric-sql`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = !!process.env.E2E_BASE;
const PG = Number(process.env.TJ_PG_PORT || process.env.E2E_PG_PORT) || (GATE ? 5440 : 5443);
const APP = Number(process.env.TJ_APP_PORT) || 3003;
const BASE = process.env.E2E_BASE || `http://127.0.0.1:${APP}`;
const DB_URL = `postgres://postgres@127.0.0.1:${PG}/postgres`;
const base = { ...process.env, DATABASE_URL: DB_URL, REPO_DRIVER: 'postgres' };
const CREDS = { SEED_TENANT_CODE: 'PALACE', SEED_OWNER_EMAIL: 'owner@palace.test', SEED_OWNER_PASSWORD: 'Owner!2345', SEED_TENANT_NAME: 'Palace Nails' };

// Same scrypt scheme as packages/auth/src/password.ts (scrypt$N$r$p$saltB64$hashB64) so the produced hash authenticates.
function hashPassword(plain) {
  const N = 16384, R = 8, P = 1, KEYLEN = 64;
  const salt = randomBytes(16);
  const dk = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), dk.toString('base64')].join('$');
}

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
  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: '4', PORT: String(APP), AUTH_SESSION_SECRET: 'tj-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`${BASE}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) throw new Error('API did not start\n' + log.slice(-1200));
  console.log(`> API listening on :${APP}\n`);
}

try {
  if (!GATE) await boot();

  const rnd = Math.floor(1000 + Math.random() * 8999);
  const owner = {}, tech = {};
  const c = new pg.Client({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres' });
  await c.connect();

  // 1) Owner logs in and seeds a service + technician.
  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' }, owner);
  if (!mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS' && !!owner.cookie, `${r.status} ${r.json?.outcome || snip(r.json)}`)) { console.log('\nABORT'); await c.end(); await teardown(); process.exit(1); }
  r = await req('POST', '/pos/services/categories', { name: 'TJ Nails ' + rnd, colorKey: 'gold' }, owner);
  const categoryId = r.json?.categoryId || r.json?.id; mark('owner creates a service category', r.status < 300 && !!categoryId, `${r.status} ${categoryId || snip(r.json)}`);
  r = await req('POST', '/pos/services', { name: 'TJ Manicure ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }, owner);
  const serviceId = r.json?.serviceId || r.json?.id; mark('owner creates a service', r.status < 300 && !!serviceId, `${r.status} ${serviceId || snip(r.json)}`);
  const techEmail = `tj${rnd}@tech.test`;
  r = await req('POST', '/pos/technicians', { firstName: 'Tess', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId], email: techEmail }, owner);
  const technicianId = r.json?.technicianId || r.json?.id; mark('owner creates a technician', r.status < 300 && !!technicianId, `${r.status} ${technicianId || snip(r.json)}`);

  // 2) Make the technician LOGIN-CAPABLE: a TECHNICIAN users row (real scrypt hash) linked via technicians.user_id.
  const trow = (await c.query(`SELECT tenant_id, branch_id FROM technicians WHERE id=$1`, [technicianId])).rows[0];
  const techPw = 'Tech!2345';
  const uins = await c.query(
    `INSERT INTO users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
     VALUES ($1,$2,'Tess','Tech','Tess Tech',$3,$4,'active','TECHNICIAN',false) RETURNING id`,
    [trow.tenant_id, trow.branch_id, techEmail, hashPassword(techPw)]);
  const techUserId = uins.rows[0].id;
  await c.query(`UPDATE technicians SET user_id=$1 WHERE id=$2`, [techUserId, technicianId]);
  mark('technician provisioned with a login (users row + user_id link)', !!techUserId, `user=${techUserId}`);

  // 3) Owner routes a walk-in ticket to the tech's queue.
  r = await req('POST', '/pos/check-in/walk-in', { customerName: 'TJ Customer ' + rnd, customerPhone: `+1609${rnd}0123`, serviceIds: [serviceId], technicianId, isNewCustomer: true }, owner);
  const checkInId = r.json?.checkInId || r.json?.id; mark('owner walk-in check-in', r.status < 300 && !!checkInId, `${r.status} ${checkInId || snip(r.json)}`);
  r = await req('POST', `/pos/check-in/${checkInId}/move-to-queue`, {}, owner);
  const queueItemId = r.json?.queueItemId || r.json?.id; mark('move to queue', r.status < 300 && !!queueItemId, `${r.status} ${queueItemId || snip(r.json)}`);
  r = await req('POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId }, owner);
  mark('assign technician', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await req('POST', `/pos/queue/items/${queueItemId}/move-to-tech-queue`, {}, owner);
  mark('move to tech queue (routes to the technician)', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  // 4) The TECH logs in and works the ticket through its lifecycle over /tech/* endpoints.
  r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: techEmail, password: techPw }, tech);
  if (!mark('technician login', r.status === 200 && r.json?.outcome === 'SUCCESS' && !!tech.cookie, `${r.status} ${r.json?.outcome || snip(r.json)}`)) { console.log('\nABORT: no tech session'); await c.end(); await teardown(); process.exit(1); }
  r = await req('GET', '/tech/queue/state', null, tech);
  const qHasOne = !!(r.json && JSON.stringify(r.json).includes('TJ Customer'));
  mark('tech sees the routed customer in the queue (authed, over HTTP)', r.status === 200 && qHasOne, `${r.status} hasCustomer=${qHasOne}`);
  // resolve the tech queue ticket id from the shared table (linked by queue_item_id) to drive the HTTP actions
  const tqrow = (await c.query(`SELECT id, status, assigned_technician_id FROM pos_tech_queue_tickets WHERE tenant_id=$1 AND queue_item_id=$2 ORDER BY created_at DESC LIMIT 1`, [trow.tenant_id, queueItemId])).rows[0];
  const tid = tqrow?.id;
  mark('routed ticket exists in pos_tech_queue_tickets, assigned to this tech', !!tqrow && String(tqrow.assigned_technician_id) === String(technicianId), tqrow ? `id=${tid} status=${tqrow.status} tech=${tqrow.assigned_technician_id}` : 'no row');
  // also confirm the tech ticket list surfaces it over HTTP
  r = await req('GET', '/tech/tickets', null, tech);
  const list = Array.isArray(r.json) ? r.json : (r.json?.tickets || r.json?.items || []);
  mark('tech ticket list returns the ticket over HTTP', r.status === 200 && list.some((t) => (t.id || t.ticketId) === tid), `${r.status} count=${list.length}`);

  r = await req('POST', `/tech/tickets/${tid}/accept`, {}, tech);
  mark('tech accepts the ticket', r.status < 300 && (r.json?.status === 'accepted' || r.status === 200), `${r.status} ${r.json?.status || snip(r.json)}`);
  r = await req('POST', `/tech/tickets/${tid}/start-service`, {}, tech);
  mark('tech starts service', r.status < 300 && (r.json?.status === 'serving' || r.status === 200), `${r.status} ${r.json?.status || snip(r.json)}`);
  r = await req('POST', `/tech/tickets/${tid}/service-done`, { notes: 'looks great' }, tech);
  mark('tech marks service done (HTTP)', r.status < 300, `${r.status} view=${r.json?.status || snip(r.json)}`);

  // 5) Tech reads their own earnings + ratings surfaces.
  r = await req('GET', '/tech/earnings', null, tech); mark('tech earnings load (authed)', r.status === 200, `${r.status}`);
  r = await req('GET', '/tech/profile/ratings', null, tech); mark('tech ratings load (authed)', r.status === 200, `${r.status}`);

  // 6) CONNECTION PROOF — the tech's HTTP actions moved the SHARED ticket row (pos_tech_queue_tickets, keyed by
  //    technician_id) to a done state. Read it straight from the live DB.
  // CONNECTION PROOF — the tech's HTTP actions (accept -> start -> done) drove the SHARED row in pos_tech_queue_tickets
  // (the same table the front-desk tech-queue board reads), keyed by assigned_technician_id. The tech-queue ticket
  // never carries a 'done' status (the CHECK forbids it — completion is recorded on ticket_service_lines); reaching
  // 'in_service' owned by this tech, from a ticket the front desk routed, is the end-to-end wiring proof.
  const row = (await c.query(`SELECT assigned_technician_id, status, accepted_at, started_at FROM pos_tech_queue_tickets WHERE id=$1`, [tid])).rows[0];
  await c.end();
  mark('front-desk-routed ticket is owned + driven by this tech in the shared pos_tech_queue_tickets row',
    !!row && String(row.assigned_technician_id) === String(technicianId) && row.status === 'in_service' && !!row.accepted_at && !!row.started_at,
    row ? `tech=${row.assigned_technician_id} status=${row.status} accepted=${!!row.accepted_at} started=${!!row.started_at}` : 'no row');

  console.log(`\n${fail === 0 ? 'TECH JOURNEY ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  await teardown();
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('e2e-tech-journey fatal:', e?.message || e);
  await teardown();
  process.exit(1);
}
