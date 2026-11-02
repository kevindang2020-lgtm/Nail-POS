// interact-sd.mjs — Service Done one-screen END-TO-END behaviour checks (Service Done mandate §18–§24, §43–§54, §65–§81,
// §89, §93, §118–§119). The real POS bundle against the fixture API in Chromium at the primary 1920×945 page (1920×1080
// with browser chrome + taskbar). Each check drives the UI like the front desk does and asserts what changed — on screen,
// in the URL, or in the requests the POS sent (the harness logs method, path and body).
//   node tooling/checkout-one-screen/interact-sd.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'sd-interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4320; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const logLines = async () => (await fetch(`${BASE}/__log`).then((r) => r.json()));
const count = async (re) => (await logLines()).filter((l) => re.test(l)).length;

async function open(state, { w = 1920, h = 945 } = {}) {
  await fetch(`${BASE}/__state?name=${state}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/service-done`, { waitUntil: 'load' });
  await page.waitForSelector('text=Service Done Board', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}
const geometry = (page) => page.evaluate(() => { const cp = document.querySelector('.service-done-page'); const qa = document.querySelector('[data-testid="service-done-quick-actions"]').getBoundingClientRect(); return { pageMax: cp.scrollHeight - cp.clientHeight, docMax: document.scrollingElement.scrollHeight - innerHeight, qaTop: Math.round(qa.top) }; });
const qa = (page, label) => page.locator('[data-testid="service-done-quick-actions"] button', { hasText: label }).first();
const closeOverlay = (page) => page.locator('[role="dialog"] button', { hasText: 'Close' }).first().click();
const cardIn = (page, stage, n = 0) => page.locator(`[data-stage="${stage}"] .sd-card`).nth(n);

try {
  // ── busy board (§91): board projection, staff cap, live, auto refresh, overlays, touch ──
  { const { ctx, page } = await open('busy');
    const g0 = await geometry(page);
    const cols = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-stage]')].map((c) => [c.getAttribute('data-stage'), c.querySelectorAll('.sd-card').length])));
    check('board is a projection: Just 5 · Review 12 · Ready 8 · Sent 5 (busy dataset)', cols.just === 5 && cols.review === 12 && cols.ready === 8 && cols.sent === 5, JSON.stringify(cols));
    check('busy board: no page scroll, columns scroll inside', g0.pageMax <= 0 && g0.docMax <= 0, `page ${g0.pageMax}, doc ${g0.docMax}`);
    const staffRows = await page.locator('[data-testid="sd-staff"] tbody tr').count();
    const sum = await page.locator('[data-testid="sd-staff-summary"]').textContent();
    check('200 technicians / 100 on duty → ≤ 8 rows + counts', staffRows <= 8 && /of 100 on duty/.test(sum || ''), `${staffRows} rows · ${sum}`);
    const live = await page.getAttribute('[data-testid="service-done-live"]', 'data-live');
    check('Live shows the real connection state', ['CONNECTED', 'RECONNECTING', 'OFFLINE', 'DEGRADED'].includes(live || ''), String(live));
    const ar = page.locator('[data-testid="service-done-auto-refresh"]'); const a0 = await ar.getAttribute('aria-pressed'); await ar.click(); const a1 = await ar.getAttribute('aria-pressed'); await ar.click();
    check('Auto Refresh is a real switch', a0 !== a1, `${a0} → ${a1}`);
    const dead = await page.evaluate(() => [...document.querySelectorAll('.service-done-page button')].filter((b) => /Send Front Desk Alert/i.test(b.textContent || '')).length);
    check('the dead "Send Front Desk Alert" button is gone', dead === 0);
    await page.getByRole('button', { name: 'View Full Completed Queue' }).click();
    check('full queue overlay lists all 30 guests', (await page.locator('[role="dialog"] tbody tr.co-row').count()) === 30);
    await closeOverlay(page);
    await page.getByRole('button', { name: 'View Full Board' }).click();
    check('full board overlay shows every stage', (await page.locator('[role="dialog"] .sd-card').count()) === 30);
    await closeOverlay(page);
    // Auto Balance (§67): recommendation → confirm → each goes through the server handoff
    await page.locator('[data-testid="sd-auto-balance"]').click();
    const cands = await page.locator('[data-testid="sd-balance"] input[type="checkbox"]').count();
    const before = await count(/POST \/pos\/service-done\/tickets\/[^ ]+\/send-to-checkout/);
    check('Auto Balance recommends only approved guests not at the front desk (8 Ready)', cands === 8, `${cands} candidates`);
    check('Auto Balance moves nothing by itself', (await count(/send-to-checkout/)) === before);
    await page.locator('[data-testid="sd-balance"] input[type="checkbox"]').first().uncheck();
    await page.locator('[data-testid="sd-balance"] button', { hasText: /Move 7 to Checkout/ }).click(); await page.waitForTimeout(800);
    const after = await count(/POST \/pos\/service-done\/tickets\/[^ ]+\/send-to-checkout/);
    check('confirming moves exactly the 7 the manager kept checked', after - before === 7, `${after - before} handoffs`);
    // a note floats over the board
    await qa(page, 'Send Update').click(); await page.waitForTimeout(500);
    const g1 = await geometry(page); const note = await page.locator('[data-testid="service-done-note"]').textContent().catch(() => '');
    check('Send Update is honest (not configured) and the note does not move the layout', /not configured/i.test(note || '') && g1.qaTop === g0.qaTop && g1.pageMax <= 0, `${note} · QA ${g0.qaTop}→${g1.qaTop}`);
    const t = await page.evaluate(() => { const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }; const h = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((b) => Math.round(b.getBoundingClientRect().height)); return { qa: h('[data-testid="service-done-quick-actions"] button'), guest: h('[data-testid="sd-guest"] button'), under30: [...document.querySelectorAll('.service-done-page button')].filter(vis).filter((b) => b.getBoundingClientRect().height < 30).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)) }; });
    check('touch: Quick Actions ≥ 44 px', Math.min(...t.qa) >= 44, t.qa.join('/'));
    check('touch: Guest Completion actions ≥ 40 px', Math.min(...t.guest) >= 40, t.guest.join('/'));
    check('touch: no visible button under 30 px', t.under30.length === 0, t.under30.join(' | '));
    writeFileSync(join(OUTDIR, 'touch.json'), JSON.stringify(t, null, 1));
    await ctx.close(); }

  // ── normal board: selection, manage, quick actions ──
  { const { ctx, page } = await open('normal');
    await cardIn(page, 'review', 0).click(); await page.waitForTimeout(500);
    const hl = await page.evaluate(() => getComputedStyle(document.querySelector('[data-stage="review"]')).outlineStyle);
    check('tapping a board card selects the visit and highlights its stage', hl === 'solid', hl);
    // Manage → quality decision sends the result (and the version the reviewer saw when the server sends one)
    await page.locator('[data-testid="sd-queue"] tbody tr.co-row').first().locator('button', { hasText: 'Manage' }).click();
    // typed key by key like a person — fill() hid an overlay that remounted on every keystroke (Customer Queue review)
    await page.locator('[data-testid="sd-manage"] textarea').first().click(); await page.keyboard.type('guest confirmed', { delay: 5 });
    await page.locator('[data-testid="sd-manage"] button', { hasText: 'Approve' }).click(); await page.waitForTimeout(500);
    const qc = (await logLines()).filter((l) => /quality-check/.test(l)).pop() || '';
    check('Manage → Approve posts the quality decision with the note', /"result":"approved"/.test(qc) && /guest confirmed/.test(qc), qc.slice(0, 140));
    // unapproved visit → Move to Checkout refused with the server's reason
    await page.locator('[data-testid="sd-queue"] tbody tr.co-row').first().click(); await page.waitForTimeout(400);
    await qa(page, 'Move to Checkout').click(); await page.waitForTimeout(500);
    const n1 = await page.locator('[data-testid="service-done-note"]').textContent().catch(() => '');
    check('Move to Checkout on an unapproved visit shows the server refusal', /QUALITY_NOT_APPROVED|quality/i.test(n1 || ''), n1);
    // an approved (Ready) visit: three taps → the server is asked three times, the UI reports the idempotent answer
    await cardIn(page, 'ready', 0).click(); await page.waitForTimeout(400);
    const b0 = await count(/send-to-checkout/);
    for (let i = 0; i < 3; i++) { await qa(page, 'Move to Checkout').click(); await page.waitForTimeout(350); }
    const n2 = await page.locator('[data-testid="service-done-note"]').textContent().catch(() => '');
    check('Move to Checkout ×3 → the UI says it is already in Checkout (server idempotency, no client-side duplicate)', (await count(/send-to-checkout/)) - b0 === 3 && /Already in Checkout/.test(n2 || ''), n2);
    // Open Guest, View Receipt (not a paid receipt), Add Upsell (reopen path), Open Customer, View Reports
    await qa(page, 'Open Guest').click(); await page.waitForTimeout(400);
    const techs = await page.locator('[data-testid="sd-guest-detail"] tbody tr td:nth-child(2)').allTextContents();
    check('Open Guest shows every line with the technician who did it', techs.length >= 1 && techs.every((x) => x.trim() && x !== '—'), techs.join(' | '));
    await closeOverlay(page);
    await qa(page, 'View Receipt').click(); await page.waitForTimeout(400);
    const rcp = await page.locator('[data-testid="sd-summary"]').textContent();
    check('View Receipt is a service summary marked "Not a paid receipt"', /Not a paid receipt/.test(rcp || ''));
    await closeOverlay(page);
    await qa(page, 'Add Upsell').click(); await page.waitForTimeout(300);
    await page.locator('[data-testid="sd-upsell"] button', { hasText: 'Reopen and Go to Serving' }).click(); await page.waitForTimeout(300);
    const r0 = await count(/reopen-service/);
    check('Add Upsell refuses without a reason (no reopen request)', r0 === 0);
    await page.locator('[data-testid="sd-upsell"] textarea').click(); await page.keyboard.type('guest asked for nail art after review', { delay: 5 });
    await page.locator('[data-testid="sd-upsell"] button', { hasText: 'Reopen and Go to Serving' }).click(); await page.waitForTimeout(700);
    const reop = (await logLines()).filter((l) => /reopen-service/.test(l)).pop() || '';
    check('Add Upsell → explicit Reopen with the reason, then Serving (catalog price there)', /nail art/.test(reop) && new URL(page.url()).pathname === '/serving', `${reop.slice(0, 120)} → ${new URL(page.url()).pathname}`);
    await page.goto(`${BASE}/service-done`, { waitUntil: 'load' }); await page.waitForSelector('text=Service Done Board'); await page.waitForTimeout(700);
    await qa(page, 'Open Customer').click(); await page.waitForTimeout(400);
    const u = new URL(page.url());
    check('Open Customer keeps the context (filtered + profile id)', u.pathname === '/customers' && !!u.searchParams.get('q') && !!u.searchParams.get('customerId'), u.pathname + u.search);
    await page.goto(`${BASE}/service-done`, { waitUntil: 'load' }); await page.waitForSelector('text=Service Done Board'); await page.waitForTimeout(700);
    const navs = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(new URL(f.url()).pathname); });
    await page.evaluate(() => { (window).__navs = []; const p = history.pushState.bind(history); history.pushState = (s, t, u) => { (window).__navs.push(String(u)); return p(s, t, u); }; });
    await qa(page, 'View Reports').click(); await page.waitForTimeout(300);
    const pushed = await page.evaluate(() => (window).__navs);
    // it used to push /tenant/reports — a path with no route, so the POS bounced to /overview (fixed: /reports)
    check('View Reports opens the Reports screen (and stays there)', pushed.includes('/reports') && new URL(page.url()).pathname === '/reports', `pushed ${pushed.join(', ')} · now ${new URL(page.url()).pathname}`);
    await page.goto(`${BASE}/service-done`, { waitUntil: 'load' }); await page.waitForSelector('text=Service Done Board'); await page.waitForTimeout(700);
    // §71: the quality filter reaches the server and the rows follow it
    await page.locator('select[aria-label="Quality filter"]').selectOption('needs_review'); await page.waitForTimeout(700);
    const qf = (await logLines()).filter((l) => /GET \/pos\/service-done\/state/.test(l)).pop() || '';
    const chips = await page.locator('[data-testid="sd-queue"] tbody tr.co-row td.sd-q-status').allTextContents();
    check('the Quality filter is wired: server query + only matching rows', /qualityStatus=needs_review/.test(qf) && chips.length > 0 && chips.every((c) => /Review/.test(c)), `${qf} · ${chips.join(',')}`);
    await ctx.close(); }

  // ── empty: compact, context actions off (§20, §48, §80) ──
  { const { ctx, page } = await open('empty');
    const dis = await page.evaluate(() => [...document.querySelectorAll('[data-testid="service-done-quick-actions"] button')].map((b) => [b.textContent.trim(), b.disabled]));
    const offCount = dis.filter(([, d]) => d).length; const reports = dis.find(([l]) => l === 'View Reports');
    check('no guest selected → the six contextual Quick Actions are off, View Reports stays on', offCount === 6 && reports && reports[1] === false, JSON.stringify(dis));
    const g = await geometry(page);
    check('empty state stays inside the fixed panels', g.pageMax <= 0, `page ${g.pageMax}`);
    await ctx.close(); }

  // ── 100 completion records (§93) ──
  { const { ctx, page } = await open('q100');
    const m = await page.evaluate(() => { const sc = document.querySelector('[data-testid="sd-queue"] .co-scroll'); const cp = document.querySelector('.service-done-page'); return { inner: sc.scrollHeight - sc.clientHeight, page: cp.scrollHeight - cp.clientHeight, rows: sc.querySelectorAll('tr.co-row').length }; });
    check('100 records stay inside the queue panel (internal scroll, page height unchanged)', m.rows === 100 && m.inner > 0 && m.page <= 0, JSON.stringify(m));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
