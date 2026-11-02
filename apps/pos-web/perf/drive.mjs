// drive.mjs — REAL-BROWSER check of the Booking board (Smooth Refresh spec §53/§54, and a smoke test that the sync
// layer runs in Chromium at all). Run: npm run perf:booking -w apps/pos-web   (needs a Chromium; CHROMIUM_PATH or
// /opt/pw-browsers is searched). Builds nothing itself — perf:booking builds the harness first.
// Exits NON-ZERO if the page throws, the board does not render 12 columns, or a single-appointment refresh touches more
// than one technician column's DOM. The first run of this harness (Sep 30 2026) found "Illegal invocation" in the sync
// layer — every POS screen crashed in Chromium while every jsdom test passed.
import { existsSync, readdirSync } from 'node:fs';
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = `${base}/${d}/${sub}`; if (existsSync(p)) return p; }
  }
  return undefined;   // let Playwright use its own download
}
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.env.PERF_DIST || '/tmp/booking-perf-dist';
const srv = http.createServer((req, res) => {
  const p = path.join(root, req.url === '/' ? 'booking-harness.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`);
try { await page.waitForFunction(() => window.__perf && window.__perf.columnCount() === 12, null, { timeout: 20000 }); }
catch { console.error('BOOKING BROWSER CHECK FAILED: the board never rendered 12 columns.' + (errors.length ? '\n  page errors: ' + errors.join(' | ') : '')); await browser.close(); srv.close(); process.exit(1); }
await page.waitForTimeout(1000);
const initial = await page.evaluate(() => ({ commits: window.__perf.commits.map((c) => +c.actual.toFixed(2)), cards: window.__perf.appointmentCards(), base: Math.max(...window.__perf.commits.map((c) => c.base)).toFixed(2) }));
const runs = [];
for (let i = 0; i < 40; i++) runs.push(await page.evaluate(() => window.__perf.refreshOnce()));
const per = runs.map((r) => r.commitsMs.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
const q = (p) => per[Math.min(per.length - 1, Math.floor(p * per.length))].toFixed(2);
const colsHist = {}; runs.forEach((r) => { const k = r.columnsMutated.length; colsHist[k] = (colsHist[k] || 0) + 1; });
const which = {}; runs.forEach((r) => r.columnsMutated.forEach((c) => { which[c] = (which[c] || 0) + 1; }));
console.log(JSON.stringify({ chromium: browser.version(), initialCommitsMs: initial.commits, fullTreeBaseMs: initial.base, cardsRendered: initial.cards,
  refreshes: runs.length, renderMsPerRefresh: { p50: q(0.5), p95: q(0.95), max: per[per.length - 1].toFixed(2) },
  columnsWithDomMutationsPerRefresh: colsHist, mutatedColumnFrequency: which, pageErrors: errors.slice(0, 3) }, null, 1));
await browser.close(); srv.close();
const fail = [];
if (errors.length) fail.push('page errors: ' + errors.join(' | '));
if (initial.cards < 60) fail.push('board did not render all appointments');
if (Object.keys(colsHist).some((k) => Number(k) > 1)) fail.push('a single-appointment refresh mutated more than one column');
if (fail.length) { console.error('BOOKING BROWSER CHECK FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('booking browser check: OK');
