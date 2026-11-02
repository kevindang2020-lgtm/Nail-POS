// interact-checkin.mjs — Check-In one-screen END-TO-END behaviour checks (Check-In 27-inch mandate Oct 28 2026 §5, §16–§28,
// §41, §51–§54, §67, §90, §93, §100–§101, §104–§106 — the automatable part). The real POS bundle against the stateful
// fixture API (fixtures-ci.mjs) in Chromium at the primary 1920×945 page (1920×1080 with browser chrome + taskbar).
//   node tooling/checkout-one-screen/interact-checkin.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'ci-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4325; const BASE = `http://127.0.0.1:${PORT}`;
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
  await page.goto(`${BASE}/check-in`, { waitUntil: 'load' });
  await page.waitForSelector('text=Live Check-In Queue', { timeout: 15000 });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}
const boxes = (page) => page.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','); };
  const cp = document.querySelector('.check-in-page');
  return { page: cp.scrollHeight - cp.clientHeight, pageX: cp.scrollWidth - cp.clientWidth, doc: document.scrollingElement.scrollHeight - innerHeight, vh: innerHeight,
    cards: [...document.querySelectorAll('.check-in-page .ov-card')].map((e) => (e.dataset.testid || '') + ':' + r(e)), kpis: [...document.querySelectorAll('.check-in-page .ov-kpi')].map(r),
    qa: r(document.querySelector('[data-testid="check-in-quick-actions"]')), qaBottom: Math.round(document.querySelector('[data-testid="check-in-quick-actions"]').getBoundingClientRect().bottom) }; });
const foot = (page, id) => page.locator(`[data-testid="${id}"] .ov-card-f`).textContent().then((t) => t || '');
const ciLog = () => fetch(`${BASE}/__ci`).then((r) => r.json());
const clickAndUrl = async (page, locator) => { const before = page.url(); await locator.click(); await page.waitForURL((u) => String(u) !== before, { timeout: 5000 }).catch(() => undefined); const u = page.url().replace(BASE, ''); await page.goto(`${BASE}/check-in`); await page.waitForSelector('text=Live Check-In Queue'); await page.waitForTimeout(700); return u; };

try {
  const geo = {};
  for (const st of ['empty', 'normal', 'busy', 'vbusy', 'long']) { const { ctx, page } = await open(st); geo[st] = await boxes(page); await ctx.close(); }
  check('every state fits one screen at 1920×945 (no vertical / horizontal page overflow, Quick Actions inside)', Object.values(geo).every((g) => g.page <= 0 && g.pageX <= 0 && g.doc <= 0 && g.qaBottom <= g.vh), Object.entries(geo).map(([k, g]) => `${k} ${g.page}/${g.pageX} qa ${g.qaBottom}`).join(' · '));
  const same = (k) => Object.values(geo).every((g) => JSON.stringify(g[k]) === JSON.stringify(geo.empty[k]));
  check('busy data never moves or resizes a card, a KPI or the Quick Actions (empty = normal = busy = very busy = long)', same('cards') && same('kpis') && same('qa'), `${geo.empty.cards.length} cards, ${geo.empty.kpis.length} KPIs`);

  { const { ctx, page, errors } = await open('busy');
    const qRows = await page.locator('[data-testid="ci-queue"] tbody tr').count();
    check('Live Check-In Queue: the rows that fit + "+N more" from the server total (41 active) — not a taller card', qRows >= 5 && new RegExp(`\\+${41 - qRows} more`).test(await foot(page, 'ci-queue')), `${qRows} rows · ${await foot(page, 'ci-queue')}`);
    const wRows = await page.locator('[data-testid="ci-lounge"] tbody tr').count();
    check('25 waiting guests: the lounge shows the longest waits + "+N more" of 25', wRows >= 4 && new RegExp(`\\+${25 - wRows} more`).test(await foot(page, 'ci-lounge')) && /52 min/.test(await page.locator('[data-testid="ci-lounge"] tbody tr').first().textContent()), `${wRows} rows`);
    const tTxt = (await page.locator('[data-testid="ci-techs"]').textContent()) || '';
    check('Available Technicians: real on-duty statuses as text (Available …), "12 of 24 available", top rows only', /12 of 24 available/.test(tTxt) && /Available/.test(tTxt) && (await page.locator('[data-testid="ci-techs"] tbody tr').count()) <= 6, tTxt.slice(0, 90));
    const kTxt = (await page.locator('[data-testid="check-in-kpis"]').textContent()) || '';
    check('KPIs: a real trend, the arriving window (Next 3 hours = the card\'s total 18), available / on duty', /12\.5% vs yesterday/.test(kTxt) && /18Next 3 hours/.test(kTxt) && /12 \/ 24/.test(kTxt), kTxt.slice(0, 140));
    // §19: tapping a guest opens the visit detail over the page; Escape closes it; the page did not navigate
    await page.locator('[data-testid="ci-queue"] tbody tr').first().locator('td').nth(1).click(); await page.waitForTimeout(500);
    const dlg = await page.locator('[data-testid="check-in-detail"]').textContent().catch(() => '');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('tapping a guest opens the visit detail (phone, services, status) without leaving Check-In; Escape closes', /\(856\) 555-/.test(dlg || '') && page.url().endsWith('/check-in') && (await page.locator('[data-testid="check-in-detail"]').count()) === 0, (dlg || '').slice(0, 80));
    // §35: appointment Check In = the canonical appointment check-in endpoint; the row leaves the arriving list
    const before = await ciLog();
    const firstAppt = await page.locator('[data-testid="ci-arriving"] tbody tr').first().textContent();
    await page.locator('[data-testid="ci-arriving"] tbody tr').first().locator('button').click(); await page.waitForTimeout(800);
    const after = await ciLog(); const firstAfter = await page.locator('[data-testid="ci-arriving"] tbody tr').first().textContent();
    check('appointment Check In posts the canonical appointment check-in and the page refreshes in place', after.log.length === before.log.length + 1 && after.log.at(-1).kind === 'appointment' && firstAfter !== firstAppt, JSON.stringify(after.log.at(-1)));
    const ins = await page.locator('[data-testid="ci-insights"] .ins').count();
    const u1 = await clickAndUrl(page, page.locator('[data-testid="ci-insights"] .ins .mini').first());
    check('Front Desk Insights: ≤ 5 shown + "+N more"; an insight opens where staff act (long wait → /queue)', ins <= 5 && /\+\d+ more/.test(await foot(page, 'ci-insights')) && u1.startsWith('/queue'), `${ins} · ${u1}`);
    const live = await page.locator('[data-testid="check-in-live"]').getAttribute('data-live');
    check('Live shows the realtime connection\'s real state', !!live, live);
    check('no page errors (busy)', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  { const { ctx, page } = await open('normal');
    // §21, §51: New Check-In / Walk-In open the Quick Check-In tab on THIS page (they used to navigate to /check-in itself)
    await page.locator('[data-testid="check-in-quick-actions"] .qa-btn', { hasText: 'Walk-In' }).click(); await page.waitForTimeout(300);
    const wiTab = await page.locator('[data-testid="quick-check-in"] [role="tab"][aria-selected="true"]').textContent();
    await page.locator('[data-testid="check-in-quick-actions"] .qa-btn', { hasText: 'New Check-In' }).click(); await page.waitForTimeout(300);
    const exTab = await page.locator('[data-testid="quick-check-in"] [role="tab"][aria-selected="true"]').textContent();
    check('Quick Actions New Check-In / Walk-In open the Quick Check-In tab in place', wiTab === 'Walk-In' && exTab === 'Existing Customer' && page.url().endsWith('/check-in'), `${wiTab} / ${exTab}`);
    // §27: switching tabs starts a clean form
    await page.locator('[data-testid="quick-check-in"] [role="tab"]', { hasText: 'Walk-In' }).click();
    await page.locator('[data-testid="quick-check-in"] input[aria-label="Guest name"]').pressSequentially('Walk Guest');
    await page.locator('[data-testid="quick-check-in"] [role="tab"]', { hasText: 'New Customer' }).click();
    await page.locator('[data-testid="quick-check-in"] [role="tab"]', { hasText: 'Walk-In' }).click();
    const kept = await page.locator('[data-testid="quick-check-in"] input[aria-label="Guest name"]').inputValue();
    check('switching Existing → New → Walk-In keeps no incompatible form data', kept === '', JSON.stringify(kept));
    // §28: three fast taps on Complete Check-In = one check-in (one request key, one visit, one queue entry)
    await page.locator('[data-testid="quick-check-in"] input[aria-label="Guest name"]').pressSequentially('Triple Tap');
    await page.locator('[data-testid="quick-check-in"] button', { hasText: 'Gel Manicure' }).first().click();
    const btn = page.locator('[data-testid="quick-check-in"] button', { hasText: 'Complete Check-In' });
    await Promise.all([btn.click(), btn.click({ force: true }).catch(() => {}), btn.click({ force: true }).catch(() => {})]); await page.waitForTimeout(900);
    const l = await ciLog(); const keys = new Set(l.log.filter((x) => x.kind === 'walk-in').map((x) => x.key));
    check('three fast taps on Complete Check-In → ONE check-in (one idempotency key, one visit)', l.walkIns === 1 && keys.size === 1, `${l.log.filter((x) => x.kind === 'walk-in').length} request(s), ${keys.size} key(s), ${l.walkIns} visit(s)`);
    const qTxt = (await page.locator('[data-testid="ci-queue"]').textContent()) || '';
    check('the new guest appears in the Live Check-In Queue without a page reload', /Triple Tap/.test(qTxt));
    // §25: New Customer = first / last / phone / optional email / SMS consent → the request carries all of them
    await page.locator('[data-testid="quick-check-in"] [role="tab"]', { hasText: 'New Customer' }).click();
    await page.locator('[data-testid="quick-check-in"] input[aria-label="First name *"]').pressSequentially('Mai');
    await page.locator('[data-testid="quick-check-in"] input[aria-label="Last name"]').pressSequentially('Pham');
    await page.locator('[data-testid="quick-check-in"] input[aria-label="Phone"]').pressSequentially('8565550199');
    await page.locator('[data-testid="quick-check-in"] input[aria-label="Email (optional)"]').pressSequentially('mai@example.com');
    await page.locator('[data-testid="quick-check-in"] input[type="checkbox"]').check();
    await page.locator('[data-testid="quick-check-in"] button', { hasText: 'Spa Pedicure' }).first().click();
    await page.locator('[data-testid="quick-check-in"] button', { hasText: 'Complete Check-In' }).click(); await page.waitForTimeout(800);
    const nb = (await ciLog()).log.filter((x) => x.kind === 'walk-in').at(-1)?.body || {};
    check('New Customer check-in sends first + last name, phone, email and the SMS consent (typed key by key)', nb.customerName === 'Mai Pham' && nb.customerEmail === 'mai@example.com' && nb.smsOptIn === true && nb.isNewCustomer === true && nb.customerPhone === '8565550199', JSON.stringify(nb).slice(0, 160));
    // the target page consumes its query (?assign=1, ?status=, ?add=1) and tidies its URL — the path is what is checked here
    const QA = { 'New Booking': '/booking', 'Assign Tech': '/queue', 'Start Service': '/queue', 'Take Payment': '/checkout', 'Send Message': '/messages', 'Add Product': '/tenant/inventory', 'View Reports': '/reports' };
    const got = {}; for (const [lb, want] of Object.entries(QA)) { const u = await clickAndUrl(page, page.locator('[data-testid="check-in-quick-actions"] .qa-btn', { hasText: lb }).first()); got[lb] = u.startsWith(want) ? 'ok' : u; }
    check('the other 7 Quick Actions open their real domain flow (no dead handler, no self-route)', Object.values(got).every((v) => v === 'ok'), JSON.stringify(got));
    const t = await page.evaluate(() => { const h = (sel) => Math.min(...[...document.querySelectorAll(sel)].map((b) => b.getBoundingClientRect().height)); return { qa: h('.qa-btn'), tabs: h('[data-testid="quick-check-in"] [role="tab"]'), input: h('[data-testid="quick-check-in"] input:not([type="checkbox"])'), complete: h('[data-testid="quick-check-in"] button') }; });
    check('touch: Quick Actions ≥ 44 px, Quick Check-In tabs / inputs ≥ 40 px', t.qa >= 44 && t.tabs >= 40 && t.input >= 40, JSON.stringify(t));
    await ctx.close(); }

  for (const [w, h] of [[1920, 945], [1600, 765]]) { const { ctx, page } = await open('busy', { w, h });
    const hidden = await page.evaluate(() => { const out = [];
      for (const card of document.querySelectorAll('.check-in-page .ov-card')) { const body = card.querySelector('.ov-card-b') || card; const bb = body.getBoundingClientRect();
        for (const row of card.querySelectorAll('.ov-tbl tbody tr, .rank li, .ins')) { const rb = row.getBoundingClientRect(); if (rb.height > 0 && (rb.bottom > bb.bottom + 1 || rb.top < bb.top - 1)) out.push(card.dataset.testid); } }
      return [...new Set(out)]; });
    check(`every row a card shows is fully visible at ${w}×${h} (the "+N more" count is honest)`, hidden.length === 0, hidden.join(', ') || 'all visible');
    await ctx.close(); }

  for (const kind of ['info', 'long', 'critical']) { const { ctx, page } = await open('busy', { announce: kind }); const g = await boxes(page);
    check(`Platform Announcement (${kind}) keeps the fit (§61)`, g.page <= 0 && g.doc <= 0 && g.qaBottom <= g.vh, `page ${g.page} qa ${g.qaBottom}`); await ctx.close(); }

  { const { ctx, page } = await open('vbusy');
    check('200 technicians / 50 waiting: Available Technicians ≤ 6 rows, the lounge ≤ 6 — never the roster', (await page.locator('[data-testid="ci-techs"] tbody tr').count()) <= 6 && (await page.locator('[data-testid="ci-lounge"] tbody tr').count()) <= 6);
    await ctx.close(); }
  { const { ctx, page } = await open('empty');
    const txt = (await page.locator('.check-in-page').textContent()) || '';
    check('empty salon: compact empty states, no fake comparison', /No check-ins yet today/.test(txt) && /No one waiting/.test(txt) && /No insights right now/.test(txt) && !/vs yesterday/.test(txt));
    await ctx.close(); }
  { const { ctx, page } = await open('long');
    const m = await page.evaluate(() => { const hs = [...document.querySelectorAll('.check-in-page .ov-tbl tbody tr')].map((r) => Math.round(r.getBoundingClientRect().height)); const nm = [...document.querySelectorAll('.check-in-page .ci-nm')].find((e) => /Alexandria/.test(e.textContent || '')); return { rows: Math.max(...hs), trunc: nm ? nm.scrollWidth > nm.clientWidth : null, title: nm?.closest('td')?.getAttribute('title') || null }; });
    check('"Alexandria Montgomery-Santos" and long services truncate with the full name as the tooltip — rows keep their height', m.rows <= 30 && m.trunc === true && m.title === 'Alexandria Montgomery-Santos', JSON.stringify(m));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
