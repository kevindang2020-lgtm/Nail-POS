#!/usr/bin/env node
// live-phase13-offline.mjs — BUILD_PLAN Phase 13 (Constitution 6 §16–23, §254–257): the Technician App OFFLINE, proved in a
// real browser (headless Chromium) against the real compiled API and the local PostgreSQL. Nothing is stubbed: the BUILT
// tech-web bundle is served behind a same-origin static + API proxy (the session cookie flows as in production).
//   1. fixtures: a proof branch, a technician (login-capable) and a manager; the manager checks a walk-in in, routes it to
//      the technician's queue; the technician accepts it;
//   2. the technician opens the Queue (More → Queue / Turn) and the ticket — both are read through the query layer and
//      written to the device read cache (IndexedDB), secret-free;
//   3. the network is CUT (Playwright offline): the queue still shows, with "You're offline — showing saved data. Last
//      updated …";
//   4. offline, the technician opens the ticket and taps Start Service → "pending" is shown, nothing reaches the server
//      (the DB row is still `accepted`), the journal entry sits in IndexedDB with its Idempotency-Key;
//   5. the network RETURNS → the journal replays ONCE (one start-service request from the browser, one api_idempotency
//      row, the ticket is in service), the pending note clears; a second `online` event sends nothing more;
//   6. realtime resumes: the manager routes a SECOND walk-in to the technician → it appears on the open Queue screen by
//      itself (no tap on Refresh);
//   7. cleanup: the proof branch, people, sessions and idempotency rows.
// Run (apps/api built; apps/tech-web built with `npx vite build`):
//   DATABASE_URL=postgres://postgres@localhost:5432/postgres node scripts/live-phase13-offline.mjs
// Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import { existsSync, statSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const TECH_DIST = join(API_DIR, '..', 'tech-web', 'dist');
if (!existsSync(join(TECH_DIST, 'index.html'))) { console.error(`build first: ${TECH_DIST}/index.html is missing (npx vite build)`); process.exit(2); }
const API_PORT = Number(process.env.P13C_API_PORT) || 3064, TECH_PORT = Number(process.env.P13C_TECH_PORT) || 4264;
const API = `http://127.0.0.1:${API_PORT}`, TECH = `http://127.0.0.1:${TECH_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/59f94190-34ea-56af-bac0-4d60a89b63f0/scratchpad/p13/shots-offline';
mkdirSync(SHOTS, { recursive: true });
const CHROMIUM = process.env.CHROMIUM_PATH || (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) for (const sub of ['chrome-linux64', 'chrome-linux']) { const p = join(root, d, sub, 'chrome'); if (existsSync(p)) return p; } } catch { /* none */ }
  return undefined;
})();

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);
const waitFor = async (fn, ms = 10_000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(200); } return v; };

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase13 Offline Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id).catch(() => undefined);

const tag = String(Date.now()).slice(-6);
const PW = 'Phase13!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const BA = randomUUID(), TECHU = randomUUID(), MGR = randomUUID(), TECHID = randomUUID(), CAT = randomUUID(), SVC = randomUUID();
const email = (k) => `phase13c-${k}-${tag}@aipowersalon.test`;
const people = [TECHU, MGR];
const GUEST1 = `Offline Guest ${tag}`, GUEST2 = `Realtime Guest ${tag}`;

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, $3, 'active', 'America/New_York', '13 Offline Way')`, [BA, TA, `Live Phase13 Offline Proof ${tag}`]);
const addUser = async (id, role, key, level) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'P13','Offline','P13 Offline',$4,$5,'active',$6)`, [id, TA, BA, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [TA, BA, id, level]);
};
await addUser(TECHU, 'TECHNICIAN', 'tech', 'staff');
await addUser(MGR, 'MANAGER', 'mgr', 'manager');
await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1, $2, $3, $4, 'Oona', 'P13', $5, 'active')`, [TECHID, TA, BA, TECHU, `Oona P13${tag}`]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1, $2, $3, 'P13 Offline Nails')`, [CAT, TA, BA]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1, $2, $3, $4, 'P13 Offline Manicure', 30, 2500)`, [SVC, TA, BA, CAT]);
// a technician hired after migration 631 is exact-service: she is approved for the service she serves (the manager's
// roster list / an approved skill request — the same row the one writer grants); without it accept is a 422 by design
await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary, granted_via) values ($1, $2, $3, $4, false, 'seed')`, [TA, BA, TECHID, SVC]);

// ── processes: the compiled API + a same-origin static/proxy server for the built tech-web ───────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(API_PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true', PROCESS_ROLE: 'all' };
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'WORKER_JOB_CLASSES']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' });
let apiProc = null, apiErr = '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
function sameOrigin(dist) {
  return http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1));
    const isFile = path !== '/' && existsSync(file) && statSync(file).isFile();
    const wantsHtml = req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''));
    if (isFile || wantsHtml) {
      const f = isFile ? file : join(dist, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
    delete headers.connection; delete headers['keep-alive'];
    const pr = http.request({ hostname: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers }, (br) => {
      const sc = br.headers['set-cookie'];
      if (sc) br.headers['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/ig, '').replace(/;\s*Partitioned/ig, '').replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*SameSite=None/ig, '; SameSite=Lax'));
      try { res.writeHead(br.statusCode || 502, br.headers); } catch { /* closed */ }
      br.pipe(res);
    });
    pr.on('error', () => { try { res.writeHead(502); res.end('proxy error'); } catch { /* closed */ } });
    req.pipe(pr);
  });
}
const techSrv = sameOrigin(TECH_DIST);

// ── the manager (front desk) over the API, cookie session ─────────────────────────────────────────────────────────────
const jfetch = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
async function staff(key) {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = () => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), origin: TECH });
  const l = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: hdr(), body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }) }); keep(l);
  const s = await fetch(API + '/api/v1/auth/select-branch', { method: 'POST', headers: hdr(), body: JSON.stringify({ branchId: BA }) }); keep(s);
  return { ok: l.status === 200, detail: `login ${l.status} select ${s.status}`, call: (method, path, body) => fetch(API + '/api/v1' + path, { method, headers: hdr(), body: body ? JSON.stringify(body) : undefined }).then(jfetch) };
}
/** walk-in → queue → assigned to the technician; returns the technician's ticket id */
async function routeWalkIn(mgr, name, phoneTail) {
  const w = await mgr.call('POST', '/pos/check-in/walk-in', { customerName: name, customerPhone: '2155' + phoneTail, isNewCustomer: true, serviceIds: [SVC], technicianId: TECHID });
  const checkInId = w.body?.checkInId || w.body?.id;
  const mv = await mgr.call('POST', `/pos/check-in/${checkInId}/move-to-queue`, {});
  const queueItemId = mv.body?.queueItemId || mv.body?.id || mv.body?.queueItem?.id;
  const as = await mgr.call('POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId: TECHID });
  const mt = await mgr.call('POST', `/pos/queue/items/${queueItemId}/move-to-tech-queue`, {});   // projects it into the technician's queue
  const row = await waitFor(async () => (await q(`select id, status from pos_tech_queue_tickets where tenant_id = $1 and assigned_technician_id = $2 and customer_name = $3 order by created_at desc limit 1`, [TA, TECHID, name]))[0], 5000);
  return { ok: w.status < 300 && mv.status < 300 && as.status < 300 && mt.status < 300 && !!row, detail: `walk-in ${w.status} move ${mv.status} assign ${as.status} to-tech ${mt.status} ${mt.status >= 300 ? short(mt.body) : ''}`, ticketId: row?.id, queueItemId };
}

let browser = null;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* */ }
  try { techSrv.close(); } catch { /* */ }
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  await q(`delete from api_idempotency where scope like any($1::text[])`, [people.map((u) => `%:${u}`)]).catch(() => undefined);
  await q(`delete from realtime_stream_tickets where user_id = any($1::text[])`, [people]).catch(() => undefined);
  for (const u of people) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'authorization_denials']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [['tech', 'mgr'].map(email)]).catch(() => undefined);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [people]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from branches where id = $2)
      + (select count(*)::int from api_idempotency where scope like any($3::text[])) as n`, [people, BA, people.map((u) => `%:${u}`)]))[0].n;
  check('7. cleanup: the proof branch, its people, sessions and idempotency rows are gone', a.removed && left === 0, `branch ${a.removed} [${(a.kept ?? []).join(', ')}] left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 6 * 60_000);

/** read the device store (IndexedDB 'aps-offline' / 'kv') inside the page */
const readDeviceStore = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('aps-offline', 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
  req.onsuccess = () => {
    const db = req.result; const out = {};
    const t = db.transaction('kv', 'readonly'); const s = t.objectStore('kv');
    const c = s.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out[String(cur.key)] = cur.value; cur.continue(); } };
    t.oncomplete = () => resolve(out); t.onerror = () => resolve(out);
  };
  req.onerror = () => resolve({});
}));

try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, apiErr.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  await new Promise((r) => techSrv.listen(TECH_PORT, '127.0.0.1', r));

  // 1. the front desk routes a walk-in to the technician
  const mgr = await staff('mgr');
  const w1 = await routeWalkIn(mgr, GUEST1, '55' + tag.slice(-5));
  check('1. a manager checks a walk-in in and routes it to the technician’s queue', mgr.ok && w1.ok, `${mgr.detail}; ${w1.detail}`);

  // 2. the technician signs in (web, cookie) in the browser and accepts the ticket
  browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 160)));
  const startRequests = []; const streamOpens = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/tech\/tickets\/[^/]+\/start-service/.test(r.url())) startRequests.push({ at: Date.now(), key: r.headers()['idempotency-key'] || null });
    if (/\/tech\/stream/.test(r.url())) streamOpens.push(Date.now());
  });
  await page.goto(TECH + '/', { waitUntil: 'domcontentloaded' });
  const login = await page.evaluate(async ({ salon, id, pw, branch }) => {
    const h = { 'content-type': 'application/json' };
    const l = await fetch('/api/v1/auth/login', { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify({ portal: 'tenant', salonCode: salon, identifier: id, password: pw }) });
    const body = await l.json().catch(() => null);
    let sel = 0; if (body?.principal?.needsBranchSelection || body?.outcome === 'BRANCH_SELECTION_REQUIRED') sel = (await fetch('/api/v1/auth/select-branch', { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify({ branchId: branch }) })).status;
    return { status: l.status, sel, hasTokenInBody: !!(body?.token || body?.accessToken) };
  }, { salon: SALON, id: email('tech'), pw: PW, branch: BA });
  const acc = await page.evaluate(async (tid) => (await fetch(`/api/v1/tech/tickets/${tid}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: '{}' })).status, w1.ticketId);
  const st1 = (await q(`select status from pos_tech_queue_tickets where id = $1`, [w1.ticketId]))[0]?.status;
  check('2. the technician signs in in the browser (web: cookie, no token in the body) and accepts the ticket', login.status === 200 && !login.hasTokenInBody && acc < 300 && /accept/.test(String(st1)), `login ${login.status} select ${login.sel} accept ${acc} status ${st1}`);

  // the app: More → Queue / Turn
  const openQueue = async () => {
    if (await page.getByText('Tech Queue').first().isVisible().catch(() => false)) return;
    await page.getByRole('button', { name: 'More', exact: true }).first().click();
    await page.getByText('Queue / Turn').first().click();
    await page.getByText('Tech Queue').first().waitFor({ timeout: 10_000 });
  };
  await page.goto(TECH + '/', { waitUntil: 'domcontentloaded' });
  await openQueue();
  const inQueue = await page.getByText(GUEST1).first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
  // open the ticket online (from the queue when it lists it, else from the Tickets tab) so it is cached too
  let opened = false;
  if (inQueue) { await page.getByRole('button', { name: new RegExp(`^Ticket .*${GUEST1}`) }).first().click(); opened = true; }
  else {
    await page.getByRole('button', { name: 'Back' }).first().click().catch(() => undefined);
    await page.getByRole('button', { name: 'Tickets', exact: true }).first().click();
    await page.getByText(GUEST1).first().click({ timeout: 8_000 }).then(() => { opened = true; }, () => undefined);
  }
  const startBtn = page.getByRole('button', { name: 'Start Service' }).first();
  const startVisible = opened && await startBtn.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check('   the Queue and the accepted ticket load online (through the query layer)', startVisible, `in queue ${inQueue}, ticket opened ${opened}`);
  // back, then the Queue again (the ticket is a pushed screen: Back returns to the tab), and let the persister write
  await page.getByRole('button', { name: 'Back' }).first().click();
  await openQueue();
  await page.getByText(GUEST1).first().waitFor({ timeout: 8_000 }).catch(() => undefined);
  await sleep(1200);
  const store1 = await readDeviceStore(page);
  const cacheKeys = Object.keys(store1).filter((k) => k.startsWith('aps.qcache.v1:tech:'));
  const blob = cacheKeys.map((k) => String(store1[k])).join('');
  check('   the read cache is in IndexedDB, scoped to realm:salon:branch:user, holding the queue + ticket and no token / password / card field',
    cacheKeys.length === 1 && cacheKeys[0].includes(encodeURIComponent(TA)) && cacheKeys[0].includes(encodeURIComponent(BA)) && blob.includes(GUEST1) && !/"(?:[a-z]*token|password|pin|otp|cvv|cardNumber|last4)"\s*:/i.test(blob),
    `${cacheKeys.length} key(s), ${blob.length} bytes`);

  // 3. cut the network
  await ctx.setOffline(true);
  const offlineBanner = await page.getByText(/You’re offline — showing saved data\. Last updated/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
  const stillThere = await page.getByText('Tech Queue').first().isVisible().catch(() => false);
  const bannerText = await page.getByText(/Last updated/).first().textContent().catch(() => '');
  await page.screenshot({ path: join(SHOTS, '3-offline-queue.png'), fullPage: true });
  check('3. network cut → the cached Queue still shows with "You’re offline — showing saved data. Last updated …"', stillThere && (offlineBanner || /Last updated/.test(bannerText || '')), short(bannerText));

  // 4. offline: open the ticket from the cache and tap Start Service
  if (inQueue) await page.getByRole('button', { name: new RegExp(`^Ticket .*${GUEST1}`) }).first().click();
  else { await page.getByRole('button', { name: 'Tickets', exact: true }).first().click(); await page.getByText(GUEST1).first().click(); }
  await startBtn.waitFor({ timeout: 8_000 });
  await startBtn.click();
  const pendingNote = await page.getByText(/is pending — it will be sent once when you’re back online/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
  const pendingRow = await page.getByText(/Pending — will send when you’re back online/).first().isVisible().catch(() => false);
  await page.screenshot({ path: join(SHOTS, '4-offline-start-pending.png'), fullPage: true });
  const st2 = (await q(`select status, started_at from pos_tech_queue_tickets where id = $1`, [w1.ticketId]))[0];
  const store2 = await readDeviceStore(page);
  const jKeys = Object.keys(store2).filter((k) => k.startsWith('aps.journal.v1:tech:'));
  const entry = jKeys.length ? JSON.parse(String(store2[jKeys[0]])) : null;
  check('4. offline Start Service → shown as PENDING; nothing reached the server (still accepted, no start time)', pendingNote && pendingRow && startRequests.length === 0 && !st2?.started_at && /accept/.test(String(st2?.status)),
    `note ${pendingNote} row ${pendingRow} requests ${startRequests.length} db ${short(st2)}`);
  check('   the journal entry sits in IndexedDB: start_service, HIGH, one Idempotency-Key, scoped to this salon / branch / technician, expiring', jKeys.length === 1 && entry?.operation === 'tech.start_service' && entry?.priority === 'HIGH'
    && /^[A-Za-z0-9_\-:.]{8,200}$/.test(entry?.idempotencyKey || '') && entry?.tenantId === TA && entry?.branchId === BA && entry?.actorId === TECHU && entry?.expiresAt > entry?.createdAt, short(entry && { op: entry.operation, prio: entry.priority, status: entry.status, ttl: entry.expiresAt - entry.createdAt }));

  // 5. the network returns → replay once
  await ctx.setOffline(false);
  const started = await waitFor(async () => (await q(`select status, started_at from pos_tech_queue_tickets where id = $1`, [w1.ticketId]))[0]?.started_at ? true : false, 15_000);
  const cleared = await page.getByText(/Pending — will send when you’re back online/).first().waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false);
  await sleep(800);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });           // a second reconnect signal
  await sleep(2500);
  const st3 = (await q(`select status, started_at from pos_tech_queue_tickets where id = $1`, [w1.ticketId]))[0];
  const idem = await q(`select idem_key, state, route, response_status from api_idempotency where scope like $1 and route like '%start-service%'`, [`%:${TECHU}`]);
  const store3 = await readDeviceStore(page);
  await page.screenshot({ path: join(SHOTS, '5-online-replayed.png'), fullPage: true });
  check('5. network back → the journal replays ONCE: one start-service request carrying the journaled key, one idempotency row, the ticket is in service',
    started && startRequests.length === 1 && startRequests[0].key === entry?.idempotencyKey && idem.length === 1 && idem[0].idem_key === entry?.idempotencyKey && idem[0].state === 'done' && /serv/.test(String(st3?.status)),
    `requests ${startRequests.length} key match ${startRequests[0]?.key === entry?.idempotencyKey} idem ${short(idem.map((r) => ({ state: r.state, status: r.response_status })))} db ${short(st3?.status)}`);
  check('   the pending note clears and the journal is empty again (a second "online" event sent nothing more)', cleared && Object.keys(store3).filter((k) => k.startsWith('aps.journal.v1:')).length === 0, `cleared ${cleared}`);

  // 6. realtime resumes: a second walk-in appears on the open Queue by itself
  await page.getByRole('button', { name: 'Back' }).first().click().catch(() => undefined);
  await openQueue();
  const streamsBefore = streamOpens.length;
  const tRoute = Date.now();
  const w2 = await routeWalkIn(mgr, GUEST2, '56' + tag.slice(-5));
  const appeared = await page.getByText(GUEST2).first().waitFor({ timeout: 12_000 }).then(() => true, () => false);
  const ms = Date.now() - tRoute;
  await page.screenshot({ path: join(SHOTS, '6-realtime-resumed.png'), fullPage: true });
  check('6. realtime resumes: a second walk-in routed to the technician appears on the open Queue without a tap', w2.ok && appeared, `${w2.detail}; appeared ${appeared} after ${ms} ms; stream opens total ${streamOpens.length} (since queue reopen ${streamOpens.length - streamsBefore})`);
  check('   no page errors in the app', pageErrors.length === 0, short(pageErrors));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 400));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e)));
  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
