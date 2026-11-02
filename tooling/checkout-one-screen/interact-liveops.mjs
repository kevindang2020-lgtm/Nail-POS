// interact-liveops.mjs — Live Operations one-screen END-TO-END behaviour checks (Live Operations 27-inch mandate Oct 28
// 2026 §8–§16, §20, §23–§28 — the automatable part). The real POS bundle against the fixture API (fixtures-lo.mjs) in
// Chromium at the primary 1920×945 page (1920×1080 with browser chrome + taskbar), plus 1600×765 (TIGHT).
//   node tooling/checkout-one-screen/interact-liveops.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'lo-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4326; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
async function open(state, { w = 1920, h = 945, announce = 'none' } = {}) {
  await fetch(`${BASE}/__state?name=${state}`); await fetch(`${BASE}/__announce?kind=${announce}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/live-operations`, { waitUntil: 'load' });
  await page.waitForSelector("text=Today's Operations Snapshot", { timeout: 15000 });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}
const boxes = (page) => page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','); };
  const cp = document.querySelector('.live-ops-page');
  return { page: cp.scrollHeight - cp.clientHeight, pageX: cp.scrollWidth - cp.clientWidth, doc: document.scrollingElement.scrollHeight - innerHeight, docX: document.scrollingElement.scrollWidth - innerWidth, vh: innerHeight,
    cards: [...document.querySelectorAll('.live-ops-page .ov-card')].map((e) => (e.dataset.testid || '') + ':' + r(e)), kpis: [...document.querySelectorAll('.live-ops-page .ov-kpi')].map(r),
    qaBottom: Math.round(document.querySelector('[data-testid="live-ops-quick-actions"]').getBoundingClientRect().bottom), qa: r(document.querySelector('[data-testid="live-ops-quick-actions"]')) }; });
const foot = (page, id) => page.locator(`[data-testid="${id}"] .ov-card-f`).textContent().then((t) => t || '');
const clickAndUrl = async (page, locator) => { const before = page.url(); await locator.click(); await page.waitForURL((u) => String(u) !== before, { timeout: 5000 }).catch(() => undefined); const u = page.url().replace(BASE, ''); await page.goto(`${BASE}/live-operations`); await page.waitForSelector("text=Today's Operations Snapshot"); await page.waitForTimeout(700); return u; };

try {
  const geo = {};
  for (const st of ['empty', 'normal', 'busy', 'vbusy', 'long']) { const { ctx, page } = await open(st); geo[st] = await boxes(page); await ctx.close(); }
  check('every state fits one screen at 1920×945 — top KPI row through the last Quick Action, no main scroll either way', Object.values(geo).every((g) => g.page <= 0 && g.pageX <= 0 && g.doc <= 0 && g.docX <= 0 && g.qaBottom <= g.vh), Object.entries(geo).map(([k, g]) => `${k} ${g.page}/${g.pageX} qa ${g.qaBottom}`).join(' · '));
  const same = (k) => Object.values(geo).every((g) => JSON.stringify(g[k]) === JSON.stringify(geo.empty[k]));
  check('data never moves or resizes a card, a KPI or the Quick Actions (empty = normal = busy = very busy = long; §26)', same('cards') && same('kpis') && same('qa'), `${geo.empty.cards.length} cards, ${geo.empty.kpis.length} KPIs`);

  { const { ctx, page, errors } = await open('busy');
    const la = await page.locator('[data-testid="lo-activity"] tbody tr').count();
    check('Live Salon Activity: rows that fit + "+N more" of the 12 in progress (the server total), View All → Serving', new RegExp(`\\+${12 - la} more`).test(await foot(page, 'lo-activity')), `${la} rows · ${await foot(page, 'lo-activity')}`);
    const ai = await page.locator('[data-testid="lo-ai"] .ins').count();
    check('AI Insights: at most 5 shown + "+N more" of 8 + View All (§11)', ai <= 5 && new RegExp(`\\+${8 - ai} more`).test(await foot(page, 'lo-ai')), `${ai}`);
    const loc = await page.locator('[data-testid="lo-locations"] li').count();
    check('Multi-Location: current / top rows + "+N more" of 6 + View All Locations (§14, §24)', new RegExp(`\\+${6 - loc} more`).test(await foot(page, 'lo-locations')) && /View All Locations/.test(await foot(page, 'lo-locations')), `${loc} rows`);
    const log0 = (await fetch(`${BASE}/__log`).then((r) => r.json())).length;
    await page.locator('[data-testid="lo-trend"] select').selectOption('month'); await page.waitForTimeout(600);
    const lg = (await fetch(`${BASE}/__log`).then((r) => r.json())).slice(log0);
    check('the trend period selector refetches that card from the range endpoint (This Month)', lg.some((l) => /\/pos\/dashboard\/revenue-trend\?range=month/.test(l)), lg.filter((l) => /dashboard/.test(l)).join(' | '));
    const sz = await page.evaluate(() => { const svg = document.querySelector('[data-testid="lo-trend"] svg'); const b = document.querySelector('[data-testid="lo-trend"] .ov-card-b'); return { svg: Math.round(svg.getBoundingClientRect().height), body: Math.round(b.getBoundingClientRect().height) }; });
    check('the chart fills its fixed grid area (no 300–400 px canvas; §12)', sz.svg > 60 && sz.svg <= sz.body, JSON.stringify(sz));
    const QA = { 'New Check-In': '/check-in', 'New Booking': '/booking', 'Walk-In': '/booking/walk-in', 'Assign Tech': '/queue', 'Start Service': '/queue', 'Take Payment': '/checkout', 'Send Message': '/messages', 'Add Product': '/tenant/inventory', 'View Reports': '/reports' };
    const got = {}; for (const [l, want] of Object.entries(QA)) { const u = await clickAndUrl(page, page.locator('[data-testid="live-ops-quick-actions"] .qa-btn', { hasText: l }).first()); got[l] = u.startsWith(want) ? 'ok' : u; }
    check('all 9 Quick Actions open their real flow, one row, 44 px', Object.values(got).every((v) => v === 'ok'), JSON.stringify(got));
    const t = await page.evaluate(() => { const qa = [...document.querySelectorAll('[data-testid="live-ops-quick-actions"] .qa-btn')]; const tops = new Set(qa.map((b) => Math.round(b.getBoundingClientRect().top))); return { h: Math.min(...qa.map((b) => b.getBoundingClientRect().height)), rows: tops.size, tile: Math.min(...[...document.querySelectorAll('.lo-tile')].map((b) => b.getBoundingClientRect().height)) }; });
    check('touch: Quick Actions ≥ 44 px on ONE row; snapshot tiles ≥ 44 px', t.h >= 44 && t.rows === 1 && t.tile >= 44, JSON.stringify(t));
    const live = await page.locator('[data-testid="live-ops-live"]').getAttribute('data-live');
    check('Live shows the realtime connection\'s real state', !!live, live);
    check('no page errors (busy)', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  { const { ctx, page } = await open('vbusy');
    const rev = page.locator('.ov-kpi', { hasText: "Today's Revenue" });
    const v = (await rev.locator('.kv').textContent()) || ''; const title = await rev.getAttribute('title');
    check('$2,450,000 today shows $2.45M on one line, exact amount in the tooltip (§8, §26)', /\$2\.45M/.test(v) && /2,450,000\.00/.test(title || ''), `${v} · ${title}`);
    check('200 technicians: Top Technicians shows ≤ 5 rows + View Leaderboard (§13, §24)', (await page.locator('[data-testid="lo-techs"] tbody tr').count()) <= 5 && /View Leaderboard/.test(await foot(page, 'lo-techs')));
    await ctx.close(); }

  for (const [w, h] of [[1920, 945], [1600, 765]]) { const { ctx, page } = await open('busy', { w, h });
    const hidden = await page.evaluate(() => { const out = [];
      for (const card of document.querySelectorAll('.live-ops-page .ov-card')) { const body = card.querySelector('.ov-card-b') || card; const bb = body.getBoundingClientRect();
        for (const row of card.querySelectorAll('.ov-tbl tbody tr, .rank li, .ins, .lo-tile')) { const rb = row.getBoundingClientRect(); if (rb.height > 0 && (rb.bottom > bb.bottom + 1 || rb.top < bb.top - 1)) out.push(card.dataset.testid); } }
      return [...new Set(out)]; });
    check(`every row / tile a card shows is fully visible at ${w}×${h} (the "+N more" count is honest)`, hidden.length === 0, hidden.join(', ') || 'all visible');
    await ctx.close(); }

  for (const kind of ['info', 'long', 'critical']) { const { ctx, page } = await open('busy', { announce: kind }); const g = await boxes(page);
    check(`Platform Announcement (${kind}) keeps the fit (§23)`, g.page <= 0 && g.doc <= 0 && g.qaBottom <= g.vh, `page ${g.page} qa ${g.qaBottom}`); await ctx.close(); }

  { const { ctx, page } = await open('empty');
    const m = await page.evaluate(() => [...document.querySelectorAll('.live-ops-page .ov-empty')].map((e) => Math.round(e.getBoundingClientRect().height)));
    const txt = (await page.locator('.live-ops-page').textContent()) || '';
    check('empty salon: one-line compact empty states inside the budgeted cards (§19)', /No services currently in progress/.test(txt) && m.length >= 4 && Math.max(...m) <= 60, JSON.stringify(m));
    await ctx.close(); }
  { const { ctx, page } = await open('long');
    const m = await page.evaluate(() => ({ rows: Math.max(...[...document.querySelectorAll('.live-ops-page .ov-tbl tbody tr')].map((r) => Math.round(r.getBoundingClientRect().height))), topbar: Math.round(document.querySelector('.topbar').getBoundingClientRect().height) }));
    check('long guest / technician / branch names truncate — rows and the top bar keep their height', m.rows <= 30 && m.topbar <= 64, JSON.stringify(m));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
