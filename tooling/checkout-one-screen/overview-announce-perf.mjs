// overview-announce-perf.mjs — Overview 27-inch mandate (Oct 28 2026) §36, §37. Two checks on the real POS bundle:
//  1. the Platform Announcement (none / short / long / long expanded / urgent) never adds a page scroll on the Overview at
//     1920×945 (1920×1080 with browser chrome + taskbar), and the Quick Actions stay inside the page;
//  2. performance on the 200-technician and very-busy datasets: the Overview API calls on first load, each payload's size,
//     time to the first painted KPI and to a settled page, and how many DOM rows the busy cards render.
// Writes results/ov-announce/*.png and results/ov-perf/perf.json. Fixture API only — no production data.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const OUT_A = join(HERE, 'results', 'ov-announce'); mkdirSync(OUT_A, { recursive: true });
const OUT_P = join(HERE, 'results', 'ov-perf'); mkdirSync(OUT_P, { recursive: true });
const PORT = 4324, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
let fails = 0; const perf = [];
const geo = () => { const p = document.querySelector('[data-testid="overview-page"]'); const qa = [...document.querySelectorAll('.ov-qa button')].map((b) => b.getBoundingClientRect().bottom);
  const bar = document.querySelector('[data-testid="platform-announcement"]');
  return { page: p.scrollHeight - p.clientHeight, pageX: p.scrollWidth - p.clientWidth, doc: document.scrollingElement.scrollHeight - innerHeight, qaBottom: Math.max(...qa), vh: innerHeight, bar: bar ? Math.round(bar.getBoundingClientRect().height) : 0, header: Math.round(document.querySelector('header.topbar')?.getBoundingClientRect().height || 0) }; };
try {
  for (const [kind, action] of [['none', null], ['info', null], ['long', null], ['long', 'more'], ['critical', null]]) {
    await fetch(`${BASE}/__state?name=busy`); await fetch(`${BASE}/__announce?kind=${kind}`);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 } }); const page = await ctx.newPage();
    await page.goto(`${BASE}/overview`, { waitUntil: 'load' }); await page.waitForSelector('[data-testid="overview-page"]'); await page.waitForTimeout(1000);
    if (action === 'more') { await page.locator('[data-testid="platform-announcement"] button', { hasText: /More/ }).first().click().catch(() => {}); await page.waitForTimeout(400); }
    const g = await page.evaluate(geo); const ok = g.page <= 0 && g.pageX <= 0 && g.doc <= 0 && g.qaBottom <= g.vh;
    if (!ok) fails++;
    const name = `ov-announce-${kind}${action ? '-' + action : ''}`; await page.screenshot({ path: join(OUT_A, name + '.png') });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(g)}`); await ctx.close();
  }
  await fetch(`${BASE}/__announce?kind=none`);
  for (const st of ['tech200', 'vbusy']) {
    await fetch(`${BASE}/__state?name=${st}`);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 } }); const page = await ctx.newPage();
    const calls = []; page.on('response', async (r) => { const u = new URL(r.url()); if (!/^\/(pos|tenant|auth|api)\//.test(u.pathname)) return; /* the POS calls /api/v1/... */ let bytes = 0; try { bytes = (await r.body()).length; } catch {} calls.push({ path: u.pathname, bytes }); });
    const t0 = Date.now(); await page.goto(`${BASE}/overview`, { waitUntil: 'load' });
    await page.waitForFunction(() => /\d/.test(document.querySelector('.ov-kpis')?.textContent || '')); const tKpi = Date.now() - t0;
    await page.waitForSelector('[data-testid="ov-techq"] tr'); await page.waitForLoadState('networkidle'); const tSettled = Date.now() - t0;
    const dom = await page.evaluate(() => ({ techqRows: document.querySelectorAll('[data-testid="ov-techq"] tr').length, invRows: document.querySelectorAll('[data-testid="ov-inventory"] .rank li').length, nodes: document.querySelectorAll('*').length }));
    const ov = calls.filter((c) => c.path.replace(/^\/api\/v1/, '').startsWith('/pos/overview'));
    const row = { state: st, overviewCalls: ov.length, overviewPaths: [...new Set(ov.map((c) => c.path))], largestPayloadBytes: Math.max(0, ...calls.map((c) => c.bytes)), largestPath: calls.sort((a, b) => b.bytes - a.bytes)[0]?.path, apiCalls: calls.length, msToKpis: tKpi, msToSettled: tSettled, ...dom };
    perf.push(row); console.log('PERF', JSON.stringify(row)); await ctx.close();
  }
  writeFileSync(join(OUT_P, 'perf.json'), JSON.stringify({ at: new Date().toISOString(), note: 'fixture API on localhost; times are the browser bundle + render, not the database', perf }, null, 1));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `${fails} announcement case(s) failed` : 'announcement: 5/5 passed'); process.exit(fails ? 1 : 0);
