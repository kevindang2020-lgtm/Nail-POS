// session-refresh-browser.mjs — Constitution 3 Step 2b, proven in a REAL browser: the built POS (served on the same
// origin as the API through a tiny proxy) stays signed in past the access token's expiry, because its fetch wrapper
// refreshes once and retries. Run with an API on API_URL whose AUTH_ACCESS_TTL is short (60 s), and POS_DIST = a
// `vite build` of apps/pos-web. Exits non-zero on failure.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
const API = process.env.API_URL || 'http://127.0.0.1:3031', DIST = process.env.POS_DIST || '/tmp/pos-dist', PORT = Number(process.env.PORT_UI || 4321);
const IDLE_MS = Number(process.env.IDLE_MS || 65_000);
function chromiumPath() { const b = '/opt/pw-browsers'; if (existsSync(b)) for (const d of readdirSync(b).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) for (const s of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = `${b}/${d}/${s}`; if (existsSync(p)) return p; } }
const API_PREFIX = /^\/(auth|pos|owner|tech|customer|super-admin|health|media|realtime|client-telemetry)(\/|$|\?)/;
const srv = http.createServer((req, res) => {
  if (API_PREFIX.test(req.url)) {   // proxy to the API — same origin, so the SameSite=Lax cookies behave as in production
    const u = new URL(req.url, API);
    const p = http.request(u, { method: req.method, headers: { ...req.headers, host: u.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(p); p.on('error', () => { res.writeHead(502); res.end(); }); return;
  }
  let f = path.join(DIST, req.url.split('?')[0]); if (!existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(PORT, r));
const browser = await chromium.launch({ executablePath: chromiumPath() });
const ctx = await browser.newContext(); const page = await ctx.newPage();
const log = []; page.on('request', (r) => { const u = new URL(r.url()); if (API_PREFIX.test(u.pathname)) log.push(`${r.method()} ${u.pathname}`); });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const base = `http://127.0.0.1:${PORT}`;
const login = await ctx.request.post(`${base}/auth/login`, { data: { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' } });
const loginOk = login.ok();
await page.goto(base + '/'); await page.waitForTimeout(3000);
const before = await page.evaluate(() => fetch('/auth/me', { credentials: 'include' }).then((r) => r.status));
console.log(`login ${loginOk ? 'ok' : 'FAILED'} · /auth/me before idle ${before} · idling ${IDLE_MS / 1000}s past a short access token…`);
log.length = 0;
await page.waitForTimeout(IDLE_MS);
const after = await page.evaluate(() => fetch('/pos/booking/state', { credentials: 'include' }).then((r) => r.status));
const refreshes = log.filter((l) => l === 'POST /auth/refresh').length;
await page.reload(); await page.waitForTimeout(4000);
const onLogin = await page.evaluate(() => /salon code|sign in|log in/i.test(document.body.innerText) && !!document.querySelector('input[type=password]'));
console.log(`after idle: /pos/booking/state ${after} · refresh calls ${refreshes} · after reload on the sign-in screen: ${onLogin} · page errors ${errors.length}`);
await browser.close(); srv.close();
const pass = loginOk && before === 200 && after === 200 && refreshes === 1 && !onLogin && errors.length === 0;
console.log(pass ? 'session refresh browser check: OK' : 'session refresh browser check: FAILED');
process.exit(pass ? 0 : 1);
