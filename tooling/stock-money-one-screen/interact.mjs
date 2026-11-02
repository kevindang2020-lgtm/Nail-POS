// interact.mjs — Stock Alerts + Transactions + Payments & Money one-screen E2E (Oct 29 2026). The REAL POS bundle in Chromium
// against live-server.mjs (the REAL controllers, product-usage writer, read models and sidebar badge on a seeded TEST
// database). Each step clicks what a salon user clicks and checks the answer on screen AND in the database. Nothing leaves
// the machine: no processor, no SMS / email (a receipt resend is SIMULATED), no money moves.
//   node tooling/stock-money-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = 4398, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const POST = (p, b, h = {}) => fetch(BASE + '/api/v1' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const SQL = async (k, a = '') => J('/__sql?k=' + k + (a ? '&a=' + encodeURIComponent(a) : ''));
const seeded = await J('/__seeded');
const ANNA = 'e0950000-0000-4000-8000-000000000001';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d, k) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const results = []; let n = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|403|409|400|422|503|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
async function step(name, fn) {
  const t = Date.now(); let ok = true, detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { ok = false; detail = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 70)}.png`) }).catch(() => undefined);
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); await page.keyboard.press('Escape').catch(() => undefined); }
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit', { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const noJunk = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined|\[object Object\]/.test(body), 'page shows Invalid Date / NaN / undefined'); };
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
const kpi = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).trim();
async function customRange(from, to) {
  await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
  const cell = async (d) => { for (let i = 0; i < 3 && !(await page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).count()); i++) await page.locator(`${tid('range-calendar')} button[aria-label*="revious"]`).first().click(); return page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).first(); };
  await (await cell(from)).click(); await (await cell(to)).click();
  await page.click(tid('range-apply')); await settle();
}

try {
  // ══ Stock Alerts ════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/inventory/alerts');
  await step('stock: the sidebar badge and Open Alerts are the SAME number (11 low products, 1 acknowledged → 10)', async () => {
    const badge = (await API('/tenant/navigation/badges')).inventoryAlerts; const open = await kpi('kpi-open'); const sum = await API('/tenant/inventory/stock-alerts/summary');
    const rows = await page.locator(`${tid('alert-row')}`).count(); await noJunk();
    expect(Number(open) === badge && badge === sum.openAlerts && sum.totalAlerts === 11 && rows === 10, `badge ${badge} · kpi ${open} · total ${sum.totalAlerts} · rows ${rows}`);
    const alertRows = await SQL('alerts'); expect(alertRows.length <= 3, `alert rows ${alertRows.length}`);
    return `sidebar ${badge} = Open Alerts ${open} · ${sum.totalAlerts} at risk, ${sum.acknowledged} acknowledged · the old page counted ${alertRows.filter((a) => !a.acked && !a.resolved).length} persisted rows`;
  });
  await step('stock: Show acknowledged lists all 11; Last Used By shows the technician or "No recorded use"', async () => {
    await page.click(tid('show-ack')); await settle(); const rows = await page.locator(tid('alert-row')).count();
    const used = await page.locator(tid('alert-row'), { hasText: 'Cherry Bomb' }).first().innerText(); const never = await page.locator(tid('alert-row'), { hasText: 'Ballet Slipper' }).first().innerText();
    await page.click(tid('show-ack')); await settle();
    expect(rows === 11 && /Anna Lee/.test(used) && /No recorded use/.test(never), `${rows} · ${used.replace(/\n/g, ' ')} · ${never.replace(/\n/g, ' ')}`); return `11 rows · Cherry Bomb → Anna Lee (0.5) · Ballet Slipper → No recorded use`;
  });
  await step('stock: one search box — SKU, vendor phone, PO number, technician', async () => {
    const hits = {};
    for (const s of ['GEL-405', '609-555-0188', 'PO-1042']) { await page.fill(tid('search'), s); await settle(); hits[s] = await page.locator(tid('alert-row')).count(); }
    const po = await T(tid('sa-list')); await page.fill(tid('search'), ''); await settle();
    expect(hits['GEL-405'] === 1 && hits['609-555-0188'] >= 3 && hits['PO-1042'] === 1 && /Rose Petal/.test(po), JSON.stringify(hits)); return `GEL-405 → 1 · (609) 555-0188 → ${hits['609-555-0188']} · PO-1042 → Rose Petal Gel (6 on order)`;
  });
  await step('stock: acknowledging a product low since setup (no alert row) drops both counts by one, and it is audited', async () => {
    const b0 = (await API('/tenant/navigation/badges')).inventoryAlerts;
    const r = page.locator(tid('alert-row'), { hasText: 'Ballet Slipper' }).first(); await r.locator(tid('ack')).click(); await settle();
    const b1 = (await API('/tenant/navigation/badges')).inventoryAlerts; const open = await kpi('kpi-open'); const audit = await SQL('audit');
    expect(b1 === b0 - 1 && Number(open) === b1 && audit.some((a) => a.action_type === 'inventory_alert_acknowledged'), `${b0} → ${b1} · kpi ${open}`); return `badge ${b0} → ${b1} · Open Alerts ${open} · audit inventory_alert_acknowledged`;
  });
  let ev;
  await step('stock: Record Product Use — Base Coat 0.5 for Anna Lee (the owner records it, with a reason): stock before → after, one event, ONE movement', async () => {
    await page.click(tid('record-use')); await page.fill(tid('product-find'), 'BC-01'); await settle();
    await page.click(tid('product-pick')); await page.selectOption(tid('tech-pick'), ANNA); await page.fill(tid('on-behalf-reason'), 'entered at the front desk'); await page.click(tid('qty-0.5'));
    await page.click(tid('review-use')); const rv = await T(tid('use-review'));
    const m0 = (await SQL('moves')).length; await page.click(tid('confirm-use')); await settle();
    const note = await T(tid('note')); const m1 = await SQL('moves'); const e = (await SQL('events'))[0]; ev = e;
    expect(/Stock before/.test(rv) && /Recorded/.test(note) && m1.length === m0 + 1 && m1[0].related_id === e.id && e.quantity_hundredths === 50, `${rv.replace(/\n/g, ' ')} · ${note}`);
    return `${rv.split('\n').slice(0, 6).join(' ')} · "${note.split('\n')[0]}" · movement → product_usage_event ${e.id.slice(-6)}`;
  });
  await step('stock: a retry with the same Idempotency-Key replays — nothing is taken twice; a new key for another amount records anew', async () => {
    const pid = (await API('/tenant/inventory/stock-alerts/pickers?search=BC-01')).products[0].id;
    const a = await POST('/tenant/inventory/stock-alerts/usage', { productId: pid, quantity: '0.25', technicianId: ANNA, onBehalfReason: 'double tap test' }, { 'idempotency-key': 'e2e-double-tap' });
    const b = await POST('/tenant/inventory/stock-alerts/usage', { productId: pid, quantity: '0.25', technicianId: ANNA, onBehalfReason: 'double tap test' }, { 'idempotency-key': 'e2e-double-tap' });
    const c = await POST('/tenant/inventory/stock-alerts/usage', { productId: pid, quantity: '1', technicianId: ANNA, onBehalfReason: 'double tap test' }, { 'idempotency-key': 'e2e-double-tap' });
    const evs = (await SQL('events')).filter((x) => x.idempotency_key === 'e2e-double-tap');
    expect(a.status === 200 && b.status === 200 && b.body.replay === true && evs.length === 1 && c.status === 422, `${a.status}/${b.status} replay=${b.body.replay} · ${evs.length} · reuse ${c.status}`); return 'first 200 · second 200 replay:true · ONE event · key reused for 1.0 → 422 IDEMPOTENCY_KEY_REUSED';
  });
  await step('stock: product overlay — every technician who used Base Coat, Last Used By = latest by when it happened', async () => {
    await page.click(tid('tab-usage')); await settle(); await page.fill(tid('search'), 'Base Coat'); await settle();
    await page.locator(tid('usage-row')).first().locator(tid('view-usage')).click(); await page.waitForSelector(tid('product-dialog')); await settle();
    const last = await T(tid('product-last-used')); const techs = await page.locator(tid('by-tech-row')).allInnerTexts();
    expect(techs.length >= 2 && techs.some((t) => /Bao Tran/.test(t)) && techs.some((t) => /Anna Lee/.test(t)) && /Anna Lee/.test(last), `${last} · ${techs.join(' | ')}`);
    return `Last Used By ${last.replace(/\n/g, ' ')} · ${techs.map((t) => t.replace(/\t|\n/g, ' ')).join(' | ')}`;
  });
  await step('stock: a correction gives stock back (never an edit) — the use shows corrected, a usage_correction movement', async () => {
    await page.locator(tid('event-row')).first().locator(tid('correct')).click(); await page.waitForSelector(tid('adjust-dialog'));
    await page.click(tid('dir-back')); await page.fill(tid('adjust-amount'), '0.25'); await page.fill(tid('adjust-reason'), 'half was spilled back into the bottle'); await page.click(tid('confirm-adjust')); await settle();
    const first = await page.locator(tid('event-row')).first().innerText(); const mv = (await SQL('moves'))[0];
    await close(); await page.fill(tid('search'), ''); await settle();
    expect(/corrected from/i.test(first) && mv.related_type === 'product_usage_adjustment', `${first} · ${mv.related_type}`); return `${first.replace(/\n|\t/g, ' ')} · movement ${mv.related_type}`;
  });
  await step('stock: All Technicians keeps the two "Anna Lee"s apart; Alert History lists the acknowledged alert', async () => {
    await page.click(tid('tab-technicians')); await settle(); const annas = await page.locator(tid('tech-row'), { hasText: 'Anna Lee' }).count();
    await page.click(tid('tab-history')); await settle(); const hist = await page.locator(tid('history-row')).allInnerTexts(); await page.click(tid('tab-active')); await settle();
    expect(annas === 2 && hist.some((h) => /Acknowledged/.test(h)), `${annas} · ${hist.length}`); return `${annas} rows named Anna Lee · history ${hist.length} rows, acknowledged ones shown`;
  });
  await step('stock: Reorder opens a DRAFT purchase order prefilled with the suggestion (a draft adds no stock)', async () => {
    await page.locator(tid('alert-row'), { hasText: 'Mocha' }).first().locator(tid('reorder')).click(); await settle();
    const url = page.url(); expect(/purchase-orders\?new=1&productId=.*&qty=\d+/.test(url), url); return url.replace(BASE, '');
  });

  // ══ Transactions ═══════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/transactions');
  await step('transactions: Today reproduces the photo — 3 · $168.15 · $9.60 · $168.15, partial labelled, declined not counted', async () => {
    await page.click(tid('preset-today')); await settle();
    const k = [await kpi('kpi-transactions'), await kpi('kpi-gross'), await kpi('kpi-tips'), await kpi('kpi-net')]; const rows = await page.locator(tid('tx-row')).allInnerTexts(); await noJunk();
    expect(k.join('|') === '3|$168.15|$9.60|$168.15' && rows.some((r) => /one tender of a split/.test(r)) && rows.some((r) => /Failed/.test(r)), `${k} · ${rows.length}`);
    return `${k.join(' · ')} · ${rows.length} rows (the $51.72 split part + the declined $30.00 attempt listed, not counted)`;
  });
  await step('transactions: a phone in three formats finds the same payments — never the other salon\'s John Smith', async () => {
    await page.click(tid('preset-month')); await settle(); const got = [];
    for (const s of ['8565551234', '(856) 555-1234', '+1 856 555 1234']) { await page.fill(tid('search'), s); await settle(); got.push((await page.locator(tid('tx-row')).allInnerTexts()).join('|')); }
    const other = await page.locator(tid('tx-row'), { hasText: '$99.99' }).count(); await page.fill(tid('search'), ''); await settle();
    expect(got[0] && got[0] === got[1] && got[1] === got[2] && other === 0, 'phone formats differ'); return `${got[0].split('|').length} identical results in all three formats · other salon's $99.99 never shown`;
  });
  await step('transactions: details — the split ticket\'s tenders, lines and technicians, refund position, no edit / charge action', async () => {
    await page.fill(tid('search'), 'RR4010'); await settle(); await page.locator(tid('tx-row')).first().locator(tid('view')).click(); await page.waitForSelector(tid('tx-dialog')); await settle();
    const pos = await T(tid('refund-position')); const tenders = await page.locator(`${tid('ticket-tenders')} tbody tr`).count(); const lines = await T(tid('ticket-lines')); const dlg = await T(tid('tx-dialog'));
    await close(); await page.fill(tid('search'), ''); await settle();
    expect(/\$60\.00/.test(pos) && /−\$15\.00/.test(pos) && /−\$5\.00/.test(pos) && /\$40\.00/.test(pos) && tenders >= 2 && /Anna Lee/.test(lines) && /Bao Tran/.test(lines) && !/Edit payment|Charge/i.test(dlg), pos);
    return `${pos.replace(/\n/g, ' ')} · ${tenders} tenders · lines by Anna Lee + Bao Tran · no edit / charge`;
  });
  await step('transactions: a receipt resend goes to the existing Checkout route (SIMULATED here — nothing is sent)', async () => {
    await page.click(tid('preset-today')); await settle(); await page.locator(tid('tx-row')).last().locator(tid('view')).click(); await page.waitForSelector(tid('tx-dialog')); await settle();
    const settle1 = await T(tid('tender-facts')); await page.click(tid('receipt-email')); await settle(); const note = await T(tid('note')); await close();
    const log = await J('/__log'); expect(/BATCH-201/.test(settle1) && log.some((l) => /SIMULATED receipt/.test(l)) && /email/i.test(note), `${note}`); return `settlement BATCH-201 linked · "${note.split('\n')[0]}"`;
  });
  await step('transactions: Custom Range from the month calendar (yesterday → today) and numbered pages newest first', async () => {
    await customRange(addDays(today, -1), today); const sub = await T('.fk-head .sub'); const k = await kpi('kpi-transactions');
    await page.click(tid('preset-month')); await settle(); const p1 = await page.locator(tid('tx-row')).first().innerText();
    await page.locator('.fk-pager button', { hasText: '2' }).first().click(); await settle(); const p2 = await page.locator(tid('tx-row')).first().innerText();
    expect(p1 !== p2 && Number(k) >= 3, `${sub} · ${k}`); return `${sub.split('·').pop().trim()} → ${k} tenders · page 2 continues page 1`;
  });
  await step('transactions: export carries every matching tender with masked contact and the totals', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(tid('export'))]);
    const csv = await readFile(await dl.path(), 'utf8'); expect(/Tips \(once per ticket\)/.test(csv) && !/555-1234/.test(csv) && !/john\.smith@/.test(csv), 'csv'); return `${dl.suggestedFilename()} · ${csv.split('\n').length} lines · masked`;
  });

  // ══ Payments & Money ═══════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/overview');
  await step('money: the photo\'s $116.43 vs $168.15 — Collections $168.15 (every confirmed tender), Revenue = the two paid tickets', async () => {
    const k = { rev: await kpi('kpi-revenue'), col: await kpi('kpi-collections'), out: await kpi('kpi-outstanding'), tx: await kpi('kpi-transactions'), avg: await kpi('kpi-average'), fail: await kpi('kpi-failed'), pay: await kpi('kpi-payouts') };
    const tx = await API('/pos/payments/transactions/summary?preset=today'); await noJunk();
    expect(k.col === '$168.15' && tx.kpis.grossCents === 16815 && k.rev === '$108.83' && k.out === '$90.00' && k.tx === '3' && k.avg === '$54.42', JSON.stringify(k));
    return `Revenue ${k.rev} · Collections ${k.col} (= Transactions Gross) · Outstanding ${k.out} as of now · ${k.tx} tenders · Avg ${k.avg} ÷ 2 paid tickets · Failed ${k.fail} · Pending payouts ${k.pay}`;
  });
  await step('money: all six all-time totals and all eight Quick Actions are on screen without scrolling', async () => {
    const totals = await page.locator(`${tid('totals')} .pm-total`).count(); const qa = await page.locator(`${tid('quick-actions')} button`).allInnerTexts();
    const se = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    expect(totals === 6 && qa.length === 8 && se <= 0, `${totals} · ${qa.length} · ${se}`); return `${totals} totals · ${qa.join(' · ')}`;
  });
  await step('money: Transactions workspace keeps the six filters — Refunds (this month) shows the partly refunded card tender', async () => {
    await page.click(tid('preset-month')); await settle(); await page.click(tid('space-transactions')); await settle();
    await page.click(tid('kind-refunds')); await settle(); const r = await page.locator(tid('tx-row')).allInnerTexts();
    await page.click(tid('kind-voids')); await settle(); const v = await page.locator(tid('tx-row')).allInnerTexts();
    expect(r.some((x) => /\$60\.00/.test(x) && /Partially refunded/.test(x)) && v.length === 1 && /Voided/.test(v[0]), `${r.length} · ${v.length}`); return `Refunds → ${r.length} (the $60.00 card, −$15.00) · Voids → ${v.length}`;
  });
  await step('money: Revenue & Services ranks services (once per line) and Payouts & Health shows pending vs bank-confirmed', async () => {
    await page.click(tid('space-revenue')); await settle(); const svc = await page.locator(tid('service-row')).count();
    await page.click(tid('space-payouts')); await settle(); const pend = await T(tid('payouts-table')); await page.click(tid('payout-all')); await settle(); const all = await T(tid('payouts-table')); const h = await T(tid('health-status'));
    await page.click(tid('space-overview')); await settle();
    expect(svc >= 3 && /BATCH-201/.test(pend) && /Not confirmed by bank/.test(pend) && /Deposit recorded/.test(all) && /attention/i.test(h), `${svc} · ${h}`); return `${svc} services ranked · BATCH-201 pending (not confirmed by bank) · BATCH-200 deposit recorded · health "${h}"`;
  });
  await step('money: universal search — an invoice number and a phone find their records (typed results)', async () => {
    await page.fill(tid('search'), 'INV-0042'); await page.click(tid('search-go')); await page.waitForSelector(tid('search-dialog')); await settle(); const inv = await T(tid('search-dialog')); await close();
    await page.fill(tid('search'), '(856) 555-1234'); await page.keyboard.press('Enter'); await page.waitForSelector(tid('search-dialog')); await settle(); const ph = await page.locator(tid('search-payment')).count(); await close(); await page.fill(tid('search'), '');
    expect(/INV-0042/.test(inv) && ph >= 1, `${ph}`); return `INV-0042 found · phone → ${ph} payments`;
  });
  await step('money: Quick Action Reconcile opens the deposit reconciliation workflow (not Transactions)', async () => {
    await page.click(tid('qa-reconcile')); await settle(); const url = page.url(); await go('/tenant/payments/overview');
    expect(/deposit-reconciliation/.test(url), url); return url.replace(BASE, '');
  });
  await J('/__role?r=FRONT_DESK');
  await step('front desk: Transactions open with no refund action; the finance Overview says the role cannot see it', async () => {
    await go('/tenant/payments/transactions'); await page.click(tid('preset-today')); await settle(); const rows = await page.locator(tid('tx-row')).count();
    await page.locator(tid('tx-row')).first().locator(tid('view')).click(); await page.waitForSelector(tid('tender-facts')); const refund = await page.locator(tid('detail-refund')).count(); await close();
    await go('/tenant/payments/overview'); const o = await T('body');
    expect(rows >= 3 && refund === 0 && /cannot see this information/i.test(o), `${rows} · refund ${refund}`); return `Transactions: ${rows} rows, no Refund in details · Overview: "Your role cannot see this information"`;
  });
  await J('/__role?r=OWNER');
  await step('a read failure is an honest error, never $0.00 (Stock Alerts · Transactions · Overview)', async () => {
    await J('/__fail?on=1'); const out = [];
    for (const [u, k] of [['/tenant/inventory/alerts', 'kpi-open'], ['/tenant/payments/transactions', 'kpi-gross'], ['/tenant/payments/overview', 'kpi-collections']]) { await go(u); out.push([await T('.work.fit'), await page.locator(`${tid(k)} .fk-kpi-v`).count()]); }
    await J('/__fail?on=0'); expect(out.every(([t, c]) => /could not be reached/i.test(t) && c === 0), 'error'); return 'three honest errors, no figures';
  });
  await J('/__tenant?name=empty');
  await step('empty salon: verified-zero empty states', async () => {
    await go('/tenant/inventory/alerts'); const a = await T(tid('sa-list')); await go('/tenant/payments/transactions'); const b = await T(tid('ledger')); await go('/tenant/payments/overview'); const c = await kpi('kpi-collections'); await J('/__tenant?name=pilot');
    expect(/No product is at or below/.test(a) && /No transactions/i.test(b) && c === '$0.00', `${a} / ${b} / ${c}`); return 'No product at its reorder level · No transactions in this period · Collections $0.00';
  });
  await J('/__lang?l=vi');
  await step('vietnamese: the three pages switch language', async () => {
    await go('/tenant/inventory/alerts'); const a = await T(tid('tab-usage')); await go('/tenant/payments/transactions'); const b = await T(tid('kpi-tips')); await go('/tenant/payments/overview'); const c = await T(tid('kpi-collections')); await J('/__lang?l=en');
    expect(/dùng/i.test(a) && /tip/i.test(b) && /thu/i.test(c), `${a} / ${b} / ${c}`); return `${a} · ${b.split('\n')[0]} · ${c.split('\n')[0]}`;
  });
  await step('no page errors across the run', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); return 'none'; });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []); const log = await J('/__log').catch(() => []);
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled, simulated: log.filter((l) => l.startsWith('SIMULATED')) }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · unhandled ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
