// server.mjs — static host for the bundled POS + a fixture API for the Checkout one-screen harness (tooling only).
// GET /__state?name=<empty|normal|busy|unknown|split|tech200> switches the dataset; every request the app makes that has
// no fixture answers 404 { error } (the app must degrade inside its panels) and is listed at GET /__unhandled.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dataset } from './fixtures.mjs';
import { serviceDoneDataset } from './fixtures-sd.mjs';
import { servingDataset } from './fixtures-sv.mjs';
import { customerQueueDataset } from './fixtures-cq.mjs';
import { overviewDataset } from './fixtures-ov.mjs';
import { checkInDataset } from './fixtures-ci.mjs';
import { liveOpsDataset } from './fixtures-lo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const req = createRequire(import.meta.url);
let perms = [];
try { const rbac = req(join(ROOT, 'packages/permissions/dist/rbac.js')); perms = [...(rbac.ROLE_PERMISSIONS?.MANAGER ?? rbac.ROLE_PERMISSIONS?.manager ?? [])]; } catch { /* built by the full-system-test step; empty = permission-gated UI hidden */ }
let state = 'normal'; let announce = 'none'; let sdServer = 'new'; let sd = serviceDoneDataset('normal', 'new'); let sv = servingDataset('normal', 'new'); let cq = customerQueueDataset('normal', 'new'); let ov = overviewDataset('normal', 'new'); let ci = checkInDataset('normal', 'new'); let lo = liveOpsDataset('normal', 'new'); const unhandled = new Map(); const log = [];
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };

const principal = () => ({ userId: '00000000-0000-4000-8000-0000000000a1', tenantId: '00000000-0000-4000-8000-000000000001', branchId: '00000000-0000-4000-8000-000000000002', role: 'MANAGER', permissions: perms, fullName: 'Linh Manager', email: null, subscriptionStatus: 'active' });

createServer(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const send = (code, body, type = 'application/json') => { rs.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); rs.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname === '/__state') { state = u.searchParams.get('name') || 'normal'; sdServer = u.searchParams.get('server') || 'new'; sd = serviceDoneDataset(state, sdServer); sv = servingDataset(state, sdServer); cq = customerQueueDataset(state, sdServer); ov = overviewDataset(state, sdServer); ci = checkInDataset(state, sdServer); lo = liveOpsDataset(state, sdServer); return send(200, { state, server: sdServer }); }
  if (u.pathname === '/__sv') return send(200, { sent: sv.sent, alerts: sv.alerts });   // Serving E2E: what the fixture server recorded
  if (u.pathname === '/__ci') return send(200, { log: ci.log, walkIns: ci.walkIns.length });   // Check-In E2E
  if (u.pathname === '/__cq') return send(200, { notes: cq.notes, walkIns: cq.walkInLog });   // Customer Queue E2E
  if (u.pathname === '/__unhandled') return send(200, [...unhandled.entries()].map(([k, n]) => ({ route: k, n })));
  if (u.pathname === '/__log') return send(200, log.slice(-500));
  // POS top-bar Platform Announcement samples (shell/PlatformAnnouncementBar.tsx): /__announce?kind=info|long|critical|none
  if (u.pathname === '/__announce') { announce = u.searchParams.get('kind') || 'none'; return send(200, { announce }); }
  if (u.pathname === '/api/v1/pos/platform-announcements/active') return send(200, announcementSnapshot(announce));
  const file = join(OUT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!u.pathname.startsWith('/api/') && existsSync(file) && !file.endsWith('/')) return send(200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
  if (!u.pathname.startsWith('/api/')) return send(200, readFileSync(join(OUT, 'index.html')), 'text/html');
  let body = ''; for await (const c of rq) body += c;
  const path = u.pathname.replace(/^\/api\/v1/, ''); log.push(`${rq.method} ${path}${u.search}${rq.method !== 'GET' && body ? ' ' + body.slice(0, 300) : ''}`);
  const fromOverview = /\/overview/.test(String(rq.headers.referer || ''));
  const fromLiveOps = /\/(live-operations|dashboard)/.test(String(rq.headers.referer || ''));
  if (path === '/auth/me') return send(200, fromOverview && ov.employeeName ? { ...principal(), fullName: ov.employeeName } : principal());
  // Overview page (PAGE=overview): its own datasets; the navigation answer carries an AI package (AI Insights unlocked)
  // and, for the `long` dataset, the long salon name (§36)
  if (path.startsWith('/pos/overview')) { const h = ov.route(rq.method, path, u.searchParams); if (h !== undefined) return send(h?.__status ?? 200, h?.__status ? h.body : h); }
  // Live Operations page (PAGE=liveops): its datasets; the navigation answer carries an AI package (AI Insights unlocked)
  if (path.startsWith('/pos/dashboard')) { const h = lo.route(rq.method, path, u.searchParams); if (h !== undefined) return send(200, h); }
  if (path === '/tenant/navigation' && fromLiveOps) { const nv = dataset(state).route('GET', path, u.searchParams, null, { perms, branchId: principal().branchId }); return send(200, { ...nv, aiPackages: ['ai_front_desk'] }); }
  if (path === '/tenant/navigation' && fromOverview) { const nv = dataset(state).route('GET', path, u.searchParams, null, { perms, branchId: principal().branchId }); return send(200, { ...nv, aiPackages: ['ai_front_desk'], ...(ov.salonName ? { salonName: ov.salonName } : {}) }); }
  if (path === '/realtime/stream') { rs.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); rs.write(': connected\n\nevent: ready\ndata: {}\n\n'); const t = setInterval(() => rs.write(': ping\n\n'), 15000); rq.on('close', () => clearInterval(t)); return; }
  // Check-In page (PAGE=checkin): its own stateful fixture when the request comes from /check-in
  if (path.startsWith('/pos/check-in') && /\/check-in(\?|$)/.test(String(rq.headers.referer || ''))) { const h = ci.route(rq.method, path, u.searchParams, body ? safeJson(body) : null); if (h !== undefined) return send(h?.__status ?? 200, h?.__status ? h.body : h); }
  // Customer Queue page (PAGE=queue): its own stateful fixture; the roster comes from it when the queue page asks
  if (path.startsWith('/pos/queue') || path.startsWith('/pos/check-in/') || ((path === '/pos/technicians/state' || path === '/pos/booking/technicians') && /\/queue/.test(String(rq.headers.referer || '')))) { const h = cq.route(rq.method, path, u.searchParams, body ? safeJson(body) : null); if (h !== undefined) return send(h?.__status ?? 200, h?.__status ? h.body : h); }
  if (path.startsWith('/pos/serving') || path === '/pos/technicians/state') { const h = sv.route(rq.method, path, u.searchParams, body ? safeJson(body) : null); if (h !== undefined) return send(h?.__status ?? 200, h?.__status ? h.body : h); }
  if (path.startsWith('/pos/service-done')) { const h = sd.route(rq.method, path, u.searchParams, body ? safeJson(body) : null); if (h !== undefined) return send(h?.__status ?? 200, h?.__status ? h.body : h); }
  const ds = dataset(state);   // the checkout datasets treat a Service-Done-only name (q100, long) as a normal board
  const hit = ds.route(rq.method, path, u.searchParams, body ? safeJson(body) : null, { perms, branchId: principal().branchId });
  if (hit !== undefined) return send(hit?.__status ?? 200, hit?.__status ? hit.body : hit);
  const key = `${rq.method} ${path.replace(/[0-9a-f-]{36}|tk_[a-z0-9_]+/g, ':id')}`; unhandled.set(key, (unhandled.get(key) ?? 0) + 1);
  return send(404, { error: { code: 'NOT_FOUND', message: 'not in the harness fixtures' } });
}).listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log('harness on', process.env.PORT || 4317));
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function announcementSnapshot(kind) {
  const base = { titleVi: null, messageVi: null, dismissible: true, requiresAcknowledgement: false, acknowledged: false, startsAt: null, endsAt: null, version: 1, contentVersion: 1 };
  const A = {
    info: [{ ...base, id: 'ann-info', type: 'update', priority: 'normal', title: 'New in AI PowerSalon', message: 'Checkout now fits one screen on the front-desk touchscreen.',
      titleVi: 'Mới trong AI PowerSalon', messageVi: 'Màn hình Thanh toán giờ vừa một màn hình trên máy cảm ứng quầy lễ tân.' }],
    long: [{ ...base, id: 'ann-maint', type: 'maintenance', priority: 'high', title: 'Scheduled maintenance tonight', dismissible: false,
      message: 'Card payments will be unavailable from 2:00 AM to 2:30 AM Eastern while our payment partner upgrades its systems. Cash and gift cards keep working. Appointments, check-in and the tech queue are not affected. If a card payment is in progress at 2:00 AM, verify it after 2:30 AM before charging again.' }],
    critical: [{ ...base, id: 'ann-urgent', type: 'urgent', priority: 'critical', title: 'Action needed', dismissible: false, requiresAcknowledgement: true,
      message: 'Our card processor reported delays. If a card shows "Payment status uncertain", press Verify Payment — do not run the card again.' }],
  };
  return { announcements: A[kind] ?? [], serverTime: new Date().toISOString(), nextChangeAt: null };
}
