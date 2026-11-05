/* verify-live-socket.ts — REAL over-the-wire SSE smoke test. The test hosts a PGlite database, then launches the actual
 * COMPILED app (dist/main.js — same artifact `npm start` runs, so NestJS DI/guards/middleware behave exactly as in prod)
 * as a child process pointed at that DB. It then opens a genuine SSE connection (what a browser EventSource does) and
 * POSTs a tip over HTTP, asserting the event is delivered across the socket. Not a real iPad, but a real running server.
 * Prereq: `npm run build` (dist/main.js must exist). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { hashPassword } from '../../../packages/auth/src/password';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DB_PORT = 5492, HTTP_PORT = 3198;
const T = '00000000-0000-0000-0000-00000c0d1501', B1 = '00000000-0000-0000-0000-00000c0db501';
const C = '00000000-0000-0000-0000-00000c0dc501', TK = '00000000-0000-0000-0000-00000c0d7c01', DEV = '00000000-0000-0000-0000-00000c0dde01';
const S = '00000000-0000-0000-0000-00000c0d5e01';
// §12 live-edit fan-out: tech user + technician + serving ticket + two services + a seeded line
const TU = '00000000-0000-0000-0000-00000c0d0f01', TECH1 = '00000000-0000-0000-0000-00000c0d0e01', PU = '00000000-0000-0000-0000-00000c0d0f02';
const TK2 = '00000000-0000-0000-0000-00000c0d7c02', L2 = '00000000-0000-0000-0000-00000c0d1a02';
const CAT1 = '00000000-0000-0000-0000-00000c0dca01', SVC1 = '00000000-0000-0000-0000-00000c0d5a01', SVC2 = '00000000-0000-0000-0000-00000c0d5a02';
const token = 'tok_live_sock'; const hash = createHash('sha256').update(token).digest('hex');
const devToken = 'dev_live_tok'; const devHash = createHash('sha256').update(devToken).digest('hex');

function getStatus(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path, headers }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
  });
}
function getBody(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path, headers }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode || 0, body: b })); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}
function openSSE(path: string, extraHeaders: http.OutgoingHttpHeaders = {}): { received: () => string; close: () => void } {
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port: HTTP_PORT, path, headers: { accept: 'text/event-stream', ...extraHeaders } }, (res) => {
    res.setEncoding('utf8'); res.on('data', (chunk) => { buf += chunk; });
  });
  req.on('error', () => {});
  return { received: () => buf, close: () => req.destroy() };
}
function post(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, path, method: 'POST', headers: { 'x-display-token': token, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode || 0, body: b }));
    });
    req.on('error', reject); req.write(JSON.stringify({ tipType: 'percent', percent: 20 })); req.end();
  });
}
function postJson(path: string, body: any): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, path, method: 'POST', headers: { 'x-display-token': token, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode || 0, body: b }));
    });
    req.on('error', reject); req.write(JSON.stringify(body)); req.end();
  });
}

function reqJson(method: string, path: string, body: any, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: b, setCookie: ([] as string[]).concat((res.headers['set-cookie'] as string[]) || []) }));
    });
    req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
}

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Live LLC','Live Salon','live','LIVE')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES ('${C}','${T}','${B1}','Lee','Ng','Lee Ng','active',false,false,false)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK}','${T}','${B1}','${C}','ready_checkout',10000,775,0,11098,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES (gen_random_uuid(),'${T}','${B1}','${TK}',gen_random_uuid(),'Manicure',10000,45,'percent',0,10000,'completed',100)`);
  await db.exec(`INSERT INTO customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) VALUES ('${DEV}','${T}','${B1}','iPad','ipad','paired','${devHash}')`);
  await db.exec(`INSERT INTO customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, selected_tip_cents, subtotal_cents, payment_method, expires_at) VALUES ('${S}','${T}','${B1}','${DEV}','${TK}','${C}','showing_ticket','${hash}',0,10000,'card', now() + interval '20 minutes')`);

  const techHash = await hashPassword('TechPass!9');
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, role, status) VALUES ('${TU}','${T}','${B1}','Mia Tran','tech@live.com','${techHash}','TECHNICIAN','active')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${TECH1}','${T}','${B1}','${TU}','Mia','Tran','Mia Tran','active','percent',50,true)`);
  const ownerHash = await hashPassword('OwnerPass!9');
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, role, status) VALUES ('${PU}','${T}','${B1}','Pat Owner','owner@live.com','${ownerHash}','OWNER','active')`);
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT1}','${T}','${B1}','Manicure')`);
  await db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) VALUES
    ('${SVC1}','${T}','${B1}','${CAT1}','Nail Art',20,2000,'percent',50),
    ('${SVC2}','${T}','${B1}','${CAT1}','Chrome Finish',15,1500,'percent',50)`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES ('${TK2}','${T}','${B1}','${C}','${TECH1}','serving',4500,0,0,4500,0)`);
  await db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent) VALUES ('${L2}','${T}','${B1}','${TK2}','${SVC1}','${TECH1}','Gel Manicure',4500,45,'percent',50,4500,'serving',40)`);
  await db.exec(`INSERT INTO pos_tech_queue_tickets (id, tenant_id, branch_id, ticket_id, customer_id, customer_name, is_vip, source, requested_services, priority, status, assigned_technician_id, delay_status) VALUES ('${TK2}','${T}','${B1}','${TK2}','${C}','Lee Ng',false,'walk_in','[]','normal','in_service','${TECH1}','none')`);

  const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' }); await server.start();

  const child: ChildProcess = spawn('node', ['dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, REPO_DRIVER: 'postgres', DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, PORT: String(HTTP_PORT), AUTH_SESSION_SECRET: 'test-secret', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childErr = '';
  child.stderr?.on('data', (d) => { childErr += d.toString(); });

  let sse: { received: () => string; close: () => void } | null = null;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { if ((await getStatus('/health')) > 0) up = true; else await sleep(500); }
    ok('compiled app booted + listening over HTTP (PGlite-backed)', up, up ? '' : childErr.slice(-300));
    if (!up) throw new Error('server did not start');

    sse = openSSE(`/customer-display/checkout/${S}/stream?token=${token}`);
    await sleep(800);
    ok('SSE handshake: "connected" received over the socket', sse.received().includes('connected'), sse.received().slice(0, 70).replace(/\n/g, ' '));

    const r = await post(`/customer-display/checkout/${S}/tip`);
    ok('tip POST over HTTP -> 200 with recomputed total 13158', ( r.status === 201 || r.status === 200 ) && r.body.includes("13158"), `${r.status} ${r.body.slice(0, 60)}`);

    let got = false;
    for (let i = 0; i < 25 && !got; i++) { if (sse.received().includes('customer_display_tip_selected')) got = true; else await sleep(150); }
    ok('tip event delivered across the live SSE socket', got, sse.received().split('\n').filter((l) => l.includes('event')).slice(-2).join(' | '));

    // customer picks cash on the iPad: route must be excluded from session middleware (else 401) and the surcharge drops
    const meth = await postJson(`/customer-display/checkout/${S}/method`, { method: 'cash' });
    ok('method POST over HTTP -> 200 (route excluded from session middleware), cash removes surcharge (12775)', (meth.status === 201 || meth.status === 200) && meth.body.includes('12775'), `${meth.status} ${meth.body.slice(0, 60)}`);

    ok('valid token -> 200 over HTTP', (await getStatus(`/customer-display/checkout/${S}?token=${token}`)) === 200);
    ok('forged token -> 403 over HTTP', (await getStatus(`/customer-display/checkout/${S}?token=wrong`)) === 403);

    // device mode: a mounted/paired iPad fetches its current session over HTTP (route must be middleware-excluded)
    const dc = await getBody('/customer-display/device/current', { 'x-device-token': devToken });
    ok('device-mode: GET device/current over HTTP -> 200 (paired iPad sees its session)', dc.status === 200 && dc.body.includes('Live Salon'), `${dc.status} ${dc.body.slice(0, 50)}`);
    ok('device-mode: forged device token -> 403 over HTTP', (await getBody('/customer-display/device/current', { 'x-device-token': 'wrong' })).status === 403);

    // PUBLIC website intake: unauthenticated POST must pass middleware/guards; per-IP limiter must answer 429
    const pub = await postJson('/public/website/leads', { kind: 'demo_request', name: 'Site Visitor', email: 'site@example.com' });
    ok('public website lead: unauthenticated POST -> 2xx with ok:true', (pub.status === 201 || pub.status === 200) && pub.body.includes('"ok":true'), `${pub.status} ${pub.body.slice(0, 60)}`);
    let last: any = null;
    for (let i = 0; i < 5; i++) last = await postJson('/public/website/leads', { kind: 'contact', email: `burst${i}@example.com` });
    ok('public website lead: burst beyond 5/min -> 429 over HTTP', last?.status === 429, `last=${last?.status}`);

    // round-8 retirement at the HTTP layer: the middleware 401s pre-routing for ANY non-excluded path, so the
    // provable property is that the retired route behaves IDENTICALLY to a path that never existed (no special handler).
    const oldRoute = await postJson('/super-admin/support/start', { tenantId: 'x', reason: 'y' });
    const neverExisted = await postJson('/super-admin/support/definitely-not-a-route', {});
    ok('retired POST /super-admin/support/start is indistinguishable from a never-existing route',
      oldRoute.status === neverExisted.status && oldRoute.status !== 200 && oldRoute.status !== 201,
      `retired=${oldRoute.status} ghost=${neverExisted.status}`);
    // round-11 account controller mounted + auth-gated: no session -> 401, never a silent 404
    const chpw = await postJson('/auth/change-password', { currentPassword: 'a', newPassword: 'b', confirmPassword: 'b' });
    ok('POST /auth/change-password is mounted and auth-gated (401 without a session)', chpw.status === 401, `status=${chpw.status}`);

    // ════════ §12 tech live-edit events over the REAL socket ════════
    const login = await reqJson('POST', '/auth/login', { salonCode: 'LIVE', identifier: 'tech@live.com', password: 'TechPass!9' });
    const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ');
    ok('technician login over HTTP issues a session cookie', (login.status === 200 || login.status === 201) && cookie.length > 0 && login.body.includes('"ok":true'), `${login.status} ${login.body.slice(0, 80)}`);

    const ownerLogin = await reqJson('POST', '/auth/login', { salonCode: 'LIVE', identifier: 'owner@live.com', password: 'OwnerPass!9' });
    const posCookie = ownerLogin.setCookie.map((c) => c.split(';')[0]).join('; ');
    ok('POS owner login over HTTP issues a session cookie', (ownerLogin.status === 200 || ownerLogin.status === 201) && posCookie.length > 0, `${ownerLogin.status}`);

    const techSse = openSSE('/realtime/stream', { cookie: posCookie });
    await sleep(800);
    ok('POS tenant SSE stream connected (the §12 consumer)', techSse.received().includes('connected'), techSse.received().slice(0, 80).replace(/\n/g, ' '));

    const add = await reqJson('POST', `/tech/tickets/${TK2}/service-lines`, { serviceId: SVC2 }, { cookie });
    ok('tech adds a service over HTTP -> exact §8 message', (add.status === 200 || add.status === 201) && add.body.includes('Service added to ticket.'), `${add.status} ${add.body.slice(0, 100)}`);

    let gotAdd = false, gotRecalc = false;
    for (let i = 0; i < 30 && !(gotAdd && gotRecalc); i++) {
      if (techSse.received().includes('ticket_service_line_added')) gotAdd = true;
      if (techSse.received().includes('ticket_total_recalculated')) gotRecalc = true;
      if (!(gotAdd && gotRecalc)) await sleep(150);
    }
    ok('§12: ticket_service_line_added delivered across the live socket', gotAdd, techSse.received().split('\n').filter((l) => l.includes('event')).slice(-3).join(' | '));
    ok('§12: ticket_total_recalculated delivered across the live socket', gotRecalc);

    const chg = await reqJson('POST', `/tech/tickets/${TK2}/change-requests`, { type: 'change_service', lineId: L2, newServiceId: SVC2, reason: 'customer changed her mind' }, { cookie });
    ok('change-service over HTTP -> pending approval with the exact §7 message', (chg.status === 200 || chg.status === 201) && chg.body.includes('This service requires manager approval.'), `${chg.status} ${chg.body.slice(0, 100)}`);
    let gotCr = false;
    for (let i = 0; i < 30 && !gotCr; i++) { if (techSse.received().includes('ticket_change_request_created')) gotCr = true; else await sleep(150); }
    ok('§12: ticket_change_request_created delivered across the live socket', gotCr);

    // §7 + §28 over the wire: POS approves the request -> the change applies AND the technician gets a notification
    const reqId = JSON.parse(chg.body).requestId;
    const dec = await reqJson('POST', `/pos/serving/change-requests/${reqId}/decision`, { decision: 'approve' }, { cookie: posCookie });
    ok('POS approves over HTTP -> applied', (dec.status === 200 || dec.status === 201) && dec.body.includes('applied'), `${dec.status} ${dec.body.slice(0, 60)}`);
    let gotApproved = false;
    for (let i = 0; i < 30 && !gotApproved; i++) { if (techSse.received().includes('ticket_change_request_approved')) gotApproved = true; else await sleep(150); }
    ok('§12: ticket_change_request_approved delivered across the live socket', gotApproved);
    const notif = await reqJson('GET', '/tech/notifications', undefined, { cookie });
    ok('§28: technician reads the approval notification over HTTP', notif.status === 200 && notif.body.includes('Service change approved') && notif.body.includes('"unread":1'), `${notif.status} ${notif.body.slice(0, 120)}`);
    const mark = await reqJson('POST', '/tech/notifications/read', {}, { cookie });
    const notif2 = await reqJson('GET', '/tech/notifications', undefined, { cookie });
    ok('mark-all-read clears the unread count over HTTP', (mark.status === 200 || mark.status === 201) && notif2.body.includes('"unread":0'), notif2.body.slice(0, 80));
    const tset = await reqJson('GET', '/tech/settings', undefined, { cookie });
    ok('GET /tech/settings returns the salon capability set over HTTP', tset.status === 200 && tset.body.includes('"techCanAddService":true') && tset.body.includes('"liveEditEnabled":true'), `${tset.status} ${tset.body.slice(0, 100)}`);
    techSse.close();
  } catch (e: any) {
    ok('live socket test ran without throwing', false, (e?.message || String(e)) + (childErr ? ' | child: ' + childErr.slice(-200) : ''));
  } finally {
    sse?.close(); child.kill('SIGKILL'); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-live-socket: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
