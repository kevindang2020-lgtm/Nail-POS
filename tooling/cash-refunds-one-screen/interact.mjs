// interact.mjs — End-of-Day Cash + Refunds & Voids one-screen E2E (Oct 29 2026). The REAL POS bundle in Chromium against
// live-server.mjs (real read models on a seeded TEST database). Each step clicks what a salon user clicks and checks the
// answer on screen AND in the database. Nothing leaves the machine: no processor; no money moves. (The writes — count,
// partial hand-off, resolve, refund, void — are the harness's SIMULATED row changes with the product's rules; see live-server.mjs.)
//   node tooling/cash-refunds-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = 4380, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const POST = (p, b, h = {}) => fetch(BASE + '/api/v1' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const SQL = async (k, a = '') => J('/__sql?k=' + k + (a ? '&a=' + encodeURIComponent(a) : ''));
const seeded = await J('/__seeded');
const TECH = { anna: 'e0820000-0000-4000-8000-000000000001', bao: 'e0820000-0000-4000-8000-000000000002', chi: 'e0820000-0000-4000-8000-000000000003', mai: 'e0820000-0000-4000-8000-000000000004', finn: 'e0820000-0000-4000-8000-000000000006' };
const results = []; let n = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|403|409|400|503|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
async function step(name, fn) {
  const t = Date.now(); let ok = true, detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { ok = false; detail = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 70)}.png`) }).catch(() => undefined);
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); await page.keyboard.press('Escape').catch(() => undefined); }
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const cents = (s) => Math.round(Number(String(s).replace(/[^\d.-]/g, '').replace(/^-?$/, '0')) * 100);
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit', { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const noJunk = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined|\[object Object\]/.test(body), 'page shows Invalid Date / NaN / undefined'); expect(!/HARNESS-SECRET/.test(body), 'a gift card code is on the page'); };
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
const row = (panel, text) => page.locator(`${tid(panel)} tbody tr`, { hasText: text }).first();
const today = seeded.today; const addDays = (d, k) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
async function customRange(from, to) {
  await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
  const cell = async (d) => { for (let i = 0; i < 3 && !(await page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).count()); i++) await page.locator(`${tid('range-calendar')} button[aria-label*="revious"]`).first().click(); return page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).first(); };
  await (await cell(from)).click(); await (await cell(to)).click();
  await page.click(tid('range-apply')); await settle();
}

try {
  // ══ End-of-Day Cash ═════════════════════════════════════════════════════════════════════════════════════════════════
  await go('/cash-handoffs');
  const s0 = await API('/pos/payments/cash-handoffs/summary?preset=today');
  await step('cash: the five KPIs and the difference strip are the server aggregates for Today', async () => {
    expect(cents(await T(`${tid('kpi-expected')} .fk-kpi-v`)) === s0.kpis.expectedCents && s0.kpis.expectedCents === 67000, 'expected $670');
    expect(cents(await T(`${tid('kpi-counted')} .fk-kpi-v`)) === s0.kpis.countedCents, 'counted');
    expect(Number(await T(`${tid('kpi-technicians')} .fk-kpi-v`)) === 4 && Number(await T(`${tid('kpi-awaiting')} .fk-kpi-v`)) === 2, 'technicians 4 · awaiting 2');
    const strip = await T(tid('difference-strip')); expect(/−\$5\.00/.test(strip) && /Short: 1/.test(strip), 'net −$5, one short');
    await noJunk(); return `expected $670 · counted ${await T(`${tid('kpi-counted')} .fk-kpi-v`)} · ${strip.split('\n')[0]}`;
  });
  await step('cash: a $100 split paid $40 cash to Mai + $60 card counts $40 of custody — never the ticket', async () => {
    const r = await row('handoffs', 'Mai Nguyen').innerText(); expect(/\$40\.00/.test(r) && !/\$100\.00/.test(r), r);
    await row('handoffs', 'Mai Nguyen').getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('lines-table'));
    const l = await T(tid('lines-table')); await close(); expect(/\$40\.00/.test(l) && /\$100\.00/.test(l) && /other tender/.test(l), 'detail shows cash $40 of a $100 ticket');
    return r.replace(/\s+/g, ' ').slice(0, 90);
  });
  await step('cash: 11:30 PM last night belongs to yesterday\'s business date, not today', async () => {
    expect(!(await T(tid('handoffs'))).includes('Dee Park'), 'Dee not in Today');
    await customRange(addDays(today, -1), addDays(today, -1)); const t = await T(tid('handoffs'));
    expect(t.includes('Dee Park'), 'Dee in yesterday'); await page.click(tid('preset-today')); await settle();
    return `Dee Park listed under ${addDays(today, -1)}`;
  });
  await step('cash: one search box — customer name, ticket #, technician phone — across every unit', async () => {
    await page.fill(tid('search'), 'John Smith'); await settle(); const a = (await page.locator(`${tid('handoffs')} tbody tr`).allInnerTexts()).map((x) => x.match(/(Anna Lee|Bao Tran|Chi Pham|Mai Nguyen|Dee Park)/)?.[1]).sort();
    await page.fill(tid('search'), '#5003'); await settle(); const b = await T(tid('handoffs'));
    await page.fill(tid('search'), '(609) 555-0103'); await settle(); const c = await T(tid('handoffs'));
    await page.fill(tid('search'), ''); await settle();
    expect(a.join() === 'Anna Lee,Mai Nguyen' && /Bao Tran/.test(b) && /Chi Pham/.test(c), `${a} | ${b.slice(0, 60)}`); return `John Smith → ${a.join(', ')} · #5003 → Bao · (609) 555-0103 → Chi`;
  });
  await step('cash: This Month pages on the server — Page 1 newest, Page 2 older, no row twice', async () => {
    await page.click(tid('preset-month')); await settle();
    const p1 = await page.locator(`${tid('handoffs')} tbody tr`).allInnerTexts(); const pager1 = await T(`${tid('handoffs')} .fk-pager`);
    await page.locator(`${tid('handoffs')} .fk-pager .fk-pbtn.num`).nth(1).click(); await settle();
    const p2 = await page.locator(`${tid('handoffs')} tbody tr`).allInnerTexts(); const pager2 = await T(`${tid('handoffs')} .fk-pager`);
    const key = (x) => x.split('\n').slice(0, 2).join('|'); expect(!p2.some((x) => p1.map(key).includes(key(x))), 'duplicate across pages'); expect(/Page 2 of/.test(pager2), 'page 2');
    await page.click(tid('preset-today')); await settle(); return `${pager1.replace(/\s+/g, ' ').slice(0, 40)} → ${pager2.replace(/\s+/g, ' ').slice(0, 40)}`;
  });
  await step('cash: count Chi\'s $80 with the count sheet ($50 + $20 + $10) — balanced, one event with the count sheet', async () => {
    await row('handoffs', 'Chi Pham').getByRole('button', { name: 'Count' }).click(); await page.waitForSelector(tid('count-figures'));
    await page.check(tid('use-sheet')); const den = page.locator(`${tid('sheet')} input`);
    await den.nth(1).fill('1'); await den.nth(2).fill('1'); await den.nth(3).fill('1');
    expect(/\$0\.00/.test(await T(tid('estimate'))), 'estimate $0');
    await page.click(tid('save-count')); await page.waitForSelector(tid('note')); await settle();
    const r = await row('handoffs', 'Chi Pham').innerText(); const u = (await SQL('unit', TECH.chi))[0]; const ev = await SQL('events', TECH.chi);
    expect(/Balanced/.test(r) && Number(u.counted_cents) === 8000 && u.status === 'reconciled' && ev.length === 1 && ev[0].event_type === 'counted' && ev[0].denominations, JSON.stringify(ev));
    return `${await T(tid('note'))} · db counted ${u.counted_cents} v${u.version} · events ${ev.map((e) => e.event_type)}`;
  });
  await step('cash: two partial hand-offs for Mai ($25, then $15 into the drawer) reconcile $40 once — a custody move, not a sale', async () => {
    const salesBefore = (await SQL('sales'))[0].n;
    await row('handoffs', 'Mai Nguyen').getByRole('button', { name: 'Count' }).click(); await page.waitForSelector(tid('count-figures'));
    await page.click(tid('mode-add')); await page.fill(tid('amount'), '25'); await page.fill(tid('notes'), 'First half before her break');
    await page.click(tid('save-count')); await page.waitForSelector(tid('note')); await settle();
    const mid = await row('handoffs', 'Mai Nguyen').innerText(); expect(/−\$15\.00/.test(mid) && /Short/.test(mid), 'after $25: short $15');
    await row('handoffs', 'Mai Nguyen').getByRole('button', { name: 'Recount' }).click(); await page.waitForSelector(tid('count-figures'));
    await page.click(tid('mode-add')); await page.fill(tid('amount'), '15'); await page.check(tid('to-drawer'));
    await page.click(tid('save-count')); await page.waitForSelector(tid('note')); await settle();
    const r = await row('handoffs', 'Mai Nguyen').innerText(); const ev = await SQL('events', TECH.mai); const dr = await SQL('drawer'); const salesAfter = (await SQL('sales'))[0].n;
    expect(/Balanced/.test(r) && ev.filter((e) => e.event_type === 'partial').length === 2 && Number(ev.at(-2).counted_total_cents ?? ev.at(-1).counted_total_cents) === 4000, JSON.stringify(ev));
    expect(dr.length === 1 && Number(dr[0].amount_cents) === 1500 && dr[0].direction === 'in' && salesAfter === salesBefore, 'one drawer movement, no new sale');
    return `events ${ev.map((e) => `${e.event_type}:${e.amount_cents}`).join(', ')} · drawer in $15 · cash sales ${salesBefore} → ${salesAfter}`;
  });
  await step('cash: the same submission twice (double tap / retry) is ONE event', async () => {
    const body = { countedCents: 30000, date: today, idempotencyKey: 'e2e-double-tap-1' };
    const a = await POST(`/pos/cash-handoffs/${TECH.anna}/reconcile`, body); const b = await POST(`/pos/cash-handoffs/${TECH.anna}/reconcile`, body);
    const ev = (await SQL('events', TECH.anna)).filter((e) => e.idempotency_key === 'e2e-double-tap-1');
    expect(a.status === 200 && b.status === 200 && b.body.result.replayed === true && ev.length === 1, JSON.stringify(b.body.result)); return 'second call replayed · 1 event';
  });
  await step('cash: a second counter cannot silently overwrite — the stale count is refused and the current figure shown', async () => {
    await go('/cash-handoffs');
    await row('handoffs', 'Bao Tran').getByRole('button', { name: 'Recount' }).click(); await page.waitForSelector(tid('count-figures'));
    const v = Number((await SQL('unit', TECH.bao))[0].version);
    const other = await POST(`/pos/cash-handoffs/${TECH.bao}/reconcile`, { countedCents: 24000, date: today, expectedVersion: v, notes: 'Other desk recount' });
    await page.fill(tid('amount'), '250'); await page.click(tid('save-count')); await page.waitForSelector(tid('conflict'));
    await page.waitForFunction(() => /\$240\.00/.test(document.querySelector('[data-testid="conflict"]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => undefined);   // the dialog re-reads the unit
    const msg = await T(tid('conflict')); const u = (await SQL('unit', TECH.bao))[0]; await close(); await settle();
    expect(other.status === 200 && Number(u.counted_cents) === 24000 && /\$240\.00/.test(msg), `${msg} · db ${u.counted_cents}`); return `${msg.slice(0, 90)} · db keeps $240`;
  });
  await step('cash: a manager resolves Bao\'s shortage with a reason — the figures stay, the state says Resolved', async () => {
    await go('/cash-handoffs');
    await row('handoffs', 'Bao Tran').getByRole('button', { name: 'Review' }).click(); await page.waitForSelector(tid('resolve-dialog'));
    expect(await page.locator(tid('save-resolve')).isDisabled(), 'reason required'); await page.fill(tid('resolve-reason'), 'Recounted with Bao — $10 paid out for a supply run, receipt in the drawer');
    await page.click(tid('save-resolve')); await page.waitForSelector(tid('note')); await settle();
    const r = await row('handoffs', 'Bao Tran').innerText(); const u = (await SQL('unit', TECH.bao))[0];
    expect(/Resolved/.test(r) && /−\$10\.00/.test(r) && Number(u.variance_cents) === -1000 && u.status === 'reconciled' && u.resolution_reason, JSON.stringify(u));
    return `${r.replace(/\s+/g, ' ').slice(0, 80)} · db variance ${u.variance_cents} kept`;
  });
  await step('cash: Record Hand-Off for a technician who never owed cash says so — no phantom hand-off', async () => {
    await page.click(tid('record-handoff')); await page.waitForSelector(tid('count-dialog'));
    await page.selectOption(tid('pick-tech'), TECH.finn); await settle(); const t = await T(tid('count-dialog'));
    const dis = await page.locator(tid('save-count')).isDisabled(); await close();
    expect(/No cash collected/.test(t) && dis, 'no-cash message'); return 'No cash collected by this technician on this day · Save disabled';
  });
  await step('cash: front desk counts but cannot resolve; a technician sees the permission state, not the data', async () => {
    await J('/__role?r=FRONT_DESK'); await go('/cash-handoffs');
    const a = await page.locator(tid('count')).count(); const b = await page.locator(tid('review')).count(); const c = await page.locator(tid('export')).count();
    await J('/__role?r=TECHNICIAN'); await go('/cash-handoffs'); const t = await T('.work.fit'); await J('/__role?r=OWNER');
    expect(a > 0 && b === 0 && c === 0 && /cannot see|permission|role/i.test(t) && !/\$670/.test(t), `count ${a} review ${b} export ${c}`); return `front desk: Count ×${a}, no Review, no Export · technician: ${t.split('\n')[1]?.slice(0, 50)}`;
  });
  await step('cash: export carries every matching unit and the calculation basis; a read failure is an error, not $0', async () => {
    await go('/cash-handoffs');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(tid('export'))]);
    const csv = await readFile(await dl.path(), 'utf8'); expect(/confirmed cash-to-technician payments per salon-local business day/.test(csv) && csv.split('\n').filter((l) => l.startsWith(today)).length === 4, 'csv');
    await J('/__fail?on=1'); await go('/cash-handoffs'); const t = await T('.work.fit'); await J('/__fail?on=0');
    expect(/could not be reached/i.test(t) && !/\$670|\$545/.test(t) && !(await page.locator(`${tid('kpi-expected')} .fk-kpi-v`).count()), 'error state'); return `${dl.suggestedFilename()} · failure → "${t.match(/The server could not be reached[^\n]*/)?.[0]}"`;
  });

  // ══ Refunds & Voids ═════════════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/refunds-voids');
  const r0 = await API('/pos/payments/refunds-voids/summary?preset=month&dateField=requested');
  await step('refunds: the five KPIs are the server aggregates — completed refunds, voids at face value, pending and needs review apart', async () => {
    expect(cents(await T(`${tid('kpi-refunds')} .fk-kpi-v`)) === r0.kpis.refundedCents, 'refunds');
    expect(cents(await T(`${tid('kpi-voids')} .fk-kpi-v`)) === r0.kpis.voidedCents, 'voids');
    expect(cents(await T(`${tid('kpi-total')} .fk-kpi-v`)) === r0.kpis.refundedCents + r0.kpis.voidedCents, 'total = refunds + voids');
    expect(Number(await T(`${tid('kpi-pending')} .fk-kpi-v`)) === r0.kpis.pending && Number(await T(`${tid('kpi-review')} .fk-kpi-v`)) === r0.kpis.needsReview, 'pending / review');
    await noJunk(); return `refunds ${r0.kpis.refunds} · voids ${r0.kpis.voids} · pending ${r0.kpis.pending} · review ${r0.kpis.needsReview}`;
  });
  await step('refunds: search by phone in any format, ticket #, provider reference — one row per reversal', async () => {
    await page.fill(tid('search'), '+1 856 555 1234'); await settle(); const a = await page.locator(`${tid('ledger')} tbody tr`).count();
    await page.fill(tid('search'), '#6003'); await settle(); const b = await T(tid('ledger'));
    await page.fill(tid('search'), 'RF6002'); await settle(); const c = await T(tid('ledger'));
    await page.fill(tid('search'), 'RF9999'); await settle(); const d = await T(tid('ledger'));
    await page.fill(tid('search'), ''); await settle();
    expect(a === 3 && /Void/.test(b) && /#6002/.test(c) && /No reversals match/.test(d), `${a} | ${b.slice(0, 40)}`); return `(856) 555-1234 → ${a} rows · #6003 → Void · RF6002 → #6002 · other salon's RF9999 → none`;
  });
  await step('refunds: type and status filters, numbered pages', async () => {
    await page.selectOption(tid('type'), 'void'); await settle(); const v = await page.locator(`${tid('ledger')} tbody tr`).count();
    await page.selectOption(tid('type'), ''); await page.selectOption(tid('status'), 'needs_review'); await settle(); const nr = await T(tid('ledger'));
    await page.selectOption(tid('status'), ''); await settle();
    await page.locator(`${tid('ledger')} .fk-pager .fk-pbtn.num`).nth(1).click(); await settle(); const pg = await T(`${tid('ledger')} .fk-pager`);
    expect(v === r0.kpis.voids && /#6004/.test(nr) && /Page 2 of/.test(pg), `${v} voids`); await page.locator(`${tid('ledger')} .fk-pager .fk-pbtn.num`).nth(0).click(); await settle();
    return `voids ${v} · needs review → #6004 · ${pg.replace(/\s+/g, ' ').slice(0, 40)}`;
  });
  await step('refunds: the detail shows the original tender — $100 − $30 refunded − $20 pending = $50 still refundable; void refused', async () => {
    await page.fill(tid('search'), 'RF6001'); await settle(); await page.locator(`${tid('ledger')} tbody tr`).first().getByRole('button', { name: 'View' }).click();
    await page.waitForSelector(tid('original-position')); const p = await T(tid('original-position')); const h = await T(tid('refund-history'));
    await close(); await page.fill(tid('search'), ''); await settle();
    expect(/\$100\.00/.test(p) && /−\$30\.00/.test(p) && /−\$20\.00/.test(p) && /\$50\.00/.test(p) && /reserved/.test(h), p); return p.replace(/\s+/g, ' ');
  });
  await step('refunds: a split ticket lists each tender with its own refundable amount; a gift-card refund links its ledger, never the code', async () => {
    await page.fill(tid('search'), 'RF6002'); await settle(); await page.locator(`${tid('ledger')} tbody tr`).first().getByRole('button', { name: 'View' }).click();
    await page.waitForSelector(tid('tenders-table')); const t = await T(tid('tenders-table')); await close();
    await page.fill(tid('search'), '#6006'); await settle(); await page.locator(`${tid('ledger')} tbody tr`).first().getByRole('button', { name: 'View' }).click();
    await page.waitForSelector(tid('gift-ledger')); const g = await T(tid('gift-ledger')); await noJunk(); await close(); await page.fill(tid('search'), ''); await settle();
    expect(/Card[\s\S]*\$60\.00[\s\S]*\$30\.00/.test(t) && /Cash[\s\S]*\$40\.00/.test(t) && /7719/.test(g), t); return `card $60 → $30 left · cash $40 → $40 · gift •••• 7719 restored`;
  });
  await step('refunds: Find Original Payment → refund $10 of ONE card tender (review, confirm) — first on Page 1, cap enforced', async () => {
    await page.click(tid('find-payment')); await page.waitForSelector(tid('find-dialog'));
    await page.fill(tid('find-query'), '#6200'); await page.waitForSelector(tid('find-results')); await page.click(tid('find-refund')); await page.waitForSelector(tid('refund-dialog'));
    await page.fill(tid('refund-amount'), '100'); const over = await T(tid('refund-dialog')); expect(/More than this payment can still return/.test(over), 'cap shown');
    expect(await page.locator(tid('review-refund')).isDisabled(), 'over the cap: cannot continue');
    await page.fill(tid('refund-amount'), '10'); await page.fill(tid('refund-reason'), 'Polish chipped next day');
    await page.click(tid('review-refund')); await page.waitForSelector(tid('refund-review')); await page.click(tid('confirm-refund')); await page.waitForSelector(tid('note')); await settle();
    const first = await page.locator(`${tid('ledger')} tbody tr`).first().innerText(); const rf = await SQL('refunds', seeded.p6200);
    expect(/#6200/.test(first) && /−\$10\.00/.test(first) && /Completed/.test(first) && rf.length === 1 && Number(rf[0].amount_cents) === 1000, first);
    return `${await T(tid('note'))} · page 1 row: ${first.replace(/\s+/g, ' ').slice(0, 70)}`;
  });
  await step('refunds: void an unsettled card payment with a reason; a settled one offers only a refund', async () => {
    await page.click(tid('find-payment')); await page.waitForSelector(tid('find-dialog'));
    await page.fill(tid('find-query'), '#6201'); await page.waitForSelector(tid('find-results')); const settled = await page.locator(tid('find-void')).count();
    await page.fill(tid('find-query'), '#6202'); await settle(); await page.waitForSelector(tid('find-void')); await page.click(tid('find-void')); await page.waitForSelector(tid('void-dialog'));
    expect(await page.locator(tid('confirm-void')).isDisabled(), 'reason required'); await page.fill(tid('void-reason'), 'Charged the wrong client');
    await page.click(tid('confirm-void')); await page.waitForSelector(tid('note')); await settle();
    const p = (await SQL('payment', seeded.p6202))[0]; const first = await page.locator(`${tid('ledger')} tbody tr`).first().innerText();
    expect(settled === 0 && p.status === 'voided' && /Void/.test(first) && /#6202/.test(first), `${settled} ${p.status}`); return `#6201 (settled) no Void · #6202 voided · ledger: ${first.replace(/\s+/g, ' ').slice(0, 60)}`;
  });
  await step('refunds: a lost processor answer holds the amount and blocks a second refund — never a silent retry', async () => {
    await J('/__lost?on=1');
    await page.click(tid('find-payment')); await page.waitForSelector(tid('find-dialog'));
    await page.fill(tid('find-query'), '#6201'); await page.waitForSelector(tid('find-refund')); await page.click(tid('find-refund')); await page.waitForSelector(tid('refund-dialog'));
    await page.fill(tid('refund-amount'), '20'); await page.fill(tid('refund-reason'), 'Price adjustment'); await page.click(tid('review-refund')); await page.click(tid('confirm-refund'));
    await page.waitForSelector(tid('note')); await settle(); const note = await T(tid('note'));
    await page.click(tid('find-payment')); await page.waitForSelector(tid('find-dialog')); await page.fill(tid('find-query'), '#6201'); await page.waitForSelector(tid('find-results'));
    const again = await T(tid('find-results')); const nRef = await page.locator(tid('find-refund')).count(); await close();
    const rf = await SQL('refunds', seeded.p6201);
    expect(/answer was lost/i.test(note) && nRef === 0 && /waiting for the processor/.test(again) && rf.length === 1 && rf[0].status === 'processing', `${note} · ${rf.map((x) => x.status)}`);
    return `${note.slice(0, 80)} · Find now: "${again.match(/a refund on it[^\n]*/)?.[0] ?? ''}"`;
  });
  await step('refunds: front desk can look up but not refund or void (the reason is said); export needs its permission', async () => {
    await J('/__role?r=FRONT_DESK'); await go('/tenant/payments/refunds-voids');
    await page.click(tid('find-payment')); await page.waitForSelector(tid('find-dialog')); await page.fill(tid('find-query'), '#6005'); await page.waitForSelector(tid('find-results'));
    const t = await T(tid('find-results')); const b = await page.locator(`${tid('find-refund')}, ${tid('find-void')}`).count(); await close(); const ex = await page.locator(tid('export')).count();
    await J('/__role?r=OWNER'); expect(b === 0 && /your role cannot do this/.test(t) && ex === 0, t.slice(0, 80)); return `no Refund / Void · "your role cannot do this" · no Export`;
  });
  await step('refunds: export is every matching reversal, masked, no card numbers; a read failure is an error, not $0.00', async () => {
    await go('/tenant/payments/refunds-voids');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(tid('export'))]);
    const csv = await readFile(await dl.path(), 'utf8'); expect(/Reversed amount/.test(csv) && !/555-1234/.test(csv) && !/4242/.test(csv), 'csv');
    await J('/__fail?on=1'); await go('/tenant/payments/refunds-voids'); const t = await T('.work.fit'); await J('/__fail?on=0');
    expect(/could not be reached/i.test(t) && !(await page.locator(`${tid('kpi-refunds')} .fk-kpi-v`).count()), 'error'); return `${dl.suggestedFilename()} · failure → honest error, no KPI figures`;
  });
  await J('/__tenant?name=empty');
  await step('empty salon: verified-zero empty states on both pages', async () => {
    await go('/cash-handoffs'); const a = await T(tid('handoffs')); await go('/tenant/payments/refunds-voids'); const b = await T(tid('ledger')); await J('/__tenant?name=pilot');
    expect(/No technician cash hand-offs found/.test(a) && /No refunds or voids recorded/.test(b), 'empty'); return 'No technician cash hand-offs found for this period · No refunds or voids recorded';
  });
  await J('/__lang?l=vi');
  await step('vietnamese: both pages switch language', async () => {
    await go('/cash-handoffs'); const a = await T(tid('kpi-expected')); await go('/tenant/payments/refunds-voids'); const b = await T(tid('kpi-refunds')); await J('/__lang?l=en');
    expect(/dự kiến/i.test(a) && /hoàn tiền/i.test(b), `${a} / ${b}`); return `${a.split('\n')[0]} · ${b.split('\n')[0]}`;
  });
  await step('no page errors across the run', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); return 'none'; });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []); const log = await J('/__log').catch(() => []);
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled, simulated: log.filter((l) => l.startsWith('SIMULATED')) }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · unhandled ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
