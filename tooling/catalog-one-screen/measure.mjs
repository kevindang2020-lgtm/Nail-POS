// measure.mjs — Inventory · Products · Suppliers (+ Membership · Discounts) screen certification (Oct 29 2026), on the
// stock-money harness's method. Starts live-server.mjs (real controllers + SQL on a seeded test database), loads the REAL POS
// bundle in Chromium and, per page × tenant × language × viewport, reports:
//   • `fit` pages (Suppliers, Discounts): NO page scroll at all (document and the page container) — lists page in their panels;
//   • `scroll` pages (Inventory, Products, Membership — their specs allow vertical scrolling): NO sideways scroll anywhere, the
//     top modules painted on arrival, and the list's pager reachable by scrolling (scrolled into view, then painted on top);
//   • touch targets, the smallest table / KPI font, console errors, unserved API routes, a screenshot (top + after scroll).
// Viewports = the CSS page a 100 %-zoom browser leaves with the tab strip + address bar (~87 px) and the Windows taskbar
// (48 px): 1920×1080 → 1920×945, 1536×864 → 1536×729, 1440×900 → 1440×765, 1366×768 → 1366×633.
//   node tooling/catalog-one-screen/measure.mjs [label] [pages] [viewports]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PAGES } from './pages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TOOLS = process.env.TOOLS || '/opt/npm-tools/node_modules';
const { chromium } = createRequire(join(TOOLS, 'x.js'))('playwright');
const LABEL = process.argv[2] || 'run';
const pages = (process.argv[3] || Object.keys(PAGES).join(',')).split(',');
const VIEWPORTS = (process.argv[4] || '1920x945,1536x729,1440x765,1366x633').split(',').map((v) => v.split('x').map(Number));
const RUNS = (process.env.RUNS || 'pilot:en,pilot:vi,empty:en').split(',').map((x) => x.split(':'));
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = Number(process.env.HARNESS_PORT || 4397), BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), process.env.SERVER ? join(ROOT, process.env.SERVER) : join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const browser = await chromium.launch();
const rows = [];
try {
  for (const [tenant, lang] of RUNS) for (const key of pages) for (const [w, h] of VIEWPORTS) {
    const PG = PAGES[key];
    await fetch(`${BASE}/__tenant?name=${tenant}`); await fetch(`${BASE}/__lang?l=${lang}`); await fetch(`${BASE}/__role?r=OWNER`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
    await page.goto(`${BASE}${PG.url}`, { waitUntil: 'load' });
    await page.waitForSelector(PG.container, { timeout: 20000 }).catch(() => errors.push('page container never appeared'));
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined); await page.waitForTimeout(700);
    if (PG.tab) { await page.click(`[data-testid="${PG.tab}"]`).catch(() => errors.push('tab missing ' + PG.tab)); await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined); await page.waitForTimeout(600); }
    const measure = (mods) => page.evaluate(({ PG, mods }) => {
      const se = document.scrollingElement; const vw = innerWidth, vh = innerHeight; const cp = document.querySelector(PG.container);
      const painted = (el) => { const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return 'zero'; if (b.top < -0.5 || b.left < -0.5 || b.bottom > vh + 0.5 || b.right > vw + 0.5) return 'outside'; const at = document.elementFromPoint(b.left + Math.min(b.width / 2, 24), b.top + Math.min(b.height / 2, 10)); return at && (el === at || el.contains(at) || at.contains(el)) ? true : 'covered'; };
      const pick = (t0) => { const t = t0.replace(/^\?/, ''); return t === '@pager' ? cp?.querySelector('.fk-pager') : document.querySelector(`[data-testid="${t}"]`); };
      // `?x` = optional (a row module on an empty tenant): absent is fine, present must be painted
      const out = {}; for (const t of mods) { const el = pick(t); out[t] = el ? painted(el) : t.startsWith('?') ? true : 'missing'; }
      // the widest descendant: any element sticking out of the page container to the right is sideways overflow
      let wide = 0; if (cp) { const right = cp.getBoundingClientRect().right; for (const el of cp.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && r.right > right + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.fk-panel-body')) wide = Math.max(wide, Math.round(r.right - right)); } }
      const scroller = (() => { let el = cp; while (el && el !== document.body) { const s = getComputedStyle(el); if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el; el = el.parentElement; } return se; })();
      const hit = (el0) => { const el = el0.matches('input[type="checkbox"]') && el0.closest('label') ? el0.closest('label') : el0; const b = el.getBoundingClientRect();
        const a = getComputedStyle(el, '::after'); let top = 0, bottom = 0, left = 0, right = 0;
        if (a.content && a.content !== 'none' && a.position === 'absolute') { top = -parseFloat(a.top) || 0; bottom = -parseFloat(a.bottom) || 0; left = -parseFloat(a.left) || 0; right = -parseFloat(a.right) || 0; }
        return { w: Math.round(b.width + left + right), h: Math.round(b.height + top + bottom) }; };
      const btns = cp ? [...cp.querySelectorAll('button, select, input[type="search"], input[type="checkbox"]')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; }) : [];
      const small = btns.map((b) => ({ t: (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30), cls: b.className.toString().split(' ')[0], ...hit(b) })).filter((x) => Math.min(x.w, x.h) < 44);
      const font = cp ? Math.min(...[...cp.querySelectorAll('.fk-li-t, .fk-table td, .fk-kpi-l, .fk-panel-head h2')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean)) : 0;
      return { vw, vh, docScrollY: Math.max(0, se.scrollHeight - vh), docScrollX: Math.max(0, se.scrollWidth - vw), pageScrollY: cp ? Math.max(0, cp.scrollHeight - cp.clientHeight) : null, pageScrollX: cp ? Math.max(0, cp.scrollWidth - cp.clientWidth) : null,
        scrollerY: scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0, sticking: wide, modules: out, smallTargets: small.slice(0, 12), smallTargetCount: small.length, minFontPx: font,
        rowsPerPanel: cp ? [...cp.querySelectorAll('.fk-panel')].map((p) => `${p.getAttribute('data-testid')}:${p.querySelectorAll('.fk-li, tbody tr').length}`).join(' ') : '' };
    }, { PG, mods });
    const m = await measure(PG.modules);
    const shot = join(OUTDIR, `${key}-${tenant}-${lang}-${w}x${h}.png`); await page.screenshot({ path: shot });
    let below = null;
    if (PG.mode === 'scroll' && PG.below?.length) {
      // scroll each module below the fold (the list's pager, …) into view in turn — then it must be painted on top
      below = {};
      for (const t of PG.below) {
        await page.evaluate(({ t: t0, c }) => { const t = t0.replace(/^\?/, ''); return (t === '@pager' ? document.querySelector(c + ' .fk-pager') : document.querySelector(`[data-testid="${t}"]`))?.scrollIntoView({ block: 'center' }); }, { t, c: PG.container }); await page.waitForTimeout(250);
        Object.assign(below, (await measure([t])).modules);
      }
      await page.screenshot({ path: shot.replace('.png', '-scrolled.png') });
    }
    const okMods = Object.values(m.modules).every((v) => v === true) && (!below || Object.values(below).every((v) => v === true));
    const noSideways = m.docScrollX === 0 && m.pageScrollX === 0 && m.sticking === 0;
    const pass = noSideways && okMods && errors.length === 0 && (PG.mode === 'scroll' || (m.docScrollY === 0 && m.pageScrollY === 0));
    rows.push({ page: key, tenant, lang, viewport: `${w}x${h}`, pass, ...m, below, errors });
    const bad = [...Object.entries(m.modules).filter(([, v]) => v !== true).map(([k, v]) => `${k}=${v}`), ...Object.entries(below ?? {}).filter(([, v]) => v !== true).map(([k, v]) => `below:${k}=${v}`)];
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${key.padEnd(18)} ${tenant}/${lang} ${w}x${h}  doc ${m.docScrollY}/${m.docScrollX} page ${m.pageScrollY}/${m.pageScrollX} stick ${m.sticking}  rows[${m.rowsPerPanel}]  hidden: ${bad.join(', ') || '—'}  small ${m.smallTargetCount}  font ${m.minFontPx}px${errors.length ? '  ERRORS ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  const un = await fetch(`${BASE}/__unhandled`).then((r) => r.json()).catch(() => []);
  writeFileSync(join(OUTDIR, 'measurements.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), rows, unhandledRoutes: un }, null, 1));
  console.log('unhandled routes:', JSON.stringify(un));
  srv.kill();
}
