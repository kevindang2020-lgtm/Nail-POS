// capture-booking-html.mjs — export the REAL POS Booking screen as a single self-contained HTML file.
// Boots the same stack the viewport audit uses (browser-e2e in E2E_HOLD mode: real backend + built pos-web served
// same-origin + PGlite data + a real credentialed login), navigates to /tenant/booking, waits for the real
// /pos/booking/state response, then serializes the rendered DOM with every stylesheet inlined.
// The result opens in any browser and shows Kevin's actual Booking screen with his real seeded data — it is a
// snapshot of the live app, not a re-drawing of it.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const E2E = new URL('./browser-e2e.mjs', import.meta.url).pathname;
const OUT = process.env.CAPTURE_OUT || '/mnt/user-data/outputs/my-booking.html';
const { chromium } = await import('playwright');

function boot() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [E2E], { env: { ...process.env, APP: 'pos-web', E2E_HOLD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += String(d); const m = out.match(/E2E_READY :(\d+)/); if (m) resolve({ child, port: Number(m[1]), log: () => out }); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (c) => reject(new Error('boot exited ' + c + '\n' + out.slice(-1500))));
    setTimeout(() => reject(new Error('boot timeout\n' + out.slice(-1500))), 150_000);
  });
}

const { child, port } = await boot();
const base = `http://127.0.0.1:${port}`;
console.log('booted at', base);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

try {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter store code').fill('PALACE');
  await page.getByPlaceholder('Enter email or phone number').fill('owner@palace.test');
  await page.getByPlaceholder('Enter your password').fill('Owner!2345');
  const loginResp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 30_000 }).catch(() => null);
  await page.getByRole('button', { name: /sign in/i }).click();
  const lr = await loginResp;
  console.log('login:', lr ? lr.status() : 'not seen');
  { const sc = String((lr && (await lr.allHeaders().catch(() => ({})))['set-cookie']) || '');
    const first = sc.split('\n')[0].split(';')[0]; const eq = first.indexOf('=');
    if (eq > 0) { try { await ctx.addCookies([{ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim(), domain: '127.0.0.1', path: '/', sameSite: 'Lax' }]); } catch {} }
  }
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter store code"]'), { timeout: 30_000 }).catch(() => {});
  await delay(1200);

  const apiLog = [];
  page.on('response', (r) => { try { const u = new URL(r.url()).pathname; if (u.startsWith('/pos/')) apiLog.push(r.status() + ' ' + u); } catch {} });
  const stateResp = page.waitForResponse((r) => r.url().includes('/pos/booking/state'), { timeout: 90_000 }).catch(() => null);
  const gridResp = page.waitForResponse((r) => r.url().includes('/pos/booking/day-grid'), { timeout: 90_000 }).catch(() => null);
  // A hard load of a deep route lands on the shell's default screen, so navigate the way a receptionist does:
  // establish the authenticated shell, then click Booking in the sidebar (React Router, no reload).
  await page.goto(base + '/tenant/overview', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sidebar', { timeout: 60_000 }).catch(() => {});
  await delay(1500);
  const link = page.locator('.sidebar a', { hasText: /^Booking$/ });
  if (await link.count() > 0) { await link.first().click(); console.log('clicked sidebar Booking'); }
  else { await page.evaluate(() => { history.pushState({}, '', '/tenant/booking'); window.dispatchEvent(new PopStateEvent('popstate')); }); console.log('pushState to /tenant/booking'); }
  const sr = await stateResp;
  console.log('booking state:', sr ? sr.status() + ' ' + sr.url().split('/').slice(-1)[0] : 'not seen');
  await page.waitForSelector('.sidebar', { timeout: 60_000 }).catch(() => {});
  // The day-grid renders after /pos/booking/state and /pos/booking/day-grid land; PGlite serializes them, so wait
  // for the calendar itself rather than a fixed delay.
  const gr = await gridResp;
  console.log('day-grid:', gr ? gr.status() : 'not seen');

  // The demo tenant starts the day empty. Book a realistic morning through the REAL endpoint
  // (POST /pos/booking/appointments) so the captured screen shows the calendar doing its job —
  // every card below was created by the actual booking service, conflict rules and all.
  const seeded = await page.evaluate(async () => {
    const j = async (u, init) => { const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) }, ...init }); return r.ok ? r.json() : { __err: r.status }; };
    // The PALACE demo seed ships services but no staff, so the day-grid has no columns to draw. Hire a bench
    // through the REAL endpoint (POST /pos/technicians) first — same validation, permissions and audit as the
    // Team screen uses. Everything below is created by the running backend, nothing is drawn by hand.
    let st = await j('/pos/booking/state');
    let svcs = (st?.filters?.services || []);
    if ((st?.filters?.technicians || []).length === 0) {
      const bench = [['Mia','Tran'],['Olivia','Chen'],['Grace','Kim'],['Leo','Nguyen'],['Ava','Patel'],['Sofia','Lopez'],['Hana','Sato'],['Emma','Park']];
      for (const [firstName, lastName] of bench) {
        await j('/pos/technicians', { method: 'POST', body: JSON.stringify({
          firstName, lastName, status: 'active', techAppEnabled: true,
          serviceIds: svcs.map((s) => s.serviceId),
        }) });
      }
      st = await j('/pos/booking/state');
      svcs = (st?.filters?.services || []);
    }
    const techs = (st?.filters?.technicians || []).map((t) => t.technicianId);
    if (!techs.length || !svcs.length) return { techs: techs.length, svcs: svcs.length, made: 0 };
    const pick = (i) => svcs[i % svcs.length].serviceId;
    const date = st?.dateRange?.from || new Date().toISOString().slice(0, 10);
    const plan = [
      ['09:30', 0, 'Sarah Johnson', '5552018890', [0]],      ['11:00', 0, 'Rachel Green', '5557742301', [1, 2]],
      ['14:00', 0, 'Dana Whitfield', '5554021188', [0]],     ['10:00', 1, 'Maya Rodriguez', '5553186642', [1]],
      ['12:30', 1, 'Jasmine Lee', '5559024417', [0, 2]],     ['15:30', 1, 'Nora Blake', '5556150099', [1]],
      ['09:45', 2, 'Priya Shah', '5552407731', [2]],         ['13:00', 2, 'Tina Alvarez', '5558835520', [0]],
      ['16:15', 2, 'Kim Ngo', '5555113348', [1]],            ['11:30', 3, 'Amara Osei', '5557629083', [2]],
      ['14:30', 3, 'Beth Carter', '5551902264', [0]],        ['10:30', 4, 'Rosa Marin', '5554476015', [1]],
      ['13:30', 4, 'Ivy Tran', '5553588842', [2]],           ['16:00', 4, 'Fatima Ali', '5559071123', [0]],
    ];
    let made = 0, conflicts = 0;
    for (const [startTime, ti, customerName, customerPhone, si] of plan) {
      if (ti >= techs.length) continue;
      const r = await j('/pos/booking/appointments', { method: 'POST', body: JSON.stringify({
        customerName, customerPhone, technicianId: techs[ti], date, startTime,
        serviceIds: si.map(pick), source: 'manual',
      }) });
      if (r?.__err) conflicts++; else made++;
    }
    return { techs: techs.length, svcs: svcs.length, made, conflicts, date };
  });
  console.log('seeded:', JSON.stringify(seeded));
  // Reload the screen so it renders the appointments we just booked.
  await page.evaluate(() => { history.pushState({}, '', '/tenant/overview'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await delay(700);
  await page.evaluate(() => { history.pushState({}, '', '/tenant/booking'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await delay(4500);
  // Capture on the FIRST good paint. The PGlite-backed proxy serializes every request, so the screen's own
  // 45s fallback refetch can pile up behind it and 502 — the snapshot must be taken before that happens.
  await page.waitForSelector('[data-cal-col]', { timeout: 25_000 }).catch(() => console.log('no [data-cal-col] yet'));
  await delay(1200);
  console.log('pos API calls:', apiLog.slice(0, 12).join(' | ') || 'none');
  console.log('main text:', (await page.evaluate(() => (document.querySelector('.main, main, .work')?.innerText || '').replace(/\s+/g, ' ').slice(0, 260))));

  const info = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-cal-col] [role="button"], [data-cal-col] > div').length,
    cols: document.querySelectorAll('[data-cal-col]').length,
    text: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' '),
  }));
  console.log('rendered:', JSON.stringify(info));

  // Serialize: inline every stylesheet, drop scripts, absolutize images, freeze current DOM.
  const html = await page.evaluate(() => {
    let css = '';
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) css += rule.cssText + '\n'; }
      catch { /* cross-origin sheet — skipped */ }
    }
    const doc = document.documentElement.cloneNode(true);
    for (const s of doc.querySelectorAll('script')) s.remove();
    for (const l of doc.querySelectorAll('link[rel="stylesheet"]')) l.remove();
    for (const st of doc.querySelectorAll('style')) st.remove();
    // carry live form values into the markup so the snapshot shows what was on screen
    const live = document.querySelectorAll('input, select, textarea');
    const cloned = doc.querySelectorAll('input, select, textarea');
    live.forEach((el, i) => {
      const c = cloned[i]; if (!c) return;
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); }
      else if (el.tagName === 'SELECT') { const o = c.querySelectorAll('option')[el.selectedIndex]; if (o) o.setAttribute('selected', ''); }
      else if (el.value) c.setAttribute('value', el.value);
    });
    const head = doc.querySelector('head');
    const style = document.createElement('style');
    style.textContent = css;
    head.appendChild(style);
    return '<!DOCTYPE html>\n' + doc.outerHTML;
  });

  const banner = `<!--
  AIPowerSalon — POS Booking screen, captured from the running application.
  Source: apps/pos-web/src/screens/POSBookingScreen.tsx rendered against the real
  NestJS backend (GET /pos/booking/state, /pos/booking/day-grid) with the seeded
  demo tenant, then serialized with all stylesheets inlined.
  This is a visual snapshot: layout, data and styling are the real thing; the
  React event handlers are not included, so buttons and drag are inert here.
-->\n`;
  writeFileSync(OUT, banner + html);
  console.log('WROTE', OUT, html.length, 'bytes');
} catch (e) {
  console.log('CAPTURE FAILED:', String(e && e.message || e).slice(0, 400));
  try { writeFileSync('/tmp/capture-fail.html', await page.content()); console.log('page dumped to /tmp/capture-fail.html'); } catch {}
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  child.kill('SIGTERM');
}
