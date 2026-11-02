// interact-overview.mjs — Overview one-screen END-TO-END behaviour checks (Overview 27-inch mandate Oct 28 2026 §4–§5,
// §10–§24, §30, §33–§36 automatable part). The real POS bundle against the fixture API (fixtures-ov.mjs) in Chromium at the
// primary 1920×945 page (1920×1080 with browser chrome + taskbar). Each check drives the UI like the front desk does and
// asserts what changed — on screen or in the URL.
//   node tooling/checkout-one-screen/interact-overview.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'overview-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4323; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function open(state, { w = 1920, h = 945 } = {}) {
  await fetch(`${BASE}/__state?name=${state}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/overview`, { waitUntil: 'load' });
  await page.waitForSelector('text=Live Tech Queue', { timeout: 15000 });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}
// the boxes of every module + KPI + the Quick Actions bar (layout stability across states, §5 / §30)
const boxes = (page) => page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','); };
  const cp = document.querySelector('.overview-page');
  return { page: cp.scrollHeight - cp.clientHeight, pageX: cp.scrollWidth - cp.clientWidth, doc: document.scrollingElement.scrollHeight - innerHeight, vh: innerHeight,
    cards: [...document.querySelectorAll('.overview-page [data-testid^="ov-"]')].map((e) => e.dataset.testid + ':' + r(e)), kpis: [...document.querySelectorAll('.overview-page .ov-kpi')].map(r),
    qa: r(document.querySelector('[data-testid="overview-quick-actions"]')), qaBottom: Math.round(document.querySelector('[data-testid="overview-quick-actions"]').getBoundingClientRect().bottom) }; });
const foot = (page, id) => page.locator(`[data-testid="${id}"] .ov-card-f`).textContent().then((t) => t || '');
// the URL right after the tap (a domain page may then add its own query, e.g. Checkout's ?ticket=); back = reopen Overview
const clickAndUrl = async (page, locator) => { const before = page.url(); await locator.click(); await page.waitForURL((u) => String(u) !== before, { timeout: 5000 }).catch(() => undefined); const u = page.url().replace(BASE, ''); await page.goto(`${BASE}/overview`); await page.waitForSelector('text=Live Tech Queue'); await page.waitForTimeout(700); return u; };

try {
  const geo = {};
  for (const st of ['empty', 'normal', 'busy', 'vbusy', 'long']) { const { ctx, page } = await open(st); geo[st] = await boxes(page); await ctx.close(); }
  check('every state fits one screen at 1920×945 (no vertical / horizontal page overflow, Quick Actions inside)', Object.values(geo).every((g) => g.page <= 0 && g.pageX <= 0 && g.doc <= 0 && g.qaBottom <= g.vh), Object.entries(geo).map(([k, g]) => `${k} ${g.page}/${g.pageX} qa ${g.qaBottom}`).join(' · '));
  const same = (k) => Object.values(geo).every((g) => JSON.stringify(g[k]) === JSON.stringify(geo.empty[k]));
  check('busy data never moves or resizes a card, a KPI or the Quick Actions (empty = normal = busy = very busy = long)', same('cards') && same('kpis') && same('qa'), `${geo.empty.cards.length} cards, ${geo.empty.kpis.length} KPIs`);

  { const { ctx, page, errors } = await open('busy');
    check('arrivals: top rows + "+11 more" from the server total (18), not a taller card', /\+11 more/.test(await foot(page, 'ov-arrivals')) && (await page.locator('[data-testid="ov-arrivals"] tr').count()) === 7);
    check('live tech queue: top 6 of 12 with minutes left from the server', /\+[0-9]+ more/.test(await foot(page, 'ov-techq')) && /min/.test((await page.locator('[data-testid="ov-techq"] tr').first().textContent()) || ''));
    const flowTxt = (await page.locator('[data-testid="ov-flow"]').textContent()) || '';
    check('service flow: server counts incl. Completed = paid today; sublists say "+N more"', /18\s*Waiting/.test(flowTxt) && /10\s*Completed/.test(flowTxt) && /\+6 more/.test(flowTxt) && /\+4 more/.test(flowTxt), flowTxt.slice(0, 120));
    check('inventory: 3 most urgent + "+17 more" (20 low)', (await page.locator('[data-testid="ov-inventory"] .rank li').count()) === 3 && /\+17 more/.test(await foot(page, 'ov-inventory')));
    const ins = await page.locator('[data-testid="ov-insights"] .ins').count();
    check('AI insights: top 4 + View All, each with Open', ins === 4 && (await page.locator('[data-testid="ov-insights"] .ins button').count()) === 4, `${ins}`);
    const u1 = await clickAndUrl(page, page.locator('[data-testid="ov-insights"] .ins button').first());
    check('an insight opens the page where staff act (advisory — /queue for the long wait)', u1.startsWith('/queue'), u1);
    await page.locator('[data-testid="ov-arrivals"] .ov-more').click(); await page.waitForTimeout(400);
    const fullTxt = (await page.locator('[data-testid="overview-full"]').textContent()) || '';
    check('View All (arrivals) opens the full-list overlay with the honest "7 of 18" and the queue link', /7 of 18/.test(fullTxt) && /View Full Queue/.test(fullTxt), fullTxt.slice(0, 80));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.locator('[data-testid="ov-comms"] .tab', { hasText: 'Messages' }).click(); await page.waitForTimeout(200);
    const msgRows = await page.locator('[data-testid="ov-comms"] tr').count(); const tabTxt = await page.locator('[data-testid="ov-comms"] .tabs').textContent();
    check('Communications: Messages tab shows the inbox threads; tabs carry the server counts', msgRows === 5 && /Reminders \(20\)/.test(tabTxt || '') && /Messages \(4\)/.test(tabTxt || ''), `${msgRows} rows · ${tabTxt}`);
    const u2 = await clickAndUrl(page, page.locator('[data-testid="ov-flow"] .flow-st').nth(3));
    check('a service-flow stage opens its domain page (Ready for Checkout → /checkout)', u2.startsWith('/checkout'), u2);
    // Start Service opens the queue filtered to guests ready to start (the queue consumes ?status= and tidies its URL)
    const log0 = (await fetch(`${BASE}/__log`).then((r) => r.json())).length;
    await clickAndUrl(page, page.locator('[data-testid="overview-quick-actions"] .qa-btn', { hasText: 'Start Service' }).first());
    const ss = (await fetch(`${BASE}/__log`).then((r) => r.json())).slice(log0 > 500 ? 0 : log0).some((l) => /\/pos\/queue\/state\?.*status=ready_for_tech/.test(l));
    const QA = { 'New Check-In': '/check-in', 'New Booking': '/booking', 'Walk-In': '/check-in', 'Assign Tech': '/queue', 'Start Service': '/queue', 'Take Payment': '/checkout', 'Add Product': '/tenant/inventory', 'Send Message': '/messages', 'Open Cash Drawer': '/cash-drawer' };
    const got = {}; for (const [l, want] of Object.entries(QA)) { const u = await clickAndUrl(page, page.locator('[data-testid="overview-quick-actions"] .qa-btn', { hasText: l }).first()); got[l] = u.startsWith(want) ? 'ok' : u; }
    check('all 9 Quick Actions open their real domain flow (no dead handler, no placeholder route)', Object.values(got).every((v) => v === 'ok') && ss, JSON.stringify(got) + ` · start-service filter ${ss}`);
    const live = await page.locator('[data-testid="overview-live"]').getAttribute('data-live');
    check('Live shows the realtime connection\'s real state', !!live, live);
    const t = await page.evaluate(() => { const qa = [...document.querySelectorAll('.qa-btn')].map((b) => b.getBoundingClientRect().height); const m = document.querySelectorAll('[data-testid="ov-arrivals"] .mini')[2]; const b = m.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top - 5); return { qa: Math.min(...qa), chip: Math.round(b.height), hitAbove: !!hit && (hit === m || m.contains(hit)) }; });
    check('touch: Quick Actions ≥ 44 px; a 28 px row chip still takes a tap 5 px above it (~40 px target)', t.qa >= 44 && t.hitAbove, JSON.stringify(t));
    check('no page errors (busy)', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  { const { ctx, page } = await open('vbusy');
    const rev = page.locator('.ov-kpi', { hasText: "Today's Revenue" });
    const v = (await rev.locator('.kv').textContent()) || ''; const title = await rev.getAttribute('title');
    check('a $2,450,000 KPI shows compact ($2.45M) without growing the card; the exact amount is the tooltip', /\$2\.45M/.test(v) && /2,450,000\.00/.test(title || ''), `${v} · ${title}`);
    check('very busy: 100 inventory alerts = 3 rows + "+97 more"; 300 reminders = 5 rows + "+295 more"', /\+97 more/.test(await foot(page, 'ov-inventory')) && /\+295 more/.test(await foot(page, 'ov-comms')));
    check('200 technicians: the Live Tech Queue shows 6 rows, never the roster', (await page.locator('[data-testid="ov-techq"] tr').count()) === 6);
    await ctx.close(); }

  // §11 / §21: a card's "+N more" counts only the rows it shows — every row it renders is fully inside its card body (none
  // hidden behind the card's internal scroll), at COMPACT 1920×945 and TIGHT 1600×765
  for (const [w, h] of [[1920, 945], [1600, 765]]) { const { ctx, page } = await open('busy', { w, h });
    const hidden = await page.evaluate(() => { const out = [];
      for (const card of document.querySelectorAll('.overview-page [data-testid^="ov-"]')) { const body = card.querySelector('.ov-card-b') || card; const bb = body.getBoundingClientRect();
        for (const row of card.querySelectorAll('.ov-tbl tbody tr, .rank li, .ins, .flow-sub-row')) { const rb = row.getBoundingClientRect(); if (rb.height > 0 && (rb.bottom > bb.bottom + 1 || rb.top < bb.top - 1)) out.push(card.dataset.testid); } }
      return [...new Set(out)]; });
    check(`every row a card shows is fully visible at ${w}×${h} (the "+N more" count is honest)`, hidden.length === 0, hidden.join(', ') || 'all visible');
    await ctx.close(); }

  { const { ctx, page } = await open('empty');
    const txt = (await page.locator('.overview-page').textContent()) || '';
    check('empty salon: compact empty states, no decorative insights', /No arrivals yet/.test(txt) && /No technicians currently serving/.test(txt) && /No low-stock products|no low stock/i.test(txt) && (await page.locator('[data-testid="ov-insights"] .ins').count()) === 0);
    await ctx.close(); }

  { const { ctx, page } = await open('long');
    const m = await page.evaluate(() => { const name = document.querySelector('.loc-salon'); const user = document.querySelector('.topbar'); const hs = [...document.querySelectorAll('.overview-page .ov-tbl tr')].map((r) => Math.round(r.getBoundingClientRect().height)); const tb = user.getBoundingClientRect(); return { rows: Math.max(...hs), topbarH: Math.round(tb.height), salonTrunc: name ? name.scrollWidth > name.clientWidth || getComputedStyle(name).textOverflow === 'ellipsis' : null }; });
    check('long salon / employee / guest / service names truncate — rows and the top bar keep their height', m.rows <= 30 && m.topbarH <= 64, JSON.stringify(m));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
