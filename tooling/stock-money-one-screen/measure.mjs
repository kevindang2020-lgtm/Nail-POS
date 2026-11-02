// measure.mjs — Stock Alerts + Transactions + Payments & Money one-screen certification (Oct 29 2026), on the finance harness's
// method. Starts live-server.mjs (real controllers + SQL on a seeded test database), loads the REAL POS bundle in Chromium
// and, per page × tenant × language × viewport, reports:
//   • page-level overflow: the document AND the page container (.work.fit) — the specs allow scrolling only inside panels;
//   • every module painted inside the viewport (header actions, the KPI cards, the workspace tabs, each panel's title AND its
//     pager, the all-time totals, the eight quick actions) — present, inside the viewport, and actually on top (not clipped);
//   • touch targets (the smallest hit boxes), the smallest table / KPI font, console errors, unserved API routes, a screenshot.
// Viewports = the CSS page a browser window leaves at 100 % zoom with the tab strip + address bar (~87 px) and the Windows
// taskbar (48 px) visible: 1920×1080 → 1920×945, 1536×864 → 1536×729, 1440×900 → 1440×765, 1366×768 → 1366×633.
//   node tooling/stock-money-one-screen/measure.mjs [label] [pages] [viewports]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TOOLS = process.env.TOOLS || '/opt/npm-tools/node_modules';
const { chromium } = createRequire(join(TOOLS, 'x.js'))('playwright');
const LABEL = process.argv[2] || 'run';
const PAGES = {
  'stock-alerts': { url: '/tenant/inventory/alerts', container: '.work.fit', modules: ['refresh', 'record-use', 'view-inventory', 'create-po', 'alert-settings', 'kpi-open', 'kpi-out', 'kpi-critical', 'kpi-uses', 'kpi-techs', 'tab-active', 'tab-usage', 'tab-technicians', 'tab-history', 'search', 'severity', 'show-ack', 'sa-list'] },
  'stock-usage': { url: '/tenant/inventory/alerts', tab: 'tab-usage', container: '.work.fit', modules: ['kpi-open', 'tab-usage', 'search', 'preset-month', 'preset-custom', 'date-basis', 'sa-list'] },
  'transactions': { url: '/tenant/payments/transactions', container: '.work.fit', modules: ['refresh', 'export', 'kpi-transactions', 'kpi-gross', 'kpi-tips', 'kpi-net', 'search', 'status', 'method', 'technician', 'min-amount', 'sort', 'preset-month', 'preset-custom', 'date-basis', 'ledger'] },
  'money': { url: '/tenant/payments/overview', container: '.work.fit', modules: ['refresh', 'financial-report', 'search', 'preset-today', 'preset-custom', 'kpi-revenue', 'kpi-collections', 'kpi-refunds', 'kpi-outstanding', 'kpi-transactions', 'kpi-average', 'kpi-failed', 'kpi-payouts', 'space-overview', 'space-transactions', 'space-revenue', 'space-payouts', 'panel-trend', 'panel-methods', 'panel-recent', 'totals', 'qa-record', 'qa-refund', 'qa-invoice', 'qa-tip', 'qa-payout', 'qa-report', 'qa-reconcile', 'qa-settings'] },
  'money-tx': { url: '/tenant/payments/overview', tab: 'space-transactions', container: '.work.fit', modules: ['kpi-collections', 'kind-all', 'kind-payments', 'kind-refunds', 'kind-voids', 'kind-pending', 'kind-failed', 'panel-transactions', 'totals', 'qa-settings'] },
  'money-payouts': { url: '/tenant/payments/overview', tab: 'space-payouts', container: '.work.fit', modules: ['panel-payouts', 'panel-health-wide', 'totals', 'qa-record'] },
};
const pages = (process.argv[3] || Object.keys(PAGES).join(',')).split(',');
const VIEWPORTS = (process.argv[4] || '1920x945,1536x729,1440x765,1366x633').split(',').map((v) => v.split('x').map(Number));
const RUNS = (process.env.RUNS || 'pilot:en,pilot:vi,empty:en').split(',').map((x) => x.split(':'));
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4399, BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 120; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const browser = await chromium.launch();
const rows = [];
try {
  for (const [tenant, lang] of RUNS) for (const key of pages) for (const [w, h] of VIEWPORTS) {
    const PG = PAGES[key];
    await fetch(`${BASE}/__tenant?name=${tenant}`); await fetch(`${BASE}/__lang?l=${lang}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
    await page.goto(`${BASE}${PG.url}`, { waitUntil: 'load' });
    await page.waitForSelector(PG.container, { timeout: 20000 }).catch(() => errors.push('page container never appeared'));
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined); await page.waitForTimeout(700);
    if (PG.preset) { await page.click(`[data-testid="${PG.preset}"]`).catch(() => errors.push('preset missing ' + PG.preset)); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined); await page.waitForTimeout(600); }
    if (PG.tab) { await page.click(`[data-testid="${PG.tab}"]`).catch(() => errors.push('tab missing ' + PG.tab)); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined); await page.waitForTimeout(600); }
    const m = await page.evaluate((PG) => {
      const se = document.scrollingElement; const vw = innerWidth, vh = innerHeight; const cp = document.querySelector(PG.container);
      const painted = (el) => { const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return 'zero'; if (b.top < -0.5 || b.left < -0.5 || b.bottom > vh + 0.5 || b.right > vw + 0.5) return 'outside'; const at = document.elementFromPoint(b.left + Math.min(b.width / 2, 24), b.top + Math.min(b.height / 2, 10)); return at && (el === at || el.contains(at) || at.contains(el)) ? true : 'covered'; };
      const mods = {}; for (const t of PG.modules) { const el = document.querySelector(`[data-testid="${t}"]`); mods[t] = el ? painted(el) : 'missing'; }
      // each panel's pager (when it has one) must be visible too — a list that pages inside its panel
      const pagers = [...cp.querySelectorAll('.fk-panel .fk-pager')].map((p) => ({ panel: p.closest('[data-testid]')?.getAttribute('data-testid'), ok: painted(p) }));
      const hit = (el0) => { const el = el0.matches('input[type="checkbox"]') && el0.closest('label') ? el0.closest('label') : el0; const b = el.getBoundingClientRect();   // a checkbox's target is its label
        const a = getComputedStyle(el, '::after'); let top = 0, bottom = 0, left = 0, right = 0;
        if (a.content && a.content !== 'none' && a.position === 'absolute') { top = -parseFloat(a.top) || 0; bottom = -parseFloat(a.bottom) || 0; left = -parseFloat(a.left) || 0; right = -parseFloat(a.right) || 0; }
        return { w: Math.round(b.width + left + right), h: Math.round(b.height + top + bottom) }; };
      const btns = [...cp.querySelectorAll('button, select, input[type="search"], input[type="checkbox"]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; });
      const small = btns.map((b) => ({ t: (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30), cls: b.className.toString().split(' ')[0], ...hit(b) })).filter((x) => Math.min(x.w, x.h) < 44);
      const font = Math.min(...[...cp.querySelectorAll('.fk-li-t, .fk-table td, .fk-kpi-l, .fk-panel-head h2, .fn-cell-v')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean));
      return { vw, vh, docScrollY: Math.max(0, se.scrollHeight - vh), docScrollX: Math.max(0, se.scrollWidth - vw), pageScrollY: cp ? Math.max(0, cp.scrollHeight - cp.clientHeight) : null, pageScrollX: cp ? Math.max(0, cp.scrollWidth - cp.clientWidth) : null,
        box: cp ? Math.round(cp.getBoundingClientRect().height) : null, modules: mods, pagers, smallTargets: small.slice(0, 12), smallTargetCount: small.length, minFontPx: font,
        rowsPerPanel: [...cp.querySelectorAll('.fk-panel')].map((p) => `${p.getAttribute('data-testid')}:${p.querySelectorAll('.fk-li, tbody tr').length}`).join(' ') };
    }, PG);
    const okMods = Object.values(m.modules).every((v) => v === true) && m.pagers.every((p) => p.ok === true);
    const pass = m.docScrollY === 0 && m.docScrollX === 0 && m.pageScrollY === 0 && m.pageScrollX === 0 && okMods && errors.length === 0;
    const shot = join(OUTDIR, `${key}-${tenant}-${lang}-${w}x${h}.png`); await page.screenshot({ path: shot });
    rows.push({ page: key, tenant, lang, viewport: `${w}x${h}`, pass, ...m, errors });
    const bad = [...Object.entries(m.modules).filter(([, v]) => v !== true).map(([k, v]) => `${k}=${v}`), ...m.pagers.filter((p) => p.ok !== true).map((p) => `pager:${p.panel}=${p.ok}`)];
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${key.padEnd(19)} ${tenant}/${lang} ${w}x${h}  doc ${m.docScrollY}/${m.docScrollX} page ${m.pageScrollY}/${m.pageScrollX}  rows[${m.rowsPerPanel}]  hidden: ${bad.join(', ') || '—'}  small targets ${m.smallTargetCount}  min font ${m.minFontPx}px${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  const un = await fetch(`${BASE}/__unhandled`).then((r) => r.json()).catch(() => []);
  writeFileSync(join(OUTDIR, 'measurements.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), rows, unhandledRoutes: un }, null, 1));
  console.log('unhandled routes:', JSON.stringify(un));
  srv.kill();
}
