// e2e-html-apps.mjs — the FIRST runtime coverage for the two single-file HTML apps (Jul 28, 2026).
//
// check:html gives them a static floor (syntax, dangling ids, hardcoded origins, credentials). This is the other
// half: REAL Chromium drives the REAL files through their primary journeys against a stub API, asserting both what
// the guest sees and exactly which endpoints the app called, in order.
//
//   KIOSK  (go-check-in-kiosk/www/index.html): boot → config → start-session → phone keypad → lookup →
//          "Welcome back" match confirm → service selection (the branch's prices; an add-on only with a service) →
//          technician preference (asked for the CHOSEN services) → walk-in check-in → "You're checked in!" with the
//          queue engine's wait band → Done resets to a fresh session for the next guest, whose appointment is a visit
//          of several services ("+ 1 more") checked in with one "I'm Here" (23-inch spec Unit 7, Oct 6 2026).
//   PUBLIC (booking-public/index.html): signed link → pick a service and time → name + phone → verify → booked.
//   (Phase 15, Oct 10 2026: the go-check-in-admin, booking-html and booking-schedule-html pages were removed — their
//   replacements are admin-web /check-in-devices, customer-web Book and pos-web /tenant/booking, covered by those apps'
//   own suites; tooling/architecture-tests fails if one of the three directories comes back.)
//
// The stub implements ONLY what the apps consume (field names taken from reading the files, not guessed), records
// every call, and the harness fails if the recorded sequence differs from the journey. No backend, no database —
// this is UI-behavior coverage, deliberately independent of the API's own suites.
//
// Run from apps/api:   node scripts/e2e-html-apps.mjs
// Not part of the vitest battery (browser + ports); wired as `npm run e2e:html`.
import http from 'node:http';
import { readFileSync, existsSync as _exists, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const APPS = join(SCRIPTS, '..', '..');
const KIOSK_HTML = readFileSync(join(APPS, 'go-check-in-kiosk', 'www', 'index.html'), 'utf8');
const PUBLIC_HTML = readFileSync(join(SCRIPTS, '..', '..', 'booking-public', 'index.html'), 'utf8');
const PORT = Number(process.env.E2E_HTML_PORT) || 4321;

const calls = [];                    // every API hit, in order: "METHOD /path"
let publicBooked = false;           // the first public booking asks for phone verification; the retry books
let kioskLookups = 0;               // the second guest has an appointment today
let techQuery = null;               // what the kiosk asked the technician list for (§25)

const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(JSON.stringify(body)); };

const server = http.createServer((req, res) => {
  // Phase 12 moved every client to /api/v1/<path> (the kiosk and the public page included); the stub keeps the bare
  // route names, so the version prefix is stripped here — before Oct 10 2026 it was not, and both journeys timed out.
  const path = req.url.split('?')[0].replace(/^\/api\/v1(?=\/)/, '');
  if (req.method === 'OPTIONS') return json(res, {});
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(KIOSK_HTML); }
  if (path === '/book') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PUBLIC_HTML); }

  calls.push(`${req.method} ${path}`);

  // ---- kiosk endpoints (shapes = exactly what the file reads) ----
  if (path === '/go-check-in/harness-salon/config') return json(res, { salonName: 'Harness Salon', settings: { showWaitEstimate: true } });
  if (path === '/go-check-in/harness-salon/start-session') return json(res, { sessionId: 'sess-1', sessionToken: 'tok-1', config: { salonName: 'Harness Salon', settings: { showWaitEstimate: true } } });
  if (path === '/go-check-in/session/sess-1/lookup-phone') {
    kioskLookups += 1;
    if (kioskLookups === 1) return json(res, { match: { source: 'tenant', firstName: 'Ava', lastInitial: 'K', customerId: 'cust-1' } });
    // the next guest: a visit of several services today (§16–§17) — first names only, one start time
    return json(res, { match: { source: 'tenant', firstName: 'Sophia', lastInitial: 'L', customerId: 'cust-2' }, appointment: { appointmentId: 'appt-1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia', items: [
      { serviceName: 'Gel Manicure', technicianName: 'Olivia', startTimeLabel: '11:00 AM' }, { serviceName: 'Spa Pedicure', technicianName: 'Lisa', startTimeLabel: '11:00 AM' },
      { serviceName: 'Paraffin Dip', technicianName: 'Lisa', startTimeLabel: '11:00 AM' }, { serviceName: 'Nail Art', technicianName: 'Olivia', startTimeLabel: '11:45 AM' }] } });
  }
  if (path === '/go-check-in/session/sess-1/check-in-appointment') return json(res, { status: 'checked_in', firstName: 'Sophia', appointmentsCheckedIn: 2, estimatedWait: { fromMinutes: 5, toMinutes: 15 }, checkInId: 'ci-2' });
  // the branch's catalog as the Unit 7 API answers it: its prices, its categories, add-ons flagged (§20–§23)
  if (path === '/go-check-in/session/sess-1/services') return json(res, { services: [
    { id: 'svc-1', name: 'Gel Manicure', priceCents: 5000, durationMinutes: 45, category: 'Manicure', isAddOn: false },
    { id: 'svc-2', name: 'Pedicure', priceCents: 6000, durationMinutes: 60, category: 'Pedicure', isAddOn: false },
    { id: 'svc-3', name: 'Nail Art', priceCents: 1000, durationMinutes: 15, category: 'Add-ons', isAddOn: true }] });
  if (path === '/go-check-in/session/sess-1/technicians') { techQuery = new URLSearchParams(req.url.split('?')[1] || '').get('serviceIds'); return json(res, { technicians: [{ technicianId: 'tech-1', name: 'Mia', fromLabel: 'From 2:00 PM' }] }); }
  if (path === '/go-check-in/session/sess-1/check-in-walk-in') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      // the app must send what the guest actually chose — assert it server-side, where lying is impossible
      if (b.customerId !== 'cust-1' || JSON.stringify(b.serviceIds) !== '["svc-1"]' || JSON.stringify(b.addOnIds) !== '["svc-3"]' || b.technicianId !== 'tech-1') {
        return json(res, { message: `walk-in payload wrong: ${body}` }, 400);
      }
      json(res, { status: 'checked_in', firstName: 'Ava', estimatedWaitMinutes: 12, estimatedWait: { fromMinutes: 12, toMinutes: 22 } });
    });
    return;
  }
  if (path === '/go-check-in/session/sess-1/complete') return json(res, { ok: true });
  if (path === '/go-check-in/session/sess-1/heartbeat') return json(res, { ok: true });

  // ---- PUBLIC (no-login) booking: signed token + public salon services ----
  // the services come from the signed link itself since Phase 4 (POST { token }) — the old public GET is not served
  if (path === '/api/ai-booking/v1/public/services' && req.method === 'POST') {
    return json(res, [{ id: 'svc-p', name: 'Gel Manicure', durationMinutes: 45, priceCents: 5500 }]);
  }
  if (path === '/api/ai-booking/v1/public/availability/search' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      // The token is the ONLY credential on this surface — a page that forgets it must fail loudly.
      if (b.token !== 'signed-token-abc') return json(res, { code: 'INVALID_PARTNER_LINK', message: 'bad token' }, 401);
      if (!Array.isArray(b.serviceIds) || b.serviceIds[0] !== 'svc-p' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) {
        return json(res, { message: `availability payload wrong: ${body}` }, 400);
      }
      json(res, { options: [{ technicianId: 'tech-p', technicianName: 'Mia', slots: ['10:00', '10:30'] }] });
    });
    return;
  }
  if (path === '/api/ai-booking/v1/public/appointments' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (b.token !== 'signed-token-abc') return json(res, { code: 'INVALID_PARTNER_LINK', message: 'bad token' }, 401);
      // Server-side truth for the guest flow: the API refuses any write without confirm:true, and the page must
      // send the guest's real choices plus an idempotency key (so a retry can never double-book).
      if (b.confirm !== true) return json(res, { ok: false, errorCode: 'HUMAN_CONFIRMATION_REQUIRED', message: 'not confirmed' });
      if (!b.idempotencyKey) return json(res, { ok: false, errorCode: 'VALIDATION_ERROR', message: 'no idempotency key' });
      if (b.customerName !== 'Guest Walkin' || !b.customerPhone || b.serviceIds?.[0] !== 'svc-p' || b.startTime !== '10:00' || b.technicianId !== 'tech-p') {
        return json(res, { ok: false, errorCode: 'VALIDATION_ERROR', message: `book payload wrong: ${body}` });
      }
      if (!publicBooked) { publicBooked = true; return json(res, { ok: false, errorCode: 'PHONE_VERIFICATION_REQUIRED', message: 'Verify your phone to book online.' }); }
      json(res, { ok: true, appointmentId: 'appt-pub-1' });
    });
    return;
  }

  json(res, { message: `stub has no route for ${req.method} ${path}` }, 404);
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`;
let failures = 0;
const check = (ok, label) => { console.log(`   ${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++; };

// Oct 20 2026: same rule as live-pilot-day.mjs — Playwright's pinned headless-shell may not be downloaded on a CI box
// (this one has chromium-1194 under /opt/pw-browsers); use CHROMIUM_PATH, else an installed Chromium, else Playwright's own.
// Nov 6 2026: newer boxes link /opt/pw-browsers/chromium straight to the binary (…/chrome-linux64/chrome) — the old
// candidates were directories-only and the run fell through to a headless shell that is not downloaded
const INSTALLED = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => { try { return _exists(p) && statSync(p).isFile(); } catch { return false; } });
const execPath = process.env.CHROMIUM_PATH || INSTALLED;
const browser = await chromium.launch(execPath ? { executablePath: execPath, args: ['--no-sandbox'] } : {});
// A journey that stalls (e.g. the app hit an error screen because its request was rejected) must fail with a
// readable line, not die as an uncaught TimeoutError — the sabotage test found exactly that.
const journey = async (label, fn) => { try { await fn(); } catch (e) { check(false, `${label} did not complete: ${String(e.message).split('\n')[0]}`); if (process.env.E2E_DEBUG) console.log('DEBUG calls:', JSON.stringify(calls, null, 0)); } };
try {
  // ---------------- KIOSK: the full guest journey ----------------
  console.log('=== KIOSK — go-check-in-kiosk/www/index.html in real Chromium ===');
  const page = await browser.newPage();
  await journey('kiosk journey', async () => {
  page.on('pageerror', (e) => { check(false, `page error: ${e.message}`); });
  await page.goto(`${base}/?api=${encodeURIComponent(base)}&slug=harness-salon`);

  await page.waitForSelector('#go');
  check((await page.textContent('h1'))?.includes('Harness Salon'), 'welcome shows the salon name from /config');
  await page.click('#go');

  await page.waitForSelector('.keypad');
  for (const d of '5551234567') await page.click(`.key[data-k="${d}"]`);
  check((await page.textContent('#pd'))?.includes('(555) 123-4567'), 'keypad formats the number as typed');
  await page.click('.key[data-k="✓"]');

  await page.waitForSelector('#yes');
  check((await page.textContent('h1'))?.includes('Ava'), 'tenant match → "Welcome back" with the right name');
  await page.click('#yes');

  await page.waitForSelector('.opt');
  check((await page.textContent('.opt[data-id="svc-1"]'))?.includes('$50'), 'the BRANCH\'s price on the service (§22–§23)');
  check(await page.isDisabled('.opt[data-id="svc-3"]'), 'an add-on waits for a service (§20)');
  await page.click('.opt[data-id="svc-1"]');
  check(!(await page.isDisabled('.opt[data-id="svc-3"]')), 'with a service chosen, the add-on can be added');
  await page.click('.opt[data-id="svc-3"]');
  await page.click('#next');

  await page.waitForSelector('.opt[data-id="tech-1"]');
  check(techQuery === 'svc-1', `technicians asked for the CHOSEN services only (§25) — asked for ${techQuery}`);
  check((await page.textContent('.opt[data-id="tech-1"]'))?.includes('From 2:00 PM'), 'a later shift says when it starts');
  await page.click('.opt[data-id="tech-1"]');
  await page.click('#next');

  await page.waitForSelector('#done');
  const doneH1 = await page.textContent('h1');
  check(doneH1?.includes('checked in'), 'confirmation screen reached');
  check((await page.textContent('.appt-card'))?.includes('12–22 min'), 'the queue engine\'s wait band (12–22 min), as it came (§26–§27)');
  await page.click('#done');
  await page.waitForSelector('#go');
  check(true, 'Done resets to a fresh welcome for the next guest');

  // ---- the next guest: a visit of several services (§16–§17) ----
  await page.click('#go');
  await page.waitForSelector('.keypad');
  for (const d of '5559876543') await page.click(`.key[data-k="${d}"]`);
  await page.click('.key[data-k="✓"]');
  await page.waitForSelector('#here');
  const card = async () => (await page.textContent('.appt-card')) || '';
  check((await card()).includes('Today at 11:00 AM'), '"Today at 11:00 AM"');
  check((await card()).includes('Spa Pedicure') && (await card()).includes('with Lisa'), 'every service of the visit with its technician');
  check(!(await card()).includes('Nail Art') && (await page.textContent('#more'))?.includes('+ 1 more'), 'compact: three rows, then "+ 1 more"');
  await page.click('#more');
  check((await card()).includes('Nail Art') && (await card()).includes('11:45 AM'), '"+ 1 more" opens the rest (with its own time)');
  await page.click('#here');
  await page.waitForSelector('#done');
  check((await page.textContent('p.sub'))?.includes('Both of your appointments are checked in'), 'one "I\'m Here" checked the whole visit in');
  check((await page.textContent('.appt-card'))?.includes('5–15 min'), 'the visit\'s wait band');
  await page.click('#done');
  await page.waitForSelector('#go');

  const kioskSeq = calls.filter((c) => c.includes('/go-check-in/'));
  const expected = [
    'GET /go-check-in/harness-salon/config',
    'POST /go-check-in/harness-salon/start-session',
    'POST /go-check-in/session/sess-1/lookup-phone',
    'GET /go-check-in/session/sess-1/services',
    'GET /go-check-in/session/sess-1/technicians',
    'POST /go-check-in/session/sess-1/check-in-walk-in',
    'POST /go-check-in/session/sess-1/check-in-appointment',
  ];
  check(expected.every((e) => kioskSeq.includes(e)), `kiosk called every journey endpoint (${kioskSeq.length} calls recorded)`);
  const walkIdx = kioskSeq.indexOf(expected[5]);
  check(kioskSeq.indexOf(expected[2]) < walkIdx && kioskSeq.indexOf(expected[3]) < walkIdx, 'lookup and services happen BEFORE the walk-in');
  });
  await page.close();

  // ---------------- PUBLIC BOOKING (NO LOGIN): signed link → pick → name+phone → booked ----------------
  console.log('=== PUBLIC BOOKING — booking-public/index.html in real Chromium (no account, signed link) ===');
  const pb = await browser.newPage();
  pb.on('pageerror', (e) => { check(false, `page error: ${e.message}`); });
  await journey('public booking journey', async () => {
  await pb.goto(`${base}/book?t=signed-token-abc&s=salon-1&api=${encodeURIComponent(base)}`);
  await pb.waitForSelector('#loadTimes');
  check((await pb.textContent('#selService'))?.includes('Gel Manicure'), 'services listed from the PUBLIC salon endpoint (no session)');
  await pb.click('#loadTimes');
  await pb.waitForSelector('.slot');
  check((await pb.$$('.slot')).length === 2, 'both open times rendered from the signed availability search');
  await pb.click('.slot');

  await pb.waitForSelector('#doBook');
  check((await pb.textContent('#review'))?.includes('10:00'), 'review line shows the chosen time before any details are typed');
  await pb.fill('#fName', 'Guest'); await pb.fill('#lName', 'Walkin'); await pb.fill('#phone', '(856) 555-0199');
  await pb.click('#doBook');

  // First submit is refused with the verification code — the page must say so, NOT claim success.
  await pb.waitForFunction(() => document.getElementById('whoMsg')?.textContent?.length > 0, null, { timeout: 8000 });
  check((await pb.textContent('#whoMsg'))?.toLowerCase().includes('verify'), 'PHONE_VERIFICATION_REQUIRED shown honestly (no fake success)');
  check(await pb.$eval('#scrDone', (el) => el.classList.contains('hide')), 'confirmation screen NOT shown on a refused booking');

  await pb.click('#doBook');   // second attempt succeeds in the stub
  await pb.waitForSelector('#doneDetail');
  check((await pb.textContent('#doneDetail'))?.includes('Gel Manicure') && (await pb.textContent('#doneDetail'))?.includes('Mia'), 'confirmation shows service, time and technician');

  const seq = calls.filter((c) => c.includes('/ai-booking/v1/public') || c.includes('/customer/salons/'));
  check(seq.includes('POST /api/ai-booking/v1/public/services') && !seq.includes('GET /customer/salons/salon-1/services') && seq.includes('POST /api/ai-booking/v1/public/availability/search') && seq.includes('POST /api/ai-booking/v1/public/appointments'),
    `guest journey called every public endpoint (${seq.length} recorded)`);
  check(!calls.some((c) => c.includes('/auth/login') && calls.indexOf(c) > calls.indexOf('GET /customer/salons/salon-1/services')), 'NO login call in the guest journey');
  });
  await pb.close();


} finally {
  await browser.close();
  server.close();
}

console.log('');
if (failures) { console.log(`FAILED — ${failures} assertion(s).`); process.exit(1); }
console.log(`OK — both single-file HTML apps (the kiosk and the public booking link) completed their primary journeys in a real browser (${calls.length} API calls verified).`);
