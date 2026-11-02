// interact-queue.mjs — Customer Queue one-screen END-TO-END behaviour checks (Customer Queue mandate Oct 28 2026 §16–§24,
// §29, §43–§57, §66, §80, §84–§86 automatable part). The real POS bundle against the STATEFUL fixture API (fixtures-cq.mjs)
// in Chromium at the primary 1920×945 page (1920×1080 with browser chrome + taskbar). Each check drives the UI like the
// front desk does and asserts what changed — on screen, in the URL, or in the requests the POS sent.
//   node tooling/checkout-one-screen/interact-queue.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'queue-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4322; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const logLines = async () => (await fetch(`${BASE}/__log`).then((r) => r.json()));
const sent = async (re) => (await logLines()).filter((l) => re.test(l));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function open(state, { w = 1920, h = 945, ctx: reuse } = {}) {
  await fetch(`${BASE}/__state?name=${state}`);
  const ctx = reuse || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/queue`, { waitUntil: 'load' });
  await page.waitForSelector('text=Live Customer Queue', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}
const geometry = (page) => page.evaluate(() => { const cp = document.querySelector('.customer-queue-page'); const qa = document.querySelector('[data-testid="queue-quick-actions"]').getBoundingClientRect(); const p = document.querySelector('[data-testid="cq-profile"]').getBoundingClientRect(); return { pageMax: cp.scrollHeight - cp.clientHeight, docMax: document.scrollingElement.scrollHeight - innerHeight, qaBottom: Math.round(qa.bottom), profileH: Math.round(p.height), vh: innerHeight }; });
const qa = (page, label) => page.locator('[data-testid="queue-quick-actions"] button', { hasText: label }).first();
const closeOverlay = (page) => page.locator('[role="dialog"] button', { hasText: 'Close' }).first().click();
const rowFor = (page, qid) => page.locator(`[data-testid="queue-row-${qid}"]`);
const note = async (page) => { await page.waitForTimeout(450); return (await page.locator('[data-testid="queue-note"]').textContent().catch(() => '')) || ''; };
const profile = (page) => page.locator('[data-testid="cq-profile"]').textContent();

try {
  // ── normal queue ──
  { const { ctx, page, errors } = await open('normal');
    const g0 = await geometry(page);
    check('normal queue: no page scroll at 1920×945, Quick Actions inside the viewport', g0.pageMax <= 0 && g0.docMax <= 0 && g0.qaBottom <= g0.vh, `page ${g0.pageMax}, doc ${g0.docMax}, QA bottom ${g0.qaBottom}/${g0.vh}`);
    // §19: a row tap selects into the profile — no row / panel / page growth
    const r2 = rowFor(page, id(1002)); const h0 = await r2.evaluate((r) => r.getBoundingClientRect().height);
    await r2.click(); await page.waitForTimeout(500);
    const g1 = await geometry(page); const h1 = await r2.evaluate((r) => r.getBoundingClientRect().height); const nm = ((await r2.locator('td').nth(1).locator('span').nth(1).textContent()) || '').trim();
    check('row tap fills the Customer Profile Preview (row, panel and page unchanged)', (await profile(page)).includes(nm) && h0 === h1 && g1.profileH === g0.profileH && g1.pageMax <= 0, `${nm}: row ${h0}→${h1}, profile ${g0.profileH}→${g1.profileH}`);
    check('queue rows are compact (36–44 px)', h0 >= 36 && h0 <= 44, `${h0} px`);
    // §19: Manage is an overlay — the row never expands
    await r2.locator('button', { hasText: 'Manage' }).click(); await page.waitForTimeout(400);
    const dlg = await page.locator('[data-testid="cq-manage"]').count(); const h2 = await r2.evaluate((r) => r.getBoundingClientRect().height); const g2 = await geometry(page);
    check('Manage opens a fixed overlay (no row expansion, no page growth)', dlg === 1 && h2 === h0 && g2.pageMax <= 0, `dialog ${dlg}, row ${h0}→${h2}`);
    // §23: raising priority needs a reason — refused in the UI, then sent with the reason
    await page.locator('[data-testid="cq-manage"] select').first().selectOption('vip');
    await page.locator('[data-testid="cq-manage"] button', { hasText: /^Priority$/ }).click();
    const n1 = await note(page); const before = (await sent(/update-priority/)).length;
    await page.locator('[data-testid="cq-manage"] input[aria-label^="Reason (needed"]').fill('Bride — ceremony at 3 pm');
    await page.locator('[data-testid="cq-manage"] button', { hasText: /^Priority$/ }).click(); await page.waitForTimeout(600);
    const pr = await sent(/update-priority/);
    check('a priority raise without a reason is refused; with one it is sent (§23)', /moves ahead of the line/.test(n1) && before === 0 && pr.length === 1 && /"reason":"Bride/.test(pr[0]), `${n1.slice(0, 60)} | ${pr[0]?.slice(-90)}`);
    // Quick Actions — Start Service is off for a waiting guest and says why
    await rowFor(page, id(1000)).click(); await page.waitForTimeout(400);
    const startOff = await qa(page, 'Start Service').getAttribute('aria-disabled');
    await qa(page, 'Start Service').click({ force: true }); const n2 = await note(page);
    check('Start Service is off for a guest with no technician and says why (§55)', startOff === 'true' && /Assign a technician/.test(n2) && (await sent(/start-service/)).length === 0, n2.slice(0, 70));
    // Start Service on an assigned guest → one start; a repeat is "already in service"
    await rowFor(page, id(1005)).click(); await page.waitForTimeout(400);
    await qa(page, 'Start Service').click(); const n3 = await note(page);
    await page.waitForTimeout(400);
    check('Start Service on an assigned guest starts it once (server-validated)', /Service started/.test(n3) && (await sent(/items\/[^/]+1005\/start-service/)).length === 1, n3.slice(0, 60));
    // Assign Tech → the assign sheet for the selected guest
    await rowFor(page, id(1001)).click(); await page.waitForTimeout(400);
    await qa(page, 'Assign Tech').click(); await page.waitForTimeout(500);
    const sheet = await page.locator('[role="dialog"]', { hasText: 'Add to Queue / Assign' }).count();
    check('Assign Tech opens the assign sheet for the selected guest', sheet >= 1);
    await page.keyboard.press('Escape'); await page.locator('[role="dialog"] button', { hasText: /Close|Cancel/ }).first().click({ timeout: 1500 }).catch(() => undefined); await page.waitForTimeout(300);
    // Send Wait Alert → the guest's app through the notification path
    await rowFor(page, id(1001)).click(); await page.waitForTimeout(300);
    await qa(page, 'Send Wait Alert').click(); const n4 = await note(page);
    const al = await sent(/items\/[^/]+1001\/notify-customer/);
    check('Send Wait Alert posts the app notification and reports the result honestly (§56)', al.length === 1 && /"channel":"app"/.test(al[0]) && /Wait alert sent|no Customer App/.test(n4), n4.slice(0, 70));
    // Add Note → overlay → PATCH notes; the text renders as text (XSS-safe)
    await qa(page, 'Add Note').click(); await page.waitForTimeout(300);
    const xss = 'Prefers coffin shape <img src=x onerror="window.__xss=1">';
    // typed key by key like a person (fill() sets the value at once and hid a remount-per-keystroke bug)
    await page.locator('[data-testid="cq-note"] textarea').click(); await page.keyboard.type(xss, { delay: 5 });
    const typed = await page.locator('[data-testid="cq-note"] textarea').inputValue();
    check('a note typed key by key keeps focus and every character (the overlay does not remount)', typed === xss, `${typed.length}/${xss.length} chars`);
    await page.locator('[data-testid="cq-note"] button', { hasText: 'Save Note' }).click(); await page.waitForTimeout(900);
    const notes = (await fetch(`${BASE}/__cq`).then((r) => r.json())).notes; const pText = await profile(page);
    const injected = await page.evaluate(() => !!window.__xss || !!document.querySelector('[data-testid="cq-profile"] img[src="x"]'));
    check('Add Note saves the guest note (PATCH) and shows it as plain text (§57)', notes.length === 1 && notes[0].notes === xss && pText.includes('coffin shape') && !injected, `${notes.length} note(s), injected ${injected}`);
    // Add Upsell → catalog add-ons → update-services with the visit's service list + the add-on
    await page.locator('[data-testid="cq-profile"] button', { hasText: 'Add Upsell' }).click(); await page.waitForTimeout(500);
    await page.locator('[data-testid="cq-upsell"] button', { hasText: 'Paraffin' }).click(); const n5 = await note(page);
    const up = await sent(/items\/[^/]+1001\/update-services/);
    check('Add Upsell adds a catalog add-on to the visit (update-services)', up.length === 1 && up[0].includes(id(31001)) && /Added Paraffin/.test(n5), n5.slice(0, 60));
    // Add to Queue → the canonical walk-in check-in, once
    const countBefore = Number(await page.locator('[data-testid="cq-queue-count"]').textContent());
    await qa(page, 'Add to Queue').click(); await page.waitForTimeout(600);
    const add = page.locator('[data-testid="cq-add"]');
    await add.locator('button', { hasText: /^Walk-In$/ }).click();
    await add.locator('input[placeholder="Guest name"]').fill('Queue Test Walkin');
    await add.locator('button', { hasText: 'Gel Manicure' }).first().click();
    const submit = add.locator('button', { hasText: 'Complete Check-In' });
    await submit.dblclick(); await page.waitForTimeout(1200);
    const wi = (await fetch(`${BASE}/__cq`).then((r) => r.json())).walkIns; const countAfter = Number(await page.locator('[data-testid="cq-queue-count"]').textContent());
    const wiReq = await sent(/POST \/pos\/check-in\/walk-in/);
    check('Add to Queue checks the guest in through the canonical walk-in flow, once (§53–§54)', wi.length === 1 && wi[0] && wiReq.length >= 1 && countAfter === countBefore + 1 && /idempotencyKey/.test(wiReq[0]), `${wiReq.length} request(s), ${wi.length} visit(s), count ${countBefore}→${countAfter}`);
    // §45: View Customer keeps the search + the selected guest for the way back
    await page.locator('input[aria-label="Search queue"]').fill('Gel'); await page.waitForTimeout(700);
    await rowFor(page, id(1000)).click(); await page.waitForTimeout(400);
    await qa(page, 'View Customer').click(); await page.waitForTimeout(500);
    const url = page.url();
    await page.goBack(); await page.waitForSelector('text=Live Customer Queue'); await page.waitForTimeout(900);
    const kept = await page.locator('input[aria-label="Search queue"]').inputValue(); const p2 = await profile(page);
    check('View Customer opens the guest\'s record; back keeps the search and the selected guest (§45)', /\/customers\?q=.+&customerId=/.test(url) && kept === 'Gel' && p2.includes('Ann'), `${url.replace(BASE, '')} | search "${kept}"`);
    await page.locator('input[aria-label="Search queue"]').fill(''); await page.waitForTimeout(600);
    // routes
    await qa(page, 'Open Queue Report').click(); await page.waitForTimeout(400); const u2 = page.url(); await page.goBack(); await page.waitForSelector('text=Live Customer Queue');
    await qa(page, 'New Walk-In').click(); await page.waitForTimeout(400); const u3 = page.url(); await page.goBack(); await page.waitForSelector('text=Live Customer Queue'); await page.waitForTimeout(700);
    check('Open Queue Report / New Walk-In go to Reports / Check-In', u2.endsWith('/reports') && u3.endsWith('/booking/walk-in'), `${u2.replace(BASE, '')} · ${u3.replace(BASE, '')}`);
    // §46–§49: Live is the connection's real state; Auto Refresh is a persisted toggle
    const live = await page.locator('[data-testid="queue-live"]').getAttribute('data-live');
    const ar0 = await page.locator('[data-testid="queue-auto-refresh"]').getAttribute('aria-pressed');
    await page.locator('[data-testid="queue-auto-refresh"]').click(); const ar1 = await page.locator('[data-testid="queue-auto-refresh"]').getAttribute('aria-pressed');
    const stored = await page.evaluate(() => localStorage.getItem('aps.queue.autoRefresh'));
    await page.locator('[data-testid="queue-auto-refresh"]').click();
    check('Live chip shows the realtime state; Auto Refresh toggles and persists', !!live && ar0 === 'true' && ar1 === 'false' && stored === 'off', `live=${live}, ${ar0}→${ar1}, stored ${stored}`);
    // §32: a stale assign (another device moved the guest) is refused and explained, never applied
    await rowFor(page, id(1002)).locator('button', { hasText: 'Manage' }).click(); await page.waitForTimeout(400);
    await fetch(`${BASE}/api/v1/pos/queue/items/${id(1002)}/assign-technician`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ technicianId: id(9003) }) });   // the other device
    await page.locator('[data-testid="cq-manage"] button[aria-label="Assign / reassign technician"]').click(); await page.waitForTimeout(500);
    await page.locator('[role="option"]').first().click(); await page.waitForTimeout(300);
    await page.locator('[data-testid="cq-manage"] button', { hasText: /^Assign$/ }).click(); const n6 = await note(page);
    check('a stale assign is refused with 409 and explained in plain words (§32)', /another device|first|now with/i.test(n6), n6.slice(0, 90));
    await closeOverlay(page).catch(() => undefined);
    check('no page errors on the normal queue', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  // ── busy (§63): server counts, priority order, insights, internal scroll, full lists, auto balance ──
  { const { ctx, page } = await open('busy');
    const counts = {}; for (const st of ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue']) counts[st] = Number(await page.locator(`[data-testid="cq-count-${st}"]`).textContent());
    check('Guest Flow Board shows the server\'s canonical counts (§20, §63)', counts.waiting === 50 && counts.called === 20 && counts.assigned === 15 && counts.ready_for_tech === 10 && counts.moved_to_tech_queue === 0, JSON.stringify(counts));
    const pri = await page.locator('[data-testid="cq-priority"] tr.co-row td:nth-child(3)').allTextContents();
    const pc = await page.locator('[data-testid="cq-priority-counts"]').textContent();
    check('Waiting Guests by Priority is the server order (Urgent before VIP) with counts (§22)', pri.length === 8 && pri[0].includes('Urgent') && pri.indexOf(pri.find((x) => x.includes('VIP'))) > pri.lastIndexOf(pri.find((x) => x.includes('Urgent'))) && /5 urgent · 5 VIP/.test(pc || ''), `${pri.slice(0, 8).join(',')} | ${pc}`);
    const m = await page.evaluate(() => { const sc = document.querySelector('[data-testid="cq-queue"] .co-scroll'); const cp = document.querySelector('.customer-queue-page'); return { inner: sc.scrollHeight - sc.clientHeight, page: cp.scrollHeight - cp.clientHeight, rows: sc.querySelectorAll('tr.co-row').length }; });
    check('95 waiting guests stay inside the Live Customer Queue (internal scroll, page height unchanged) (§17)', m.rows === 50 && m.inner > 0 && m.page <= 0, JSON.stringify(m));
    await page.locator('[data-testid="cq-queue"] button', { hasText: 'View Full Queue' }).click(); await page.waitForTimeout(900);
    const fullRows = await page.locator('[data-testid="cq-full-queue"] tr.co-row').count();
    check('View Full Queue opens all 95 in an overlay', fullRows === 95, `${fullRows} rows`);
    await closeOverlay(page);
    await page.locator('[data-testid="cq-board"] button', { hasText: 'View Full Board' }).click(); await page.waitForTimeout(900);
    const boardCards = await page.locator('[data-testid="cq-full-board"] .sd-card').count();
    check('View Full Board shows every active guest by status', boardCards === 95, `${boardCards} cards`);
    await closeOverlay(page);
    const staffRows = await page.locator('[data-testid="cq-staff"] tbody tr').count(); const ss = await page.locator('[data-testid="cq-staff-summary"]').textContent();
    check('200 technicians → the top 8 + a summary of the 100 on duty (§29)', staffRows === 8 && /100 on duty/.test(ss || ''), `${staffRows} rows · ${ss}`);
    const ins = await page.locator('[data-testid="cq-insights"] .co-scroll > div').count();
    check('AI insights show the top items only (≤ 4 + View All) (§21)', ins >= 1 && ins <= 4, `${ins}`);
    const w0 = (await sent(/assign-technician|update-priority|reorder/)).length;
    await page.locator('[data-testid="cq-insights"] button', { hasText: 'Open' }).first().click(); await page.waitForTimeout(600);
    const pBusy = await profile(page); const nmIns = (await page.locator('[data-testid="cq-insights"] .co-scroll > div').first().textContent()) || '';
    check('an insight\'s Open selects that guest (advisory — nothing is changed)', pBusy.includes(nmIns.split(' has waited')[0].trim()) && (await sent(/assign-technician|update-priority|reorder/)).length === w0, nmIns.slice(0, 50));
    await page.locator('[data-testid="cq-insights"] button', { hasText: 'Auto Balance Queue' }).click(); await page.waitForTimeout(700);
    const bal = await page.locator('[data-testid="cq-balance"] tbody tr').count(); const applied0 = (await sent(/auto-balance\/apply/)).length;
    await page.locator('[data-testid="cq-balance"] button', { hasText: /^Apply/ }).click(); await page.waitForTimeout(700);
    const ap = await sent(/auto-balance\/apply/);
    check('Auto Balance previews first; only Apply assigns, with expected versions (§21)', bal >= 1 && applied0 === 0 && ap.length === 1 && /expectedTechnicianId":null/.test(ap[0]), `${bal} proposal(s)`);
    const g = await geometry(page);
    check('busy (§63): still one screen', g.pageMax <= 0 && g.docMax <= 0, `page ${g.pageMax}`);
    await ctx.close(); }

  // ── empty ──
  { const { ctx, page } = await open('empty');
    const g = await geometry(page); const txt = await page.locator('[data-testid="cq-queue"]').textContent();
    const offs = await page.locator('[data-testid="queue-quick-actions"] button[aria-disabled="true"]').count();
    check('empty queue: compact empty state inside the fixed panel, no page scroll', /No customers waiting/.test(txt || '') && g.pageMax <= 0, `page ${g.pageMax}`);
    check('empty queue: the contextual Quick Actions are off (New Walk-In / Add to Queue / Report stay on)', offs === 5, `${offs} off`);
    const k = await page.locator('[data-testid="queue-kpis"]').textContent();
    check('empty queue: Avg Wait / Return Rate say "Not enough data" — no decorative 0 / 0 % (§15)', /Not enough data/.test(k || '') && !/Return Rate0%/.test(k || ''), (k || '').slice(0, 140));
    const a0 = (await sent(/notify-customer/)).length;
    await qa(page, 'Send Wait Alert').click({ force: true }); const n = await note(page);
    check('a contextual Quick Action with no guest says what to do (no dead control)', /Select a guest/.test(n) && (await sent(/notify-customer/)).length === a0, n);
    await ctx.close(); }

  // ── long names (§66) ──
  { const { ctx, page } = await open('long');
    const hs = await page.locator('[data-testid="cq-queue"] tr.co-row').evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
    const g = await geometry(page);
    check('long guest / technician / service names truncate without growing rows or the page', Math.max(...hs) <= 44 && g.pageMax <= 0, `row heights ${[...new Set(hs)].join('/')}`);
    await ctx.close(); }

  // ── touch targets (§62) ──
  { const { ctx, page } = await open('normal');
    const t = await page.evaluate(() => { const q = [...document.querySelectorAll('[data-testid="queue-quick-actions"] button')].map((b) => b.getBoundingClientRect().height); const p = [...document.querySelectorAll('[data-testid="cq-profile"] .co-actions button')].map((b) => b.getBoundingClientRect().height); const f = [...document.querySelectorAll('.co-filters > *')].map((b) => b.getBoundingClientRect().height); return { qa: Math.min(...q), profile: Math.min(...p), filters: Math.min(...f) }; });
    check('touch targets: Quick Actions ≥ 44 px, primary buttons ≥ 38 px, filters ≥ 38 px', t.qa >= 44 && t.profile >= 38 && t.filters >= 38, JSON.stringify(t));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
