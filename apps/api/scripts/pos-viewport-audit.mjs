// pos-viewport-audit.mjs — ASUS V470 migration acceptance check, run against the REAL logged-in app.
// Reuses browser-e2e.mjs's boot (backend + built pos-web same-origin + PGlite fallback + real login), then for each
// certification viewport (1920×1080 primary; 1536×864 = Windows 125%; 1280×720 = 150%; 1600×900; 1366×768; 2560×1440)
// visits the operational screens and measures, in-page:
//   - horizontal overflow: documentElement.scrollWidth vs clientWidth (browser-level horizontal scrollbar = FAIL)
//   - shell presence: .sidebar and .topbar visible within the viewport
//   - off-viewport interactive elements (right/bottom beyond viewport while part of the static layout)
//   - touch targets: visible interactive elements smaller than 40×40 CSS px (spec asks ~44 where practical; icons
//     inside larger hit areas are excluded by measuring the clickable element itself)
// Output: an honest per-viewport, per-route table. No screenshots are asserted — numbers only.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';

const E2E = new URL('./browser-e2e.mjs', import.meta.url).pathname;
// browser-e2e boots everything then exits; we want its BOOT only, so we re-implement the tiny boot inline by
// importing its helpers is not possible (script, not module) — instead we spawn the backend the same way it does.
// To keep this maintainable we shell out to a shared boot: run the API dist with PGlite wire (same env the e2e uses).
const { chromium } = await import('playwright');

const API_PORT = 4877;
const ALL_ROUTES = [
  // Oct 21 2026: the app's real routes (App.tsx) — the old /tenant/* spellings all fell through to /overview, so the
  // audit measured the same screen ten times; each line now records the path and heading that actually rendered.
  ['/live-operations', 'Live Operations'],
  ['/check-in', 'Check-In'],
  ['/booking', 'Booking'],
  ['/tech-queue', 'Tech Queue'],
  ['/queue', 'Customer Queue'],
  ['/serving', 'Serving'],
  ['/service-done', 'Service Done'],
  ['/checkout', 'Checkout'],
  ['/technicians', 'Technicians'],
  ['/services', 'Services'],
];
// AUDIT_ROUTES=first|second splits the run so each half fits a bounded CI/tool call (each boots its own stack).
const HALF = Math.ceil(ALL_ROUTES.length / 2);
const ROUTES = process.env.AUDIT_ROUTES === 'first' ? ALL_ROUTES.slice(0, HALF)
  : process.env.AUDIT_ROUTES === 'second' ? ALL_ROUTES.slice(HALF) : ALL_ROUTES;
const VIEWPORTS = [
  [1920, 1080, 'ASUS 27" 100% (PRIMARY)'],
  [1536, 864, 'Windows 125% scale'],
  [1280, 720, 'Windows 150% scale'],
  [1600, 900, '1600×900'],
  [1366, 768, '1366×768'],
  [2560, 1440, '2560×1440'],
];

function boot() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [E2E], { env: { ...process.env, APP: 'pos-web', E2E_HOLD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => {
      out += String(d);
      const m = out.match(/E2E_READY :(\d+)/);
      if (m) resolve({ child, port: Number(m[1]) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error('boot exited ' + code + '\n' + out.slice(-2000))));
    setTimeout(() => reject(new Error('boot timeout\n' + out.slice(-2000))), 240_000);
  });
}

let child = null; let base;
if (process.env.AUDIT_BASE) { base = process.env.AUDIT_BASE; }
else { const b = await boot(); child = b.child; base = `http://127.0.0.1:${b.port}`; }
// Oct 21 2026: same rule as e2e-html-apps.mjs — Playwright's pinned headless-shell may not be downloaded on a CI box; use
// CHROMIUM_PATH, else an installed Chromium under /opt/pw-browsers, else Playwright's own.
const CHROME = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));
const browser = await chromium.launch(CHROME ? { executablePath: CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Real login — with diagnostics if the form never appears
  const pageErrors = []; const badResponses = []; const okResponses = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('response', (r) => { try { const pth = new URL(r.url()).pathname; (r.status() >= 400 ? badResponses : okResponses).push(`${r.status()} ${pth}`); } catch {} });
  await page.goto(base + '/', { waitUntil: 'load' });
  const formUp = await page.waitForSelector('input[placeholder="Enter store code"]', { timeout: 45_000 }).then(() => true).catch(() => false);
  if (!formUp) {
    console.log('LOGIN FORM NEVER RENDERED — diagnostics:');
    console.log('  url:', page.url(), '| title:', await page.title());
    console.log('  body:', (await page.locator('body').innerText().catch(() => '(unreadable)')).replace(/\s+/g, ' ').slice(0, 300));
    console.log('  inputs on page:', await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.placeholder || i.name || i.type).join(', ') || '(none)'));
    console.log('  js errors:', pageErrors.slice(0, 4).join(' | ') || 'none');
    console.log('  responses:', okResponses.slice(0, 6).join(' | '));
    console.log('  bad responses:', badResponses.slice(0, 8).join(' | ') || 'none');
    throw new Error('login form missing');
  }
  await page.locator('#aps-store').fill('PALACE', { force: true, timeout: 15_000 });
  await page.locator('#aps-identifier').fill('owner@palace.test', { force: true, timeout: 15_000 });
  await page.locator('#aps-password').fill('Owner!2345', { force: true, timeout: 15_000 });
  const loginResp = page.waitForResponse((rr) => rr.url().includes('/auth/login'), { timeout: 20_000 }).catch(() => null);
  await page.getByRole('button', { name: 'Sign in' }).click({ force: true, timeout: 15_000 });
  const lr = await loginResp;
  console.log('login POST status:', lr ? lr.status() : 'NO /auth/login REQUEST SEEN', '| url:', lr ? lr.url() : '');
  { const sc = String((lr && (await lr.allHeaders().catch(() => ({})))['set-cookie']) || 'NONE'); const i = sc.indexOf(';'); console.log('set-cookie attrs:', i > 0 ? sc.slice(i) : sc); }
  await delay(800);
  // Chromium under the proxy declines to store the (valid) session cookie; the session itself is REAL — minted by
  // the real backend on a real credentialed login. Inject that same cookie into the context so full reloads keep
  // the session, exactly as a normal deployment would. (Storage quirk is environmental; noted in the report.)
  { const sc = String((lr && (await lr.allHeaders().catch(() => ({})))['set-cookie']) || '');
    const first = sc.split('\n')[0].split(';')[0]; const eq = first.indexOf('=');
    if (eq > 0) {
      const name = first.slice(0, eq).trim(); const value = first.slice(eq + 1).trim();
      console.log('inject cookie:', name, 'len=', value.length, 'charset-ok=', /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value));
      try { await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' }]); }
      catch (e) { console.log('addCookies failed:', String(e?.message || e).slice(0, 120)); }
    }
  }
  console.log('browser cookies:', (await ctx.cookies()).map((c) => `${c.name} sameSite=${c.sameSite}`).join(' | ') || 'NONE');
  if (lr && lr.status() !== 200) console.log('login body:', (await lr.text().catch(() => '')).slice(0, 300));
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter store code"]'), { timeout: 30_000 }).catch(() => {});
  try { const bb = page.locator('button.ghost'); if (await bb.count() > 0 && /branch|select/i.test(await page.locator('body').innerText())) { await bb.first().click(); await delay(1000); } } catch {}
  if (await page.locator('input[placeholder="Enter store code"]').count() > 0) console.log('note: SPA still showed login pre-reload; the injected session cookie governs the reloads.');
  await delay(1500);

  // Navigate each route ONCE (PGlite serializes API calls — navigation is the slow part), then re-measure the SAME
  // rendered page across every viewport: resizing reflows CSS without refetching, which is exactly what we're testing.
  let firstRoute = true;
  for (const [route, name] of ROUTES) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    if (firstRoute) {
      // One full load establishes the authenticated shell (AuthContext restore via /auth/me).
      const meResp = page.waitForResponse((rr) => rr.url().includes('/auth/me'), { timeout: 30_000 }).catch(() => null);
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      const me = await meResp;
      console.log('reload /auth/me:', me ? me.status() : 'not seen');
      await page.waitForSelector('.sidebar', { timeout: 60_000 }).catch(() => {});
      firstRoute = false;
    } else {
      // SPA navigation (no reload): React Router picks up popstate, only the target screen's data fires —
      // essential under the PGlite proxy, where every request is serialized.
      await page.evaluate((r) => { history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
    }
    await delay(2400);
    for (const [w, h, label] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await delay(450);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const vw = de.clientWidth, vh = de.clientHeight;
        const hOverflow = de.scrollWidth - vw;
        const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const sidebar = document.querySelector('.sidebar');
        const topbar = document.querySelector('.topbar, .main > header, .main > :first-child');
        const inter = [...document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')].filter(vis);
        let offViewport = 0;
        const small = [];
        for (const el of inter) {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 || (r.left < -1 && r.width > 4)) offViewport++;
          const wpx = Math.round(r.width), hpx = Math.round(r.height);
          if ((wpx < 40 || hpx < 40) && wpx > 4 && hpx > 4) small.push(`${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 18)} ${wpx}×${hpx}`);
        }
        return {
          hOverflow,
          sidebarOk: !!(sidebar && vis(sidebar)),
          topbarOk: !!(topbar && vis(topbar)),
          interCount: inter.length,
          offViewport,
          smallCount: small.length,
          smallSample: small.slice(0, 4),
          // the screen that actually rendered (an audit that measured the same page ten times would be worthless)
          heading: (document.querySelector('.main h1, main h1, h1')?.textContent || document.title || '').trim().slice(0, 28),
          path: location.pathname,
        };
      });
      results.push({ viewport: `${w}×${h}`, label, route: name, ...m });
    }
  }
} finally {
  await browser.close().catch(() => {});
  if (child) child.kill('SIGTERM');
}

// Honest report
let fails = 0;
console.log('\nVIEWPORT AUDIT (real logged-in app; PGlite demo tenant)');
for (const r of results) {
  const bad = r.hOverflow > 1 || !r.sidebarOk || !r.topbarOk || r.offViewport > 0;
  if (bad) fails++;
  console.log(
    `${bad ? 'FAIL' : ' ok '} ${r.viewport.padEnd(9)} ${r.route.padEnd(15)} hOverflow=${String(r.hOverflow).padStart(3)} sidebar=${r.sidebarOk ? 'y' : 'N'} topbar=${r.topbarOk ? 'y' : 'N'} at=${(r.path || '').replace('/tenant/', '')}:"${r.heading}" offVp=${r.offViewport} controls=${r.interCount} sub40px=${r.smallCount}${r.smallCount ? ' e.g. ' + r.smallSample.join(' | ') : ''}`,
  );
}
console.log(`\n${fails === 0 ? 'ALL LAYOUT CHECKS PASS' : fails + ' route×viewport layout FAILURES'} across ${results.length} checks`);
process.exit(fails === 0 ? 0 : 1);
