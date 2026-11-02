// interact-serving.mjs — Serving one-screen END-TO-END behaviour checks (Serving mandate Oct 28 2026 §18–§21, §27–§31,
// §46–§62, §68–§80, §87–§89, §112–§114, §134 automatable part). The real POS bundle against the STATEFUL fixture API
// (fixtures-sv.mjs) in Chromium at the primary 1920×945 page (1920×1080 with browser chrome + taskbar). Each check drives
// the UI like the front desk does and asserts what changed — on screen, in the URL, or in the requests the POS sent.
//   node tooling/checkout-one-screen/interact-serving.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'serving-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4321; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const logLines = async () => (await fetch(`${BASE}/__log`).then((r) => r.json()));
const count = async (re) => (await logLines()).filter((l) => re.test(l)).length;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function open(state, { w = 1920, h = 945 } = {}) {
  await fetch(`${BASE}/__state?name=${state}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/serving`, { waitUntil: 'load' });
  await page.waitForSelector('text=Live Service Floor', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}
const geometry = (page) => page.evaluate(() => { const cp = document.querySelector('.serving-page'); const qa = document.querySelector('[data-testid="serving-quick-actions"]').getBoundingClientRect(); const g = document.querySelector('[data-testid="sv-guest"]').getBoundingClientRect(); return { pageMax: cp.scrollHeight - cp.clientHeight, docMax: document.scrollingElement.scrollHeight - innerHeight, qaTop: Math.round(qa.top), guestH: Math.round(g.height) }; });
const qa = (page, label) => page.locator('[data-testid="serving-quick-actions"] button', { hasText: label }).first();
const closeOverlay = (page) => page.locator('[role="dialog"] button', { hasText: 'Close' }).first().click();
const row = (page, n) => page.locator('[data-testid="sv-floor"] tr.co-row').nth(n);
const rowFor = (page, tid) => page.locator(`[data-testid="sv-floor"] tr.co-row[data-ticket="${tid}"]`);
const note = (page) => page.locator('[data-testid="serving-note"]').textContent().catch(() => '');

try {
  // ── normal floor: selection, legal moves, idempotent start / ready / send, upsell, update, staff alert ──
  { const { ctx, page } = await open('normal');
    const g0 = await geometry(page);
    check('normal floor: no page scroll at 1920×945', g0.pageMax <= 0 && g0.docMax <= 0, `page ${g0.pageMax}, doc ${g0.docMax}`);
    // §21: tapping a row fills Guest Service Details without expanding the row or the page
    const h0 = await row(page, 2).evaluate((r) => r.getBoundingClientRect().height);
    await row(page, 2).click(); await page.waitForTimeout(500);
    const g1 = await geometry(page); const name2 = (await row(page, 2).locator('td').nth(1).textContent()) || '';
    const guestText = (await page.locator('[data-testid="sv-guest"]').textContent()) || '';
    const h1 = await row(page, 2).evaluate((r) => r.getBoundingClientRect().height);
    check('row tap selects the guest into Guest Service Details (no row / page growth)', guestText.includes(name2.replace(/VIP$/, '').trim().split(/(?=[A-Z][a-z]+ [A-Z])/)[0].slice(0, 6)) && h0 === h1 && g1.guestH === g0.guestH && g1.pageMax <= 0, `row ${h0}→${h1}, guest ${g0.guestH}→${g1.guestH}`);
    // §31: Move Stage offers only the legal next states — a Ready-to-Start guest can only Start
    const rts = id(1000);   // plan[0] = ready to start
    await rowFor(page, rts).click(); await page.waitForTimeout(400);
    await qa(page, 'Move Stage').click(); await page.waitForTimeout(300);
    const moves = await page.locator('[data-testid="sv-move-menu"] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action')));
    check('Move Stage for a Ready-to-Start guest offers only Start Service', moves.length === 1 && moves[0] === 'start', JSON.stringify(moves));
    await closeOverlay(page);
    check('Mark Ready is off for a guest never started (no Ready → Service Done jump)', (await qa(page, 'Mark Ready').getAttribute('aria-disabled')) === 'true');
    // §24–§25: Start Service → in service; a second tap is idempotent
    const s0 = await count(/POST \/pos\/serving\/tickets\/[^ ]+\/start/);
    await qa(page, 'Start Service').click(); await page.waitForTimeout(700);
    const n1 = await note(page);
    const stageAfter = (await rowFor(page, rts).locator('.sv-stage').textContent()) || '';
    check('Start Service starts the guest (server answer reconciled into the floor)', /Service started/.test(n1 || '') && /In Service/.test(stageAfter), `${n1} · ${stageAfter}`);
    await qa(page, 'Start Service').click({ force: true }); await page.waitForTimeout(500);   // a double tap before the floor refreshes
    const n2 = await note(page); const s1 = await count(/POST \/pos\/serving\/tickets\/[^ ]+\/start/);
    check('a second Start is idempotent — "already in service", no second start request', /Already in service/i.test(n2 || '') && s1 - s0 === 1, `${n2} · ${s1 - s0} start POST(s)`);
    // Move Stage for an in-service guest: pause / delay / mark ready / send
    await qa(page, 'Move Stage').click(); await page.waitForTimeout(300);
    const moves2 = await page.locator('[data-testid="sv-move-menu"] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action')));
    check('Move Stage for an in-service guest: Pause · Report Delay · Mark Ready · Send to Service Done', JSON.stringify(moves2) === JSON.stringify(['pause', 'report_delay', 'mark_ready', 'send_to_service_done']), JSON.stringify(moves2));
    await closeOverlay(page);
    // §35–§37 / §104: Mark Ready → Service Done; again → idempotent
    await qa(page, 'Mark Ready').click(); await page.waitForTimeout(700);
    const st3 = (await rowFor(page, rts).locator('.sv-stage').textContent()) || '';
    check('Mark Ready moves the guest to Ready for Service Done', /Ready/.test(st3) && /Ready for Service Done/.test((await note(page)) || ''), st3);
    check('a guest at Service Done: Mark Ready is off; Send to Service Done stays offered', (await qa(page, 'Mark Ready').getAttribute('aria-disabled')) === 'true');
    await page.locator('[data-testid="sv-guest"] button', { hasText: 'Send to Service Done' }).click(); await page.waitForTimeout(600);
    const sent1 = (await fetch(`${BASE}/__sv`).then((r) => r.json())).sent.length;
    check('Send to Service Done hands the guest off once', sent1 === 1 && /Sent to Service Done/.test((await note(page)) || ''), `${sent1} handoff(s)`);
    // Add Upsell (§46–§49): an add-on SERVICE from the catalog with a client request id; the line appears, revenue moves
    await row(page, 1).click(); await page.waitForTimeout(400);
    const pot0 = await page.locator('text=Potential Revenue in Progress').locator('..').textContent();
    await qa(page, 'Add Upsell').click(); await page.waitForTimeout(400);
    await page.locator('[data-testid="sv-addon-list"] button').first().click(); await page.waitForTimeout(700);
    const addLog = (await logLines()).filter((l) => /POST \/pos\/serving\/tickets\/[^ ]+\/add-service/.test(l));
    const body = addLog.length ? JSON.parse(addLog.at(-1).replace(/^[^{]*/, '')) : {};
    const pot1 = await page.locator('text=Potential Revenue in Progress').locator('..').textContent();
    check('Add Upsell adds a catalog add-on SERVICE (serviceId + clientRequestId, no client price)', addLog.length === 1 && !!body.serviceId && !!body.clientRequestId && body.priceOverrideCents == null, JSON.stringify(body));
    check('the add-on reaches the floor: Guest Service Details lists it and Potential Revenue moves', /Nail Art/.test((await page.locator('[data-testid="sv-guest"]').textContent()) || '') && pot0 !== pot1, `${pot0?.slice(-20)} → ${pot1?.slice(-20)}`);
    // Send Update (§72): communications path; SMS is honest
    await qa(page, 'Send Update').click(); await page.waitForTimeout(300);
    await page.locator('[role="dialog"] button', { hasText: 'Text message' }).click();
    await page.locator('[data-testid="sv-send-update"]').click(); await page.waitForTimeout(600);
    check('Send Update by text answers honestly (not configured)', /not configured/i.test((await note(page)) || ''));
    await qa(page, 'Send Update').click(); await page.waitForTimeout(300);
    await page.locator('[data-testid="sv-send-update"]').click(); await page.waitForTimeout(600);
    const upd = (await logLines()).filter((l) => /notify-customer/.test(l)).at(-1) || '';
    check('Send Update to the app goes through notify-customer (channel app)', /"channel":"app"/.test(upd) && /sent to the guest/i.test((await note(page)) || ''), upd.slice(0, 140));
    // Send Staff Alert (§58)
    await page.locator('[data-testid="sv-staff-alert"]').click(); await page.waitForTimeout(300);
    // typed key by key like a person — fill() hid an overlay that remounted on every keystroke (Customer Queue review)
    await page.locator('[role="dialog"] input[aria-label="Message"]').click(); await page.keyboard.type('Guest asks for a top coat', { delay: 5 });
    await page.locator('[data-testid="sv-send-alert"]').click(); await page.waitForTimeout(600);
    const alerts = (await fetch(`${BASE}/__sv`).then((r) => r.json())).alerts;
    check('Send Staff Alert sends one notice to the chosen technician', alerts.length === 1 && !!alerts[0].technicianId && alerts[0].message === 'Guest asks for a top coat', JSON.stringify(alerts[0] || {}));
    // §73: Open Customer keeps the context
    await page.locator('select[aria-label="Service filter"]').selectOption('Pedicure'); await page.waitForTimeout(500);
    await row(page, 0).click(); await page.waitForTimeout(400);
    const pickedRow = await row(page, 0).getAttribute('data-ticket');
    await qa(page, 'Open Customer').click(); await page.waitForTimeout(500);
    const url = page.url();
    check('Open Customer opens the guest\'s profile (customerId in the URL)', /\/customers\?.*customerId=/.test(url), url.replace(BASE, ''));
    await page.goBack(); await page.waitForSelector('text=Live Service Floor'); await page.waitForTimeout(900);
    const filt = await page.locator('select[aria-label="Service filter"]').inputValue();
    const selBack = await page.locator('[data-testid="sv-floor"] tr.co-row[style*="252, 243, 228"]').getAttribute('data-ticket').catch(() => null);
    check('back on Serving: the filter and the selected guest are kept', filt === 'Pedicure' && selBack === pickedRow, `filter ${filt}, selected ${selBack} (was ${pickedRow})`);
    // §76–§77: Live + Auto Refresh
    const live = await page.getAttribute('[data-testid="serving-live"]', 'data-live');
    check('Live shows the real connection state', ['CONNECTED', 'RECONNECTING', 'OFFLINE', 'DEGRADED'].includes(live || ''), String(live));
    const ar = page.locator('[data-testid="serving-auto-refresh"]'); const a0 = await ar.getAttribute('aria-pressed'); await ar.click(); const a1 = await ar.getAttribute('aria-pressed'); await ar.click();
    check('Auto Refresh is a real switch', a0 !== a1, `${a0}→${a1}`);
    await ctx.close(); }

  // ── busy floor (§86–§87): counts are the server's, staff capped, Auto Balance recommends only ──
  { const { ctx, page } = await open('busy');
    const g = await geometry(page);
    check('busy floor (40 serving, 10 finishing, 8 ready, 5 delayed): no page scroll', g.pageMax <= 0 && g.docMax <= 0, `page ${g.pageMax}, doc ${g.docMax}`);
    const counts = await page.evaluate(() => Object.fromEntries(['start', 'inservice', 'finishing', 'ready'].map((k) => [k, Number(document.querySelector(`[data-testid="sv-count-${k}"]`)?.textContent)])));
    check('board counts are the server\'s stage counts over the WHOLE floor (3 · 30 · 10 · 8), not the loaded page', counts.start === 3 && counts.inservice === 30 && counts.finishing === 10 && counts.ready === 8, JSON.stringify(counts));
    const staffRows = await page.locator('[data-testid="sv-staff"] tbody tr').count();
    const summary = (await page.locator('[data-testid="sv-staff-summary"]').textContent()) || '';
    check('200 technicians → 8 rows + the counts for everyone on duty', staffRows === 8 && /100 on duty/.test(summary), `${staffRows} rows · ${summary}`);
    const delayedRow = await page.locator('[data-testid="sv-floor"] tr.sv-delayed .sv-stage').first().textContent();
    check('a delayed service is marked with text + icon, not colour alone', /⚠/.test(delayedRow || '') && /Delayed/.test(delayedRow || ''), delayedRow);
    const b0 = await count(/assign-technician/);
    await page.locator('[data-testid="sv-auto-balance"]').click(); await page.waitForTimeout(600);
    const sug = await page.locator('[data-testid="sv-balance-list"] > div').count();
    check('Auto Balance lists recommendations and assigns nothing by itself', sug >= 1 && (await count(/assign-technician/)) === b0, `${sug} suggestion(s)`);
    await page.locator('[data-testid="sv-balance-list"] button', { hasText: 'Assign' }).first().click(); await page.waitForTimeout(600);
    check('a person assigns one recommendation → one assign-technician request', (await count(/POST \/pos\/serving\/tickets\/[^ ]+\/assign-technician/)) - b0 === 1);
    await closeOverlay(page).catch(() => undefined);
    // §80: a note floats over the floor
    const qa0 = (await geometry(page)).qaTop;
    await qa(page, 'Send Update').click({ force: true }); await page.waitForTimeout(300); await page.locator('[role="dialog"] button', { hasText: 'Text message' }).click(); await page.locator('[data-testid="sv-send-update"]').click(); await page.waitForTimeout(500);
    const g2 = await geometry(page);
    check('a note does not move the layout (Quick Actions stay put)', g2.qaTop === qa0 && g2.pageMax <= 0, `${qa0}→${g2.qaTop}`);
    // §112–§113: touch
    const t = await page.evaluate(() => { const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }; const h = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((b) => Math.round(b.getBoundingClientRect().height)); return { qa: h('[data-testid="serving-quick-actions"] button'), guest: h('[data-testid="sv-guest"] .co-actions button'), under30: [...document.querySelectorAll('.serving-page button')].filter(vis).filter((b) => b.getBoundingClientRect().height < 30).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)) }; });
    check('touch: Quick Actions ≥ 44 px', Math.min(...t.qa) >= 44, t.qa.join('/'));
    check('touch: Guest Service Details actions ≥ 40 px', Math.min(...t.guest) >= 40, t.guest.join('/'));
    check('touch: no visible button under 30 px', t.under30.length === 0, t.under30.join(' | '));
    writeFileSync(join(OUTDIR, 'touch.json'), JSON.stringify(t, null, 1));
    // §114: scrolling the floor never triggers a stage change
    const before = await count(/POST \/pos\/serving/);
    await page.locator('[data-testid="sv-floor"] .co-scroll').evaluate((e) => e.scrollBy(0, 400)); await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
    check('scrolling the floor / board sends no action', (await count(/POST \/pos\/serving/)) === before);
    await ctx.close(); }

  // ── empty floor (§20) and 100 rows (§88) ──
  { const { ctx, page } = await open('empty');
    const g = await geometry(page); const txt = (await page.locator('[data-testid="sv-floor"]').textContent()) || '';
    const offs = await page.locator('[data-testid="serving-quick-actions"] button[aria-disabled="true"]').count();
    check('empty floor: compact empty state inside the fixed panel, no page scroll', /No active services/.test(txt) && g.pageMax <= 0, `page ${g.pageMax}`);
    check('empty floor: the contextual Quick Actions are off (View Reports stays on)', offs === 6, `${offs} off`);
    const ned = await page.locator('[data-testid="serving-kpis"]').textContent();
    check('empty floor: KPIs with no population say "Not enough data", no decorative 0 % / 0.0', /Not enough data/.test(ned || '') && !/0\.0 \/ 5/.test(ned || ''), (ned || '').slice(0, 120));
    await ctx.close(); }
  { const { ctx, page } = await open('q100');
    const m = await page.evaluate(() => { const sc = document.querySelector('[data-testid="sv-floor"] .co-scroll'); const cp = document.querySelector('.serving-page'); return { inner: sc.scrollHeight - sc.clientHeight, page: cp.scrollHeight - cp.clientHeight, rows: sc.querySelectorAll('tr.co-row').length }; });
    check('100 active services stay inside the Live Service Floor (internal scroll, page height unchanged)', m.rows === 50 && m.inner > 0 && m.page <= 0, JSON.stringify(m));
    await page.locator('[data-testid="sv-floor"] button', { hasText: 'View Full Service Floor' }).click(); await page.waitForTimeout(800);
    const fullRows = await page.locator('[role="dialog"] tr.co-row').count();
    check('View Full Service Floor opens all 100 in an overlay', fullRows === 100, `${fullRows} rows`);
    await ctx.close(); }
  { const { ctx, page } = await open('long');
    const hs = await page.locator('[data-testid="sv-floor"] tr.co-row').evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
    const g = await geometry(page);
    check('long guest / technician / service names truncate without growing the rows', Math.max(...hs) <= 44 && g.pageMax <= 0, `row heights ${[...new Set(hs)].join('/')}`);
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
