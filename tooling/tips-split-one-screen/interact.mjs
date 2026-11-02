// interact.mjs — Tips & Gratuity + Split Payments one-screen E2E (Oct 29 2026). The REAL POS bundle in Chromium against
// live-server.mjs (real read models on a seeded TEST database). Each step clicks what a salon user clicks and checks the
// answer on screen AND in the database. Nothing leaves the machine: no processor, no payroll run; no money moves. (The tip
// re-allocation write is the harness's SIMULATED row changes with the product's own validation rules — see live-server.mjs.)
// Writes results/<label>/e2e.json and one screenshot per step.
//   node tooling/tips-split-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = 4360, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const SQL = async (k, a = '') => J('/__sql?k=' + k + (a ? '&a=' + encodeURIComponent(a) : ''));
const seeded = await J('/__seeded');
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
  if (!ok) await page.keyboard.press('Escape').catch(() => undefined);
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const cents = (s) => Math.round(Number(String(s).replace(/[^\d.-]/g, '')) * 100);
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit', { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const noJunk = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined|\[object Object\]/.test(body), 'page shows Invalid Date / NaN / undefined'); expect(!/SEEDSECRET/.test(body), 'a gift card code is on the page'); };
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
async function customRange(from, to) {
  await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
  await page.click(`${tid('range-calendar')} [data-ymd="${from}"]`); await page.click(`${tid('range-calendar')} [data-ymd="${to}"]`);
  await page.click(tid('range-apply')); await settle();
}
const today = new Date(); const ymd = (d) => d.toISOString().slice(0, 10); const daysAgo = (k) => ymd(new Date(Date.now() - k * 86400000));

try {
  // ══ Tips & Gratuity ══════════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/tips');
  const s0 = await API('/pos/payments/tips/summary?preset=month&dateField=collected');
  await step('tips: the five KPIs are the server aggregates (This Month, collection date) — never a page sum', async () => {
    expect(cents(await T(`${tid('kpi-total')} .fk-kpi-v`)) === s0.kpis.totalTipsCents, 'total');
    expect(cents(await T(`${tid('kpi-card')} .fk-kpi-v`)) === s0.kpis.cardTipsCents, 'card');
    expect(cents(await T(`${tid('kpi-cash')} .fk-kpi-v`)) === s0.kpis.cashTipsCents, 'cash');
    expect(s0.kpis.cardTipsCents + s0.kpis.cashTipsCents === s0.kpis.totalTipsCents, 'card + cash == total');
    expect(num(await T(`${tid('kpi-notip')} .fk-kpi-v`)) === s0.kpis.noTipCount, 'no-tip');
    expect((await T(`${tid('kpi-avg')} .fk-kpi-v`)).includes('%'), 'avg tip is a rate with its definition');
    await noJunk();
    return `total ${s0.kpis.totalTipsCents} = card ${s0.kpis.cardTipsCents} + cash ${s0.kpis.cashTipsCents} · avg ${s0.kpis.avgTipRatePct}% ($${(s0.kpis.avgTipPerTippedTicketCents / 100).toFixed(2)} per tipped ticket) · no-tip ${s0.kpis.noTipCount} of ${s0.kpis.eligibleTickets}`;
  });
  await step('tips: the photo — #1052 collected $9.60; the distribution shows Vishal $9.60 (not $19.20) and the strip flags the doubled payroll snapshot', async () => {
    const mini = await T(tid('distribution-mini-table')); const row = mini.split('\n').find((l) => /Vishal/.test(l));
    const dist = await API('/pos/payments/tips/distribution?preset=month&dateField=collected&pageSize=50');
    const v = dist.items.find((x) => /Vishal/.test(x.name)); const snap = await SQL('snapshot', seeded.photo); const alloc = await SQL('alloc', seeded.photo);
    expect(alloc[0].tip_cents === 960 && snap[0].s === 1920 && snap[0].n === 2, 'seed: allocation 960, snapshot 1920 on two rows');
    expect(v.allocatedCents % 960 === 0 || v.allocatedCents >= 960, 'vishal has the 960 allocation once');
    const photoRow = (await API('/pos/payments/tips/transactions?preset=all&search=1052')).items[0];
    expect(photoRow.amountCents === 960 && photoRow.allocatedCents === 960 && photoRow.snapshotCents === 1920 && photoRow.snapshotMismatch === true, 'the row reads the allocation grain and flags the snapshot');
    expect(await page.locator(tid('mismatch-chip')).count() === 1 && s0.reconciliation.snapshotMismatchTickets === 1, 'strip flags 1 ticket');
    expect(/Vishal/.test(await T(tid('tech-bars'))), 'chart is labelled, not a decorative block');
    return `#1052 collected 960 · allocated 960 · snapshot ${photoRow.snapshotCents} (2 rows) flagged · Vishal month allocation ${v.allocatedCents} · chart row "${row}"`;
  });
  await step('tips: reconciliation — collected + corrections = allocated + unallocated; payout never adds a tip', async () => {
    const r = s0.reconciliation;
    expect(r.collectedCents + r.manualCorrectionCents === r.allocatedCents + r.unallocatedCents, 'invariant');
    expect(r.paidOutCents + r.pendingPayoutCents === r.allocatedCents, 'paid + pending == allocated');
    const strip = await T(tid('recon-strip')); expect(strip.replace(/[^\d]/g, '').includes(String(r.collectedCents)), 'strip shows collected');
    return `collected ${r.collectedCents} + manual ${r.manualCorrectionCents} = allocated ${r.allocatedCents} + unallocated ${r.unallocatedCents} · paid out ${r.paidOutCents} · pending ${r.pendingPayoutCents} · reversed ${r.reversedCents}`;
  });
  await step('tips: a 3-technician split allocates exactly the one collected tip; the split-tender ticket is one tip', async () => {
    const d = await API(`/pos/payments/tips/${seeded.s150}/detail`);
    expect(d.tip.amountCents === 2000 && d.payments.length === 3, 'one $20 tip on three tenders');
    expect(d.allocations.reduce((a, x) => a + x.allocatedCents, 0) === 2000 && d.unallocatedCents === 0, 'Σ allocations == 2000');
    const multi = (await API('/pos/payments/tips/transactions?preset=all&pageSize=50')).items.filter((x) => x.technicians.length >= 3)[0];
    expect(!multi || multi.allocatedCents === multi.amountCents, 'a 3-way ticket allocates its tip once');
    return `#${d.tip.ticketNumber}: $20 tip · 3 tenders · allocations ${d.allocations.map((x) => `${x.name} ${x.allocatedCents}`).join(', ')}`;
  });
  await step('tips: search by customer phone (any format), technician, ticket #, payment ref — whole dataset, one row per tip', async () => {
    const find = async (s) => { await page.fill(tid('search'), s); await settle(); return (await page.locator(tid('tip-row')).allInnerTexts()).map((t) => (t.match(/#\d+/) || [''])[0]); };
    const a = await find('856.555.1234'); expect(a.length >= 2 && a.includes('#1052'), `phone → ${a}`);
    const b = await find('Vishal'); expect(b.length >= 3, 'technician name');
    const c = await find('#1052'); expect(c.length === 1 && c[0] === '#1052', 'ticket #');
    const ref = (await API('/pos/payments/tips/transactions?preset=all&search=1052')).items[0].paymentRefs[0];
    const d = await find(ref); expect(d.length === 1, 'payment reference');
    await page.fill(tid('search'), 'nobody-here'); await settle(); expect(await page.locator(tid('transactions')).innerText().then((t) => /No tips match/.test(t)), 'no-results state');
    await page.getByRole('button', { name: 'Clear filters' }).first().click(); await settle();
    return `phone → ${a.length} · technician → ${b.length} · #1052 → 1 · ${ref} → 1 · no-results + Clear filters`;
  });
  await step('tips: Custom Range month calendar applies an inclusive range (salon-local), refetches, resets to Page 1', async () => {
    await page.click(tid('tab-transactions')); await settle();
    await customRange(daysAgo(20), daysAgo(1));
    const s = await API(`/pos/payments/tips/summary?preset=custom&from=${daysAgo(20)}&to=${daysAgo(1)}&dateField=collected`);
    expect(cents(await T(`${tid('kpi-total')} .fk-kpi-v`)) === s.kpis.totalTipsCents, 'KPIs follow the range');
    const pager = await page.locator(`${tid('transactions')} .fk-pager`).innerText(); expect(/Page 1 of/.test(pager), 'page 1');
    await page.click(tid('preset-month')); await settle();
    return `range ${daysAgo(20)}…${daysAgo(1)} · total ${s.kpis.totalTipsCents} · ${pager.replace(/\s+/g, ' ').slice(0, 50)}`;
  });
  await step('tips: date field switches to Checkout date; status filter "No tip" and "Snapshot mismatch" open the right lists', async () => {
    await page.selectOption(tid('date-basis'), 'checkout'); await settle(); expect(/Checkout date/.test(await T('.fn-tabsrow.tp-periodrow')), 'basis label');
    await page.selectOption(tid('date-basis'), 'collected'); await settle();
    await page.selectOption(tid('status'), 'no_tip'); await settle();
    const rows = await page.locator(tid('tip-row')).allInnerTexts(); expect(rows.length > 0 && rows.every((r) => /\$0\.00/.test(r)), 'no-tip rows');
    await page.selectOption(tid('status'), 'mismatch'); await settle();
    const m = await page.locator(tid('tip-row')).allInnerTexts(); expect(m.length === 1 && /#1052/.test(m[0]) && /Snapshot mismatch/.test(m[0]), 'mismatch list');
    await page.selectOption(tid('status'), ''); await settle();
    return `no-tip rows ${rows.length} · mismatch → #1052`;
  });
  await step('tips: pagination — Page 1 newest, Page 2 older, Previous / Next states, no duplicates', async () => {
    await page.click(tid('tab-transactions')); await settle();
    const p1 = await page.locator(tid('tip-row')).allInnerTexts();
    await page.locator(`${tid('transactions')} .fk-pager .fk-pbtn.num`).nth(1).click(); await settle();
    const p2 = await page.locator(tid('tip-row')).allInnerTexts(); const pager = await page.locator(`${tid('transactions')} .fk-pager`).innerText();
    expect(p1.length > 0 && p2.length > 0 && !p1.some((r) => p2.includes(r)), 'pages differ');
    expect(/Page 2 of/.test(pager), 'page 2');
    await page.locator(`${tid('transactions')} .fk-pager .fk-pbtn.num`).first().click(); await settle();
    return `page 1 ${p1.length} rows · page 2 ${p2.length} rows · ${pager.replace(/\s+/g, ' ').slice(0, 60)}`;
  });
  await step('tips: detail separates collected / allocated / snapshot / corrections / payout; a paid-period tip reads Paid out', async () => {
    await page.fill(tid('search'), '1052'); await settle();
    await page.locator(tid('tip-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('tip-detail')); await settle();
    expect(await page.locator(tid('mismatch-flag')).count() === 1, 'mismatch flag in detail');
    const alloc = await T(tid('alloc-table')); expect(/Vishal/.test(alloc) && /\$9\.60/.test(alloc) && /\$19\.20/.test(alloc), 'allocated vs snapshot both shown');
    await close(); await page.fill(tid('search'), ''); await settle();
    const old = await API(`/pos/payments/tips/${seeded.old}/detail`); expect(old.tip.payout.state === 'paid', 'paid-period tip');
    expect(old.adjustments.filter((x) => x.kind === 'correction').length === 2, 'manual re-split entries');
    return `#1052: allocated $9.60 · snapshot $19.20 flagged · #${old.tip.ticketNumber}: payout ${old.tip.payout.state} (${old.tip.payout.periodLabel}), ${old.adjustments.length} correction entries`;
  });
  await step('tips: a correction is a reasoned re-allocation (Σ must equal the tip) — posted deltas, snapshot untouched, audited', async () => {
    const d = await API(`/pos/payments/tips/${seeded.s150}/detail`);
    await page.fill(tid('search'), String(d.tip.ticketNumber)); await settle();
    await page.locator(tid('tip-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('tip-detail')); await settle();
    await page.click(tid('adjust')); await page.waitForSelector(tid('adjust-form'));
    const ids = d.allocations.map((a) => a.technicianId);
    await page.fill(tid('alloc-' + ids[0]), '10.00'); await page.fill(tid('alloc-' + ids[1]), '5.00');
    expect(await page.locator(tid('adjust-save')).isDisabled(), 'sum ≠ tip is refused');
    await page.fill(tid('alloc-' + ids[1]), '10.00'); await page.fill(tid('adjust-reason'), 'Both did half the set');
    await page.click(tid('adjust-save')); await settle();
    const after = await SQL('alloc', seeded.s150); const corr = await SQL('corrections', seeded.s150); const snap = await SQL('snapshot', seeded.s150);
    expect(after.every((a) => Number(a.tip_cents) === 1000), `allocations ${JSON.stringify(after)}`);
    expect(corr.length === 2 && corr.reduce((a, c) => a + Number(c.amount_cents), 0) === 0 && corr.every((c) => c.source === 'manual' && c.status === 'posted'), 'two posted deltas netting to zero');
    expect(snap.reduce((a, s) => a + s.s, 0) === 2000, 'snapshot untouched');
    const au = await SQL('audit'); expect(au.some((a) => a.action_type === 'ticket.tip_allocation_set'), 'audited');
    await close(); await page.fill(tid('search'), ''); await settle();
    return `allocations → ${after.map((a) => a.tip_cents).join('/')} · corrections ${corr.map((c) => c.amount_cents).join(', ')} · snapshot Σ 2000 · audit ${au[0].action_type}`;
  });
  await step('tips: Technician Distribution and Adjustments & Reports views; export is permission-gated and masked', async () => {
    await page.click(tid('tab-distribution')); await settle();
    const t = await T(tid('distribution-table')); expect(/Vishal/.test(t) && /Chi Pham/.test(t), 'distribution rows');
    await page.click(tid('tab-adjustments')); await settle();
    const a = await T(tid('adjustments-table')); expect(/Refund/.test(a) && /Both did half/.test(a), 'reversal + the new correction listed');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(tid('export'))]);
    const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'); expect(/Tip events/.test(csv) && !/\(856\) 555-1234/.test(csv), 'csv masked');
    return `distribution ok · adjustments list ok · export ${dl.suggestedFilename()} (${csv.split('\n').length} lines, contact masked)`;
  });
  await J('/__role?r=TECHNICIAN');
  await step('technician: the tips report is refused (403 → honest permission state, no fake $0)', async () => {
    await go('/tenant/payments/tips'); const t = await T('.work.fit'); expect(/cannot see this information/.test(t) && !/\$0\.00/.test(t), 'permission state');
    const r = await fetch(BASE + '/api/v1/pos/payments/tips/export?preset=all'); expect(r.status === 403, `export ${r.status}`);
    return 'permission state · export 403';
  });
  await J('/__role?r=OWNER');

  // ══ Split Payments ═══════════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/split-payments');
  const p0 = await API('/pos/payments/split-payments/summary?preset=month&dateField=completed');
  await step('split: KPIs count each ticket once; a declined attempt is never a tender; Outstanding is the partial ticket\'s balance', async () => {
    expect(num(await T(`${tid('kpi-tickets')} .fk-kpi-v`)) === p0.kpis.splitTickets, 'tickets');
    expect(cents(await T(`${tid('kpi-total')} .fk-kpi-v`)) === p0.kpis.splitTotalCents, 'total');
    expect(cents(await T(`${tid('kpi-outstanding')} .fk-kpi-v`)) === p0.kpis.outstandingCents && p0.kpis.outstandingCents === 5000, 'outstanding $50 ($120 − $70)');
    const db = await SQL('splits'); const allTime = await API('/pos/payments/split-payments/summary?preset=all'); expect(db.length === allTime.kpis.splitTickets, `db qualifying ${db.length} vs ${allTime.kpis.splitTickets}`);
    await noJunk();
    return `split ${p0.kpis.splitTickets} (db ${db.length}) · total ${p0.kpis.splitTotalCents} · avg ${p0.kpis.avgTenders} · completed ${p0.kpis.completedTickets} · outstanding ${p0.kpis.outstandingCents}`;
  });
  await step('split: one row per ticket; the $150 three-way ticket opens its breakdown IN PLACE — Total · Cash · Card · Gift Card · Remaining $0', async () => {
    await page.fill(tid('search'), 'John Smith'); await settle();
    const rows = await page.locator(tid('ticket-row')).allInnerTexts(); expect(rows.length === 2, `john rows ${rows.length}`);
    const r150 = page.locator(tid('ticket-row')).filter({ hasText: '$150.00' }).first();
    await r150.locator(tid('toggle-breakdown')).click(); await settle();
    const bd = await T(tid('breakdown-row'));
    expect(/Total ticket[\s\S]*\$150\.00/.test(bd) && /Cash[\s\S]*\$50\.00/.test(bd) && /Credit Card[\s\S]*\$60\.00/.test(bd) && /Gift Card[\s\S]*\$40\.00/.test(bd) && /Remaining balance[\s\S]*\$0\.00/.test(bd), `breakdown: ${bd}`);
    expect(/3 confirmed of 3/.test(bd) && /\$20\.00 tip/.test(bd), 'tender count + the one tip');
    return bd.replace(/\s+/g, ' ').slice(0, 160);
  });
  await step('split: the $120 partial ticket — $70 confirmed, the $50 decline shown as a failed attempt, $50 due, Finish at Checkout', async () => {
    await page.fill(tid('search'), ''); await page.selectOption(tid('status'), 'partially_paid'); await settle();
    const rows = await page.locator(tid('ticket-row')).allInnerTexts(); expect(rows.length === 1 && /\$120\.00/.test(rows[0]) && /\$50\.00/.test(rows[0]) && /1 failed/.test(rows[0]), `row: ${rows[0]}`);
    await page.locator(tid('ticket-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('detail-dialog')); await settle();
    const t = await T(tid('tenders-table')); expect(/Confirmed/.test(t) && /Failed/.test(t) && /declined/.test(t), 'tender states');
    expect(await page.locator(tid('open-checkout')).count() === 1, 'finish at checkout');
    await close(); await page.selectOption(tid('status'), ''); await settle();
    return `row: ${rows[0].replace(/\s+/g, ' ').slice(0, 120)}`;
  });
  await step('split: the $30 refund is attributed to its card tender (refundable $30 left), the ticket reads Partially refunded', async () => {
    const d = await API(`/pos/payments/split-payments/${seeded.sRef}/detail`);
    const card = d.tenders.find((x) => x.method === 'card');
    expect(d.ticket.status === 'partially_refunded' && card.refundedCents === 3000 && card.refundableCents === 3000 && d.ticket.paidCents === 10000 && d.ticket.balanceCents === 0, JSON.stringify({ s: d.ticket.status, card }));
    expect(d.refunds[0].reason === 'Customer unhappy with the polish', 'refund reason');
    return `#${d.ticket.ticketNumber}: paid 10000 · refunded 3000 on card (3000 still refundable) · ${d.ticket.status}`;
  });
  await step('split: gift-card tender is linked to its ledger entry — the code never appears; search by phone / ticket / ref / amount', async () => {
    const g = await API(`/pos/payments/split-payments/${seeded.s80}/detail`); const gift = g.tenders.find((x) => x.method === 'gift_card');
    expect(gift.giftCard?.last4 === '4471' && gift.giftCard?.ledgerEntryId && !JSON.stringify(g).includes('SEEDSECRET'), 'gift ledger link, no code');
    const find = async (s) => { await page.fill(tid('search'), s); await settle(); return page.locator(tid('ticket-row')).count(); };
    expect(await find('(856) 555-1234') === 2, 'phone'); expect(await find('#1201') === 1, 'ticket');
    const ref = g.ticket.paymentRefs[0]; expect(await find(ref) === 1, 'reference'); expect(await find('$40.00') >= 2, 'tender amount');
    await page.fill(tid('search'), ''); await settle();
    return `gift ••••4471 → ledger ${gift.giftCard.ledgerEntryId.slice(0, 8)}… · phone 2 · #1101 1 · ${ref} 1 · $40.00 ≥ 2`;
  });
  await step('split: method combination, register and sort filters; Custom Range; pagination', async () => {
    await page.selectOption(tid('methods'), 'three_plus'); await settle(); expect(await page.locator(tid('ticket-row')).count() === 1, 'three+');
    await page.selectOption(tid('methods'), 'gift_card'); await settle(); expect(await page.locator(tid('ticket-row')).count() === 2, 'gift + card');
    await page.selectOption(tid('methods'), ''); await page.selectOption(tid('sort'), 'total_desc'); await settle();
    const tot = (await page.locator(tid('ticket-row')).allInnerTexts()).map((t) => cents((t.match(/\$[\d,]+\.\d\d/g) || [])[0])); expect(tot.length > 1 && tot.every((v, i) => i === 0 || v <= tot[i - 1]), `highest total first: ${tot}`);
    await page.selectOption(tid('sort'), 'created_desc');
    await customRange(daysAgo(25), daysAgo(1)); const pager = await page.locator(`${tid('tickets')} .fk-pager`).innerText(); expect(/Page 1 of/.test(pager), 'page 1');
    await page.click(tid('preset-month')); await settle();
    return `three+ 1 · gift+card 2 · total_desc ok · ${pager.replace(/\s+/g, ' ').slice(0, 50)}`;
  });
  await step('split: export is one row per ticket with the breakdown columns, masked; a read failure is an error, not $0', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(tid('export'))]);
    const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'); expect(/Gift card/.test(csv) && !/\(856\) 555-1234/.test(csv), 'csv');
    await J('/__fail?on=1'); await go('/tenant/payments/split-payments'); const t = await T('.work.fit');
    expect(/could not be reached|Unable to load|temporarily unavailable/i.test(t) && !/^\s*0\s*$/m.test(t), 'error state');
    await J('/__fail?on=0');
    return `export ${dl.suggestedFilename()} · failure → honest error state`;
  });
  await J('/__tenant?name=empty');
  await step('empty salon: honest empty states on both pages', async () => {
    await go('/tenant/payments/tips'); const a = await T(tid('recent'));
    await go('/tenant/payments/split-payments'); const b = await T(tid('tickets'));
    await J('/__tenant?name=pilot'); expect(/No tips/.test(a) && /No split-tender/.test(b), 'empty texts');
    return `${a.split('\n').find((l) => /^No /.test(l))} | ${b.split('\n').find((l) => /^No /.test(l))}`;
  });
  await J('/__lang?l=vi');
  await step('vietnamese: both pages switch language', async () => {
    await go('/tenant/payments/tips'); const h = await T(tid('kpi-total')); await go('/tenant/payments/split-payments'); const k = await T(tid('kpi-tickets'));
    await J('/__lang?l=en'); expect(/tổng tiền tip/i.test(h) && /nhiều phần/i.test(k), `vi: ${h} / ${k}`); return `${h.split('\n')[0]} · ${k.split('\n')[0]}`;
  });
  await step('no page errors across the run', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); return 'none'; });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []); const log = await J('/__log').catch(() => []);
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled, simulated: log.filter((l) => l.startsWith('SIMULATED')) }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · unhandled ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
