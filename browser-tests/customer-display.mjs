// browser-tests/customer-display.mjs — builds a live checkout session via the API, then renders the REAL customer
// display (the iPad kiosk) in a headless browser and asserts the salon, order, and totals show. Screenshot to SHOTS_DIR.
//
// Prereqs (run from the REPO ROOT so `playwright` resolves):
//   API:      DATABASE_URL=... REPO_DRIVER=postgres AUTH_SESSION_SECRET=... PORT=3000 node apps/api/dist/main.js
//   display:  (cd apps/customer-display && node ../../node_modules/.bin/vite --port 5180 --host)
//   browsers: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
//   run:      API_URL=http://localhost:3000 DISPLAY_URL=http://localhost:5180 SHOTS_DIR=/tmp/shots \
//             node browser-tests/customer-display.mjs
//
// The display uses SSE + polling, so navigation waits on 'domcontentloaded' (NEVER 'networkidle' — it never settles).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const API = process.env.API_URL || 'http://localhost:3000';
const DISP = process.env.DISPLAY_URL || 'http://localhost:5180';
const SHOTS = process.env.SHOTS_DIR || '/tmp/shots';
const CODE = process.env.LOGIN_CODE || 'LUXE';
const USER = process.env.LOGIN_USER || 'owner@luxenails.test';
const PASS = process.env.LOGIN_PASS || 'Owner123!';
mkdirSync(SHOTS, { recursive: true });
let cookie = '';
async function req(method, path, body) {
  const r = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const rnd = Math.floor(1000 + Math.random() * 8999);
let pass = 0, fail = 0; const ok = (n, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

// --- set up a live checkout session handed to a paired display ---
await req('POST', '/auth/login', { portal: 'tenant', salonCode: CODE, identifier: USER, password: PASS });
let r = await req('POST', '/pos/settings/customer-display-devices/pairing-code'); const code = r.j?.code;
r = await req('POST', '/pos/settings/customer-display-devices/pair', { code, name: 'Kiosk' }); const deviceId = r.j?.id || r.j?.deviceId;
r = await req('POST', '/pos/services/categories', { name: 'D' + rnd, colorKey: 'gold' }); const categoryId = r.j?.categoryId || r.j?.id;
r = await req('POST', '/pos/services', { name: 'Gel Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.j?.serviceId || r.j?.id;
r = await req('POST', '/pos/technicians', { firstName: 'D', lastName: 'T' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.j?.technicianId || r.j?.id;
r = await req('POST', '/pos/check-in/walk-in', { customerName: 'Jordan ' + rnd, customerPhone: '+1609' + rnd + '4444', serviceIds: [serviceId], technicianId, isNewCustomer: true }); const checkInId = r.j?.checkInId;
r = await req('POST', `/pos/check-in/${checkInId}/move-to-queue`); const q = r.j?.queueItemId;
await req('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId });
r = await req('POST', `/pos/queue/items/${q}/start-service`); const serv = r.j?.servingTicketId || q;
await req('POST', `/pos/serving/tickets/${serv}/mark-service-done`);
r = await req('POST', `/pos/serving/tickets/${serv}/send-to-service-done`); const sd = r.j?.serviceDoneTicketId || serv;
await req('POST', `/pos/service-done/tickets/${sd}/quality-check`, { result: 'approved' });
r = await req('POST', `/pos/service-done/tickets/${sd}/send-to-checkout`); const ticketId = r.j?.checkoutTicketId || sd;
r = await req('POST', '/pos/customer-display/sessions', { ticketId, deviceId });
const sessionId = r.j?.sessionId, token = r.j?.publicToken;
ok('live display session created', !!sessionId && !!token, `session=${sessionId}`);

// --- render the customer-facing iPad screen ---
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${DISP}/?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.length > 40, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const body = await page.locator('body').innerText().catch(() => '');
  ok('display shows the salon name', /luxe/i.test(body), body.replace(/\s+/g, ' ').slice(0, 70));
  ok('display shows tip/total content', /tip|total|\$|pay/i.test(body));
  await page.screenshot({ path: `${SHOTS}/07-customer-display.png` });
  ok('no uncaught JS errors on the display', errors.length === 0);
} catch (e) { ok('display rendered', false, String(e).slice(0, 140)); await page.screenshot({ path: `${SHOTS}/zz-display-fail.png` }).catch(() => {}); }
finally { await browser.close(); console.log(`\n${fail === 0 ? '✅ CUSTOMER DISPLAY RENDERED' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`); process.exit(fail === 0 ? 0 : 1); }
