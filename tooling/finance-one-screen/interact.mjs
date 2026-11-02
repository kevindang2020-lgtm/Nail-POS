// interact.mjs — Payments & Money one-screen E2E (Deposits & Settlements · AI Deposit Reconciliation · Invoices, Oct 29 2026).
// The REAL POS bundle in Chromium against live-server.mjs (real controllers + SQL on a seeded TEST database). Each step clicks
// what a salon user clicks and checks the answer on screen AND in the database / the audit trail the repositories wrote.
// Nothing leaves the machine: there is no processor, no bank and no messenger behind the harness; no money moves.
// Writes results/<label>/e2e.json and one screenshot per step.
//   node tooling/finance-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = 4320, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const SQL = async (k) => J('/__sql?k=' + k);
const results = []; let n = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|403|503|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
async function step(name, fn) {
  const t = Date.now(); let ok = true, detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { ok = false; detail = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 70)}.png`) }).catch(() => undefined);
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); const u = page.url(); await page.goto(u, { waitUntil: 'load' }).catch(() => undefined); await page.waitForTimeout(800); }
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const digits = (s) => String(s).replace(/[^\d-]/g, '');
const cents = (s) => Number(String(s).replace(/[^\d-]/g, ''));
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit', { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const dlg = (t) => page.locator(tid(t));
async function download(click) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), click()]);
  const p = join(OUT, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), path: p, body: readFileSync(p) };
}
const auditSince = async (from) => (await J('/__audit')).slice(from);
const pdfText = (p) => { try { return execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' }); } catch { return ''; } };
const noInvalid = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined/.test(body), 'page shows Invalid Date / NaN / undefined'); };
/** pick From and To on the Custom Range calendar (both days must be in the two visible months) */
async function customRange(from, to) {
  await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
  await page.click(`${tid('range-calendar')} [data-ymd="${from}"]`); await page.click(`${tid('range-calendar')} [data-ymd="${to}"]`);
  await page.click(tid('range-apply')); await settle();
}

try {
  // ══ Deposits & Settlements ══════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/settlements');
  const sum0 = await API('/pos/payments/settlements/summary?preset=month&dateField=settlement_date');
  await step('settlements: KPI cards are the server aggregates (This Month, salon time zone)', async () => {
    expect(cents(await T(`${tid('kpi-settlements')} .fk-kpi-v`)) === sum0.kpis.settlements, 'settlement count');
    expect(cents(await T(`${tid('kpi-gross')} .fk-kpi-v`)) === sum0.kpis.grossSettledCents, 'gross');
    expect(cents(await T(`${tid('kpi-fees')} .fk-kpi-v`)) === sum0.kpis.processorFeesCents, 'fees');
    expect(cents(await T(`${tid('kpi-net')} .fk-kpi-v`)) === sum0.kpis.netProcessorPayoutCents, 'net payout');
    expect(cents(await T(`${tid('kpi-refunds-total')} .fk-kpi-v`)) === sum0.kpis.refundsTotalCents, 'refunds total');
    const ap = await T(tid('active-period'));
    expect(ap.includes(sum0.period.from.slice(0, 4)), `active period "${ap}"`);
    await noInvalid();
    return `${sum0.kpis.settlements} batches · gross ${sum0.kpis.grossSettledCents} · period ${sum0.period.from}…${sum0.period.to} (${sum0.period.tz})`;
  });
  await step('settlements: reconciliation strip — expected payout = gross − fees − in-batch refunds (refunds not subtracted twice)', async () => {
    const r = sum0.reconciliation;
    expect(r.expectedPayoutCents === r.grossCents - r.feesDeductedCents - r.refundsInBatchCents - r.chargebacksInBatchCents + r.adjustmentsCents + (r.providerDefinedDifferenceCents ?? 0), 'arithmetic');
    expect(r.expectedPayoutCents === sum0.kpis.netProcessorPayoutCents, 'strip = Net Processor Payout KPI');
    const strip = await T(tid('recon-strip'));
    expect(strip.replace(/[^\d]/g, '').includes(String(r.expectedPayoutCents)), 'expected payout shown');
    return `gross ${r.grossCents} − fees ${r.feesDeductedCents} − in batch ${r.refundsInBatchCents} = ${r.expectedPayoutCents}; bank ${r.bankConfirmedCents}`;
  });
  await step('settlements: presets — This Year and Today are resolved by the server', async () => {
    await page.click(tid('preset-year')); await settle();
    const y = await API('/pos/payments/settlements/summary?preset=year&dateField=settlement_date');
    expect(y.period.from.endsWith('-01-01') && y.period.to.endsWith('-12-31'), 'year bounds');
    expect(cents(await T(`${tid('kpi-settlements')} .fk-kpi-v`)) === y.kpis.settlements, 'year KPI');
    await page.click(tid('preset-today')); await settle();
    const td = await API('/pos/payments/settlements/summary?preset=today&dateField=settlement_date');
    expect(td.period.from === td.period.to && td.period.from === td.period.today, 'today bounds');
    expect(cents(await T(`${tid('kpi-settlements')} .fk-kpi-v`)) === td.kpis.settlements, 'today KPI');
    return `year ${y.kpis.settlements} · today ${td.kpis.settlements} (${td.period.today})`;
  });
  await step('settlements: Custom Range calendar — Cancel applies nothing; From/To + Apply filters the list', async () => {
    await page.click(tid('preset-month')); await settle();
    const before = await T(tid('active-period'));
    await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
    await page.click(`${tid('range-calendar')} [data-ymd="2026-10-05"]`);
    await page.click(tid('range-cancel'));
    expect(await page.locator(tid('range-calendar')).count() === 0, 'calendar still open');
    expect(await T(tid('active-period')) === before, 'Cancel changed the period');
    await customRange('2026-10-05', '2026-10-12');
    const ap = await T(tid('active-period'));
    expect(/Oct 5, 2026.*Oct 12, 2026/.test(ap), `active period "${ap}"`);
    const s = await API('/pos/payments/settlements/summary?preset=custom&from=2026-10-05&to=2026-10-12&dateField=settlement_date');
    expect(cents(await T(`${tid('kpi-settlements')} .fk-kpi-v`)) === s.kpis.settlements, 'custom KPI');
    const dates = await page.locator(`${tid('settlement-row')} td:nth-child(2)`).allInnerTexts();
    expect(dates.length > 0 && dates.every((d) => { const day = Number(d.match(/Oct (\d+)/)?.[1]); return day >= 5 && day <= 12; }), `rows outside range: ${dates.join(', ')}`);
    return `${ap} → ${s.kpis.settlements} batches, rows ${dates.length}`;
  });
  await step('settlements: To before From is impossible — picking an earlier day restarts From', async () => {
    await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
    await page.click(tid('range-clear'));
    await page.click(`${tid('range-calendar')} [data-ymd="2026-10-20"]`); await page.click(`${tid('range-calendar')} [data-ymd="2026-10-10"]`);
    const from = await T(tid('range-from')), to = await T(tid('range-to'));
    expect(/Oct 10/.test(from) && !/Oct/.test(to), `from "${from}" to "${to}"`);
    expect(await page.locator(tid('range-apply')).isDisabled(), 'Apply enabled without a To');
    await page.keyboard.press('Escape'); await page.click(tid('preset-month')); await settle();
    return 'From restarted at Oct 10; Apply disabled until To';
  });
  await step('settlements: paging — numbered server pages, newest created first, page 2 differs', async () => {
    await page.click(tid('preset-year')); await settle();
    const p1 = await page.locator(`${tid('settlement-row')} .fk-li-t`).allInnerTexts();
    const nums = p1.map((r) => Number(r.replace(/\D/g, '')));
    expect(nums.every((v, i) => i === 0 || v < nums[i - 1]), `page 1 not newest first: ${p1.join(',')}`);
    await page.click(`${tid('records')} .fk-pbtn[aria-label="Page 2"]`); await settle();
    const p2 = await page.locator(`${tid('settlement-row')} .fk-li-t`).allInnerTexts();
    expect(p2.length > 0 && !p2.includes(p1[0]) && Number(p2[0].replace(/\D/g, '')) < nums[nums.length - 1], 'page 2');
    const range = await T(`${tid('records')} .fk-pager-range`);
    return `p1 ${p1[0]}…${p1[p1.length - 1]} · p2 ${p2[0]}… · "${range}"`;
  });
  await step('settlements: universal search — settlement ID, transaction, amount and customer, all server-side', async () => {
    await page.fill(tid('search'), 'CP-20260050'); await settle();
    const a = await page.locator(`${tid('settlement-row')} .fk-li-t`).allInnerTexts();
    expect(a.length === 1 && a[0] === 'CP-20260050', `by id: ${a.join(',')}`);
    await page.fill(tid('search'), 'TXN-700010'); await settle();
    const b = await page.locator(tid('settlement-row')).count();
    expect(b === 1, `by transaction: ${b}`);
    await page.fill(tid('search'), 'John Smith'); await settle();
    const c = await page.locator(tid('settlement-row')).count();
    const viaC = await T(`${tid('settlement-row')} .fk-li-s`);
    expect(c >= 1 && /customer/i.test(viaC), `by customer: ${c} "${viaC}"`);
    await page.fill(tid('search'), 'zzzz-no-such'); await settle();
    expect(/No .*match/i.test(await T(tid('records'))), 'empty search state');
    await page.click(tid('reset-filters')); await settle();
    return `id 1 · txn ${b} · customer ${c} ("${viaC.trim()}")`;
  });
  await step('settlements: settlement detail — amounts, related transactions with their own pages, detail export', async () => {
    await page.click(tid('preset-year')); await settle();
    await page.locator(`${tid('settlement-row')} .fk-btn`).first().click(); await page.waitForSelector(`${tid('settlement-detail')} ${tid('tx-table')}`);
    const head = await T(tid('settlement-detail'));
    expect(/Gross/.test(head) && /Expected/i.test(head), 'amounts');
    const rows = await page.locator(`${tid('tx-table')} tbody tr`).count();
    const a0 = await audit0();
    const f = await download(() => page.click(tid('export-detail')));
    const csv = f.body.toString('utf8');
    expect(/^﻿?.*Settlement/m.test(csv) && csv.split('\n').length > 3, 'detail csv');
    const au = await auditSince(a0);
    expect(au.some((e) => /export/i.test(e.action ?? e.actionType ?? '')), 'detail export audited');
    await page.click(`${tid('settlement-detail')} .fk-btn.primary`);
    return `${rows} transactions on the first page · ${f.name} ${csv.length} bytes · audited`;
  });
  await step('settlements: Export Report = the filtered set, audited', async () => {
    const a0 = await audit0();
    const f = await download(() => page.click(tid('export')));
    const lines = f.body.toString('utf8').trim().split('\n');
    const y = await API('/pos/payments/settlements/summary?preset=year&dateField=settlement_date');
    const dataRows = lines.filter((l) => /^"?CP-/.test(l)).length;
    expect(dataRows === y.kpis.settlements, `csv rows ${dataRows} vs ${y.kpis.settlements}`);
    expect((await auditSince(a0)).some((e) => /export/i.test(e.action ?? e.actionType ?? '')), 'export audited');
    return `${f.name}: ${dataRows} batches`;
  });
  await step('settlements: Refunds tab — its own pages, status filter, refund detail is view-only', async () => {
    await page.click(tid('tab-refunds')); await settle();
    const all = await page.locator(tid('refund-row')).count();
    await page.selectOption(tid('status'), 'failed'); await settle();
    const chips = await page.locator(`${tid('refund-row')} .fk-chip`).allInnerTexts();
    expect(chips.length > 0 && chips.every((c) => /Failed/i.test(c)), `failed filter: ${chips.join(',')}`);
    await page.locator(`${tid('refund-row')} .fk-li-t`).first().click(); await page.waitForSelector(tid('refund-detail'));
    const d = await T(tid('refund-detail'));
    expect(/not counted/i.test(d), 'failed refund flagged as not counted in the total');
    expect(await page.locator(`${tid('refund-detail')} button:has-text("Refund")`).count() === 0, 'a refund action exists on a view-only page');
    await page.click(`${tid('refund-detail')} .fk-btn.primary`);
    await page.click(tid('reset-filters')); await settle();
    return `${all} refunds on page 1 · failed only: ${chips.length}`;
  });
  await step('settlements: a new batch arriving — first on Page 1 when it qualifies, a note when it is filtered out', async () => {
    await page.click(tid('tab-settlements')); await page.click(tid('preset-month')); await settle();
    const nw = await J('/__newSettlement?n=901');
    await page.click(tid('refresh')); await settle(); await page.waitForTimeout(400);
    const first = await T(`${tid('settlement-row')} .fk-li-t`);
    expect(first === nw.ref, `first row ${first}`);
    const hl = await page.locator(`${tid('settlement-row')}.fn-new`).count();
    await page.selectOption(tid('status'), 'p:failed'); await settle();
    await J('/__newSettlement?n=902');
    await page.click(tid('refresh')); await settle(); await page.waitForTimeout(400);
    const note = await page.locator(tid('note')).innerText().catch(() => '');
    expect(/outside|filter/i.test(note), `note "${note}"`);
    await page.locator(`${tid('note')} button:has-text("Clear filters")`).click(); await settle();
    return `${nw.ref} first (highlighted ${hl}) · filtered-out note: "${note.split('\n')[0]}"`;
  });

  // ══ AI Deposit Reconciliation ═══════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/deposit-reconciliation');
  await step('recon: five KPIs are server aggregates; Net Difference counts due payouts only', async () => {
    const k = await API('/pos/deposit-reconciliation/workspace/kpis?preset=month&dateField=settlement');
    expect(cents(await T(`${tid('kpi-expected')} .fk-kpi-v`)) === k.kpis.expectedDepositsCents, 'expected');
    expect(cents(await T(`${tid('kpi-matched')} .fk-kpi-v`)) === k.kpis.matchedCents, 'matched');
    expect(cents(await T(`${tid('kpi-settlements')} .fk-kpi-v`)) === k.kpis.settlements, 'settlements');
    expect(cents(await T(`${tid('kpi-missing')} .fk-kpi-v`)) === k.kpis.missingDeposits, 'missing');
    expect(k.kpis.netDifferenceCents === k.kpis.netDifference.dueMatchedCents - k.kpis.netDifference.dueExpectedCents, 'difference arithmetic');
    await page.click(tid('kpi-difference')); const note = await T(tid('note'));
    expect(/not yet due/i.test(note), `explanation "${note.slice(0, 80)}"`);
    await noInvalid();
    return `expected ${k.kpis.expectedDepositsCents} · matched ${k.kpis.matchedCents} · missing ${k.kpis.missingDeposits} · diff ${k.kpis.netDifferenceCents}`;
  });
  await step('recon: universal search finds the $1,000 Sep 16 credit and opens it', async () => {
    await page.fill(tid('search'), 'ACH CREDIT'); await settle();
    await page.waitForSelector(`${tid('search-results')} .fn-usearch-item`);
    const first = await T(`${tid('search-results')} .fn-usearch-item`);
    expect(/1,000\.00/.test(first), `result "${first}"`);
    await page.locator(`${tid('search-results')} .fn-usearch-item`).first().click(); await page.waitForSelector(tid('deposit-view'));
    const d = await T(tid('deposit-view'));
    expect(/Sep 16, 2026/.test(d), 'posted date');
    await page.locator(`${tid('deposit-view')} .fk-btn:has-text("Close")`).click();
    await page.fill(tid('search'), ''); await settle();
    return first.replace(/\s+/g, ' ');
  });
  // an overdue batch (no deposit yet) to reconcile by hand
  const overdue = (await API('/pos/deposit-reconciliation/workspace/settlements?preset=custom&from=2021-01-01&to=2030-12-31&status=overdue&page=1&pageSize=10')).items;
  const od1 = overdue[0], od2 = overdue[1];
  const DEP_REF = `CARDPOINTE ${od1?.settlementRef}`;
  await step('recon: Record a Deposit — a record only; it lands in Unmatched Deposits; audited', async () => {
    expect(od1 && od2, 'need two overdue batches in the seed');
    const before = (await SQL('deposits'))[0].n; const a0 = await audit0();
    await page.click(tid('record-deposit')); await page.waitForSelector(tid('record-dialog'));
    await page.fill(tid('dep-amount'), (od1.expectedNetCents / 100).toFixed(2));
    await page.fill(tid('dep-reference'), DEP_REF);
    await page.click(tid('save-deposit')); await settle();
    const note = await T(tid('note'));
    expect(/recorded/i.test(note), `note "${note}"`);
    expect((await SQL('deposits'))[0].n === before + 1, 'deposit row');
    expect((await auditSince(a0)).some((e) => /deposit/i.test(e.action ?? '')), 'audited');
    const list = await T(tid('unmatched-deposits'));
    expect(list.includes(DEP_REF), 'in Unmatched Deposits');
    return `${(od1.expectedNetCents / 100).toFixed(2)} · ${DEP_REF}`;
  });
  await step('recon: a duplicate reference is caught before it is saved', async () => {
    const before = (await SQL('deposits'))[0].n;
    await page.click(tid('record-deposit')); await page.waitForSelector(tid('record-dialog'));
    await page.fill(tid('dep-amount'), '12.34'); await page.fill(tid('dep-reference'), DEP_REF);
    await page.click(tid('save-deposit')); await page.waitForSelector(tid('dep-confirm-duplicate'));
    const warn = await T(`${tid('record-dialog')} .fk-preview.bad`);
    expect((await SQL('deposits'))[0].n === before, 'saved anyway');
    await page.locator(`${tid('record-dialog')} .fk-btn:has-text("Cancel")`).click();
    return warn.split('\n')[0];
  });
  await step('recon: suggestion (exact reference, high) → person reviews → match; settlement becomes Matched', async () => {
    const before = (await SQL('allocations'))[0];
    const li = page.locator(`${tid('unmatched-list')} li`, { hasText: DEP_REF });
    await li.locator(tid('suggest')).click(); await page.waitForSelector(tid('suggestion'));
    const s0 = await T(tid('suggestion'));
    expect(/High/.test(s0) && s0.includes(od1.settlementRef), `suggestion "${s0}"`);
    expect((await SQL('allocations'))[0].n === before.n, 'a suggestion applied itself');
    await page.locator(`${tid('suggestion')} .fk-btn`).first().click(); await page.waitForSelector(tid('match-dialog'));
    expect(await page.locator(tid('confirm-match')).isDisabled(), 'confirm enabled before review');
    await page.check(tid('match-reviewed')); await page.click(tid('confirm-match')); await settle();
    const after = (await SQL('allocations'))[0];
    expect(after.n === before.n + 1 && after.s - before.s === od1.expectedNetCents, 'allocation');
    const st = await API(`/pos/deposit-reconciliation/workspace/settlements/${od1.id}`);
    expect(st.settlement.status === 'matched', `status ${st.settlement.status}`);
    return `${od1.settlementRef} matched ${od1.expectedNetCents} via ${st.allocations[0]?.evidence?.basis ?? st.allocations[0]?.source}`;
  });
  await step('recon: split payout — two deposits allocated to one settlement (partially matched → matched)', async () => {
    const half = Math.floor(od2.expectedNetCents / 2), rest = od2.expectedNetCents - half;
    for (const [amt, tag] of [[half, '1/2'], [rest, '2/2']]) {
      await page.click(tid('record-deposit')); await page.waitForSelector(tid('record-dialog'));
      await page.fill(tid('dep-amount'), (amt / 100).toFixed(2)); await page.fill(tid('dep-reference'), `E2E SPLIT ${od2.settlementRef} ${tag}`);
      await page.click(tid('save-deposit')); await settle();
    }
    await page.fill(tid('search'), od2.settlementRef); await settle();
    await page.locator(`${tid('search-results')} .fn-usearch-item`).first().click(); await page.waitForSelector(tid('settlement-review'));
    let st;
    for (const tag of ['1/2', '2/2']) {
      await page.click(tid('match-manually')); await page.waitForSelector(tid('match-dialog'));
      await page.fill(tid('match-find'), `E2E SPLIT ${od2.settlementRef} ${tag}`); await settle();
      await page.locator(tid('match-candidate')).first().click(); await page.waitForSelector(tid('match-amount'));
      await page.check(tid('match-reviewed')); await page.click(tid('confirm-match')); await settle();
      st = await API(`/pos/deposit-reconciliation/workspace/settlements/${od2.id}`);
      if (tag === '1/2') expect(st.settlement.status === 'partially_matched', `after 1/2: ${st.settlement.status}`);
      await page.fill(tid('search'), od2.settlementRef); await settle();
      await page.locator(`${tid('search-results')} .fn-usearch-item`).first().click(); await page.waitForSelector(tid('settlement-review'));
    }
    expect(st.settlement.status === 'matched' && st.allocations.filter((a) => a.active).length === 2, `final ${st.settlement.status}`);
    const rows = await page.locator(`${tid('allocations')} tbody tr`).count();
    return `${od2.settlementRef}: ${half} + ${rest} → matched · ${rows} allocations shown`;
  });
  await step('recon: unmatch needs a reason; the allocation is kept in history (never deleted)', async () => {
    const before = (await SQL('unmatched'))[0].n;
    await page.locator(tid('unmatch')).first().click();
    expect(await page.locator(tid('confirm-unmatch')).isDisabled(), 'confirm without a reason');
    await page.fill(tid('unmatch-reason'), 'E2E: wrong deposit chosen'); await page.click(tid('confirm-unmatch')); await settle();
    expect((await SQL('unmatched'))[0].n === before + 1, 'unmatch stamp');
    const st = await API(`/pos/deposit-reconciliation/workspace/settlements/${od2.id}`);
    expect(st.settlement.status === 'partially_matched' && st.allocations.length === 2, `status ${st.settlement.status}, history ${st.allocations.length}`);
    await page.locator(`${tid('settlement-review')} .fk-btn:has-text("Close")`).click(); await page.fill(tid('search'), ''); await settle();
    return `history keeps ${st.allocations.length} rows; status back to ${st.settlement.status}`;
  });
  await step('recon: bank accounts — add (last 4 only) and deactivate; a label, never a payout destination', async () => {
    await page.click(tid('add-account')); await page.waitForSelector(tid('account-dialog'));
    await page.fill(tid('acct-nickname'), 'E2E Reserve'); await page.fill(tid('acct-last4'), '12345678');
    expect((await page.inputValue(tid('acct-last4'))) === '1234', 'last4 accepted more than 4 digits');
    await page.click(tid('save-account')); await settle();
    let acc = await SQL('accounts');
    expect(acc.some((a) => a.nickname === 'E2E Reserve' && a.status === 'active'), 'added');
    await page.locator(`${tid('bank-accounts')} li`, { hasText: '1234' }).locator('button').click(); await page.waitForSelector(tid('account-dialog'));
    await page.locator(`${tid('account-dialog')} .fk-btn.danger`).first().click(); await page.click(tid('confirm-deactivate')); await settle();
    acc = await SQL('accounts');
    expect(acc.some((a) => a.nickname === 'E2E Reserve' && a.status !== 'active'), 'deactivated');
    return acc.map((a) => `${a.nickname}:${a.status}${a.is_default ? '*' : ''}`).join(' ');
  });
  await step('recon: Settlements → Deposits paging (newest created first)', async () => {
    await page.click(tid('preset-year')); await settle();
    const p1 = await page.locator(`${tid('s2d-row')} .fk-li-t`).allInnerTexts();
    await page.click(`${tid('settlements-deposits')} .fk-pbtn[aria-label="Page 2"]`); await settle();
    const p2 = await page.locator(`${tid('s2d-row')} .fk-li-t`).allInnerTexts();
    expect(p1.length && p2.length && !p2.includes(p1[0]), 'page 2');
    return `p1 starts ${p1[0]} · p2 starts ${p2[0]}`;
  });
  await step('recon: Exceptions — view evidence, Under Review, resolve with a reason (history recorded)', async () => {
    await page.click(tid('tab-exceptions')); await settle();
    await page.locator(`${tid('exceptions-table')} .fk-li-t`, { hasText: 'Missing deposit' }).click(); await page.waitForSelector(tid('exception-dialog'));
    await page.click(tid('mark-review')); await settle();
    await page.click(tid('resolve')); await page.fill(tid('resolve-reason'), 'E2E: deposit found in the savings account'); await page.click(tid('confirm-resolve')); await settle();
    const ex = (await SQL('exceptions')).find((e) => /Missing deposit/.test(e.title));
    expect(ex?.status === 'resolved' && /savings/.test(ex.resolution_note ?? ''), `case ${ex?.status}`);
    const au = (await J('/__audit')).filter((e) => e.resourceType === 'reconciliation_exception');
    expect(au.length >= 2, `audit ${au.length}`);
    await page.locator(`${tid('exception-dialog')} .fk-btn:has-text("Close")`).click();
    return `resolved · audited: ${au.map((e) => e.action).join(', ')} (the case history reads audit_logs; the harness audit is in memory)`;
  });
  await step('recon: Fees tab — per-batch fees, components "not supplied" when the processor does not send them', async () => {
    await page.click(tid('tab-fees')); await settle();
    const rows = await page.locator(`${tid('fees-table')} tbody tr`).count();
    const t = await T(tid('fees'));
    expect(rows > 0 && /Total fees/i.test(t), 'fees');
    return `${rows} rows on page 1`;
  });
  await step('recon: Reports — all nine open; CSV and PDF exports carry the totals and are audited', async () => {
    await page.click(tid('tab-reports')); await settle();
    const seen = [];
    for (const r of ['settlement_summary', 'matched_deposits', 'unmatched_deposits', 'missing_overdue', 'processing_fees', 'exceptions_aging', 'net_difference_trend', 'bank_accounts', 'processor_comparison']) {
      await page.click(tid('report-' + r)); await settle();
      const body = await T(tid('report'));
      expect(!/couldn.t load|unavailable/i.test(body), `report ${r} failed`);
      seen.push(`${r}:${await page.locator(`${tid('report-table')} tbody tr`).count()}`);
    }
    await page.click(tid('report-settlement_summary')); await settle();
    const a0 = await audit0();
    const csv = await download(() => page.click(tid('report-csv')));
    expect(/Total/i.test(csv.body.toString('utf8')), 'csv totals');
    const pdf = await download(() => page.click(tid('report-pdf')));
    expect(pdf.body.slice(0, 5).toString() === '%PDF-', 'pdf header');
    const text = pdfText(pdf.path);
    expect(/Settlement summary/i.test(text) && /Total/i.test(text), 'pdf text');
    expect((await auditSince(a0)).filter((e) => /export/i.test(e.action ?? '')).length >= 2, 'exports audited');
    return `${seen.join(' ')} · ${csv.name} · ${pdf.name} (${pdf.body.length} B)`;
  });
  await step('recon: server unavailable — an error state with Retry, never $0.00', async () => {
    await J('/__fail?on=1'); let k = '', cards = -1;
    try { await go('/tenant/payments/deposit-reconciliation'); k = await T(tid('kpis')); cards = await page.locator(`${tid('kpis')} .fk-kpi`).count(); }
    finally { await J('/__fail?on=0'); }
    expect(/could not be reached|unavailable/i.test(k) && cards === 0 && /Retry/.test(k), `kpis "${k}" cards ${cards}`);
    await page.locator(`${tid('kpis')} button:has-text("Retry")`).click(); await settle();
    expect(/\$/.test(await T(`${tid('kpi-expected')} .fk-kpi-v`)), 'retry recovers');
    return k.split('\n')[0];
  });

  // ══ Invoices ═════════════════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/payments/invoices');
  await step('invoices: KPIs are server aggregates with their scope written on them; no "Invalid Date"', async () => {
    const s = await API('/pos/invoices/summary?preset=all&dateField=issued');
    expect(cents(await T(`${tid('kpi-outstanding')} .fk-kpi-v`)) === s.kpis.outstandingCents, 'outstanding');
    expect(cents(await T(`${tid('kpi-paid')} .fk-kpi-v`)) === s.kpis.cashCollectedCents, 'collected');
    expect(cents(await T(`${tid('kpi-total')} .fk-kpi-v`)) === s.kpis.total, 'total');
    await noInvalid();
    return `outstanding ${s.kpis.outstandingCents} · collected ${s.kpis.cashCollectedCents} · ${s.kpis.total} invoices`;
  });
  await step('invoices: search — INV number, phone, email, name (server-side)', async () => {
    await page.fill(tid('search'), 'INV-0002'); await settle();
    const a = await page.locator(`${tid('invoice-row')} .fk-li-t`).allInnerTexts();
    expect(a[0] === 'INV-0002', `by number: ${a.join(',')}`);
    await page.fill(tid('search'), '555-1234'); await settle();
    const b = await page.locator(`${tid('invoice-row')} .iv-cust`).allInnerTexts();
    expect(b.length > 0 && b.every((x) => /John Smith/.test(x)), `by phone: ${b.join('|')}`);
    await page.fill(tid('search'), 'john.smith@example.com'); await settle();
    const c = await page.locator(tid('invoice-row')).count();
    await page.fill(tid('search'), 'Smith'); await settle();
    const d = await page.locator(tid('invoice-row')).count();
    await page.click(tid('clear-filters')); await settle();
    return `INV-0002 first · phone ${b.length} · email ${c} · name ${d}`;
  });
  await step('invoices: Custom Range on the issue date + amount range + chips', async () => {
    await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
    await page.click(`${tid('range-calendar')} [data-ymd="2026-10-01"]`); await page.click(`${tid('range-calendar')} [data-ymd="2026-10-29"]`).catch(async () => {
      await page.locator(`${tid('range-calendar')} [data-ymd="2026-10-29"]`).first().click(); });
    await page.click(tid('range-apply')); await settle();
    await page.fill(tid('amount-min'), '50'); await settle();
    const dates = await page.locator(`${tid('invoice-row')} td:nth-child(3)`).allInnerTexts();
    const totals = (await page.locator(`${tid('invoice-row')} td:nth-child(6)`).allInnerTexts()).map(cents);
    expect(dates.every((x) => /Oct/.test(x)) && totals.every((x) => x >= 5000), `rows ${dates.join(',')} ${totals.join(',')}`);
    const chipN = await page.locator(`${tid("invoices")} .fn-chips > .fk-chip`).count();
    await page.click(tid('clear-filters')); await settle();
    return `${dates.length} Oct invoices ≥ $50 · ${chipN} chips`;
  });
  let newNum = '';
  await step('invoices: New Invoice — a salon customer is required; saved draft is first on Page 1; audited', async () => {
    const a0 = await audit0(); const before = (await SQL('invoices'))[0].n;
    await page.click(tid('new-invoice')); await page.waitForSelector(tid('invoice-form'));
    await page.fill(tid('line-desc'), 'E2E gel manicure'); await page.fill(tid('line-price'), '45.00');
    expect(await page.locator(tid('save-draft')).isDisabled(), 'saved without a customer');
    await page.fill(tid('customer-find'), 'John Smith'); await page.waitForSelector(tid('customer-option'));
    await page.locator(tid('customer-option')).first().click();
    expect(/John Smith/.test(await T(tid('picked-customer'))), 'customer picked');
    expect(cents(await T(tid('form-total'))) === 4500, 'total');
    await page.click(tid('save-draft')); await page.waitForSelector(tid('invoice-detail')); await settle();
    const row = (await SQL('latestInvoice'))[0]; newNum = row.invoice_number;
    expect((await SQL('invoices'))[0].n === before + 1 && row.status === 'draft' && row.customer_id && row.bill_to_name === 'John Smith', 'db row');
    await page.locator(`${tid('invoice-detail')} .fk-btn:has-text("Back")`).click(); await settle();
    expect((await T(`${tid('invoice-row')} .fk-li-t`)) === newNum, 'first on page 1');
    expect((await auditSince(a0)).some((e) => /invoice/i.test(e.action ?? '')), 'audited');
    return `${newNum} draft for John Smith, $45.00`;
  });
  await step('invoices: Send → Sent (delivery not connected is stated); partial payment → Partially Paid; rest → Paid', async () => {
    await page.locator(`${tid('invoice-row')} .fk-li-t`).first().click(); await page.waitForSelector(tid('invoice-detail'));
    await page.click(tid('send')); await settle();
    expect((await SQL('latestInvoice'))[0].status === 'sent', 'sent');
    expect(/not connected|no message/i.test(await T(tid('invoice-detail')) + await T(tid('note'))), 'delivery note');
    await page.click(tid('record-payment')); await page.waitForSelector(tid('payment-dialog'));
    await page.fill(tid('pay-amount'), '50.00');
    expect(await page.locator(tid('confirm-payment')).isDisabled(), 'over-balance accepted');
    await page.fill(tid('pay-amount'), '20.00'); await page.click(tid('confirm-payment')); await page.waitForSelector(tid('invoice-detail')); await settle();
    expect((await SQL('latestInvoice'))[0].status === 'partially_paid' && cents(await T(tid('balance'))) === 2500, 'partial');
    await page.click(tid('record-payment')); await page.waitForSelector(tid('payment-dialog'));
    await page.selectOption(tid('pay-method'), 'check'); await page.click(tid('confirm-payment')); await page.waitForSelector(tid('invoice-detail')); await settle();
    expect((await SQL('latestInvoice'))[0].status === 'paid' && cents(await T(tid('balance'))) === 0, 'paid');
    const pays = await page.locator(`${tid('payments')} tr`).count();
    expect(await page.locator(tid('void')).count() === 0, 'void offered after money was received');
    return `${newNum}: sent → $20 partial → $25 by check → paid · ${pays} payments in history · void hidden`;
  });
  await step('invoices: PDF — preview in the page, download is an English invoice with the number', async () => {
    await page.click(tid('preview')); await page.waitForSelector(`${tid('pdf-preview')} iframe`);
    await page.locator(`${tid('pdf-preview')} .fk-btn.primary`).click(); await page.waitForSelector(tid('invoice-detail'));
    const f = await download(() => page.click(tid('download-pdf')));
    const text = pdfText(f.path);
    expect(f.body.slice(0, 5).toString() === '%PDF-' && text.includes(newNum) && /INVOICE/i.test(text) && /Balance due/i.test(text), 'pdf content');
    expect(!/[À-ỹ]/.test(text.replace(/Nguy|Trần|Lê|Phạm/g, '')), 'non-English text in the customer PDF');
    await page.locator(`${tid('invoice-detail')} .fk-btn:has-text("Back")`).click();
    return `${f.name} ${f.body.length} B: "${text.split('\n').find((l) => l.includes(newNum))?.trim()}"`;
  });
  await step('invoices: void a draft with a reason (kept in history); a reason is required', async () => {
    await page.selectOption(tid('status'), 'draft'); await settle();
    const num = await T(`${tid('invoice-row')} .fk-li-t`);
    await page.locator(`${tid('invoice-row')} .fk-li-t`).first().click(); await page.waitForSelector(tid('invoice-detail'));
    await page.click(tid('void')); await page.waitForSelector(tid('void-dialog'));
    expect(await page.locator(tid('confirm-void')).isDisabled(), 'void without a reason');
    await page.fill(tid('void-reason'), 'E2E: duplicate draft'); await page.click(tid('confirm-void')); await page.waitForSelector(tid('invoice-detail')); await settle();
    const d = await T(tid('invoice-detail'));
    expect(/Void/i.test(d) && /duplicate draft/.test(d), 'void reason shown');
    await page.locator(`${tid('invoice-detail')} .fk-btn:has-text("Back")`).click(); await page.click(tid('clear-filters')); await settle();
    return `${num} voided`;
  });
  await step('invoices: INV-0002 (no customer) — says so, a manager links a salon customer (never guessed by name)', async () => {
    await page.fill(tid('search'), 'INV-0002'); await settle();
    expect(/no customer|unlinked/i.test(await T(`${tid('invoice-row')} .iv-cust`)), 'unlinked shown');
    await page.locator(`${tid('invoice-row')} .fk-li-t`).first().click(); await page.waitForSelector(tid('invoice-detail'));
    await page.click(tid('link-customer')); await page.waitForSelector(tid('link-dialog'));
    await page.fill(tid('link-find'), '555-1234'); await page.waitForSelector(tid('link-option'));
    await page.locator(tid('link-option')).first().click(); await page.click(tid('confirm-link')); await page.waitForSelector(tid('invoice-detail')); await settle();
    const r = (await SQL('inv0002'))[0];
    expect(r.customer_id && /John Smith/.test(await T(tid('invoice-detail'))), 'linked');
    await page.locator(`${tid('invoice-detail')} .fk-btn:has-text("Back")`).click(); await page.click(tid('clear-filters')); await settle();
    return `INV-0002 → ${r.bill_to_name ?? 'John Smith'} (${r.status})`;
  });
  await step('invoices: export CSV = the filtered set, audited', async () => {
    const a0 = await audit0();
    const f = await download(() => page.click(tid('export')));
    const s = await API('/pos/invoices/summary?preset=all&dateField=issued');
    const rows = f.body.toString('utf8').split('\n').filter((l) => /^"?INV-/.test(l)).length;
    expect(rows === s.kpis.total, `csv ${rows} vs ${s.kpis.total}`);
    expect((await auditSince(a0)).some((e) => /export/i.test(e.action ?? '')), 'audited');
    return `${rows} invoices`;
  });

  // ══ Roles ════════════════════════════════════════════════════════════════════════════════════════════════════════
  await J('/__role?r=FRONT_DESK');
  await step('front desk: Invoices — can create and record a payment; no export, edit, link or void', async () => {
    await go('/tenant/payments/invoices');
    expect(await page.locator(tid('new-invoice')).count() === 1 && await page.locator(tid('export')).count() === 0, 'header actions');
    await page.selectOption(tid('status'), 'sent'); await settle();
    await page.locator(`${tid('invoice-row')} .fk-li-t`).first().click(); await page.waitForSelector(tid('invoice-detail')); await settle();
    const can = { pay: await page.locator(tid('record-payment')).count(), void: await page.locator(tid('void')).count(), link: await page.locator(tid('link-customer')).count(), edit: await page.locator(tid('edit')).count() };
    expect(can.pay === 1 && can.void === 0 && can.link === 0 && can.edit === 0, JSON.stringify(can));
    const r = await fetch(BASE + '/api/v1/pos/invoices/export?preset=all'); expect(r.status === 403, `export API ${r.status}`);
    return JSON.stringify(can) + ' · export API 403';
  });
  await step('front desk: Settlements and Reconciliation show an access message, not data', async () => {
    await go('/tenant/payments/settlements');
    const s = await T(tid('kpis'));
    expect(/permission|access/i.test(s) && !/\$\d/.test(s), `settlements "${s}"`);
    await go('/tenant/payments/deposit-reconciliation');
    const r = await T(tid('kpis'));
    expect(/permission|access/i.test(r) && !/\$\d/.test(r), `recon "${r}"`);
    expect(await page.locator(tid('record-deposit')).count() === 0, 'record deposit offered');
    return 'both pages: access message';
  });
  await J('/__role?r=MANAGER');
  await step('manager: reconciliation can match and record, but cannot unmatch or resolve (owner approval)', async () => {
    await go('/tenant/payments/deposit-reconciliation');
    expect(await page.locator(tid('record-deposit')).count() === 1, 'record deposit');
    await page.fill(tid('search'), od1.settlementRef); await settle();
    await page.locator(`${tid('search-results')} .fn-usearch-item`).first().click(); await page.waitForSelector(tid('settlement-review')); await settle();
    expect(await page.locator(tid('unmatch')).count() === 0, 'unmatch offered to a manager');
    const r = await fetch(BASE + '/api/v1/pos/deposit-reconciliation/workspace/bank-accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: 'x1', accountType: 'checking' }) });
    expect(r.status === 403, `bank account API ${r.status}`);
    return 'no Unmatch · bank-account API 403';
  });
  await J('/__role?r=OWNER');
  await step('empty salon: empty states, no fake $0 rows, no errors', async () => {
    await J('/__tenant?name=empty');
    await go('/tenant/payments/settlements'); const a = await T(tid('records'));
    await go('/tenant/payments/deposit-reconciliation'); const b = await T(tid('settlements-deposits'));
    await go('/tenant/payments/invoices'); const c = await T(tid('invoices'));
    await J('/__tenant?name=pilot');
    expect(/No /.test(a) && /No /.test(b) && /No /.test(c), 'empty texts');
    return [a, b, c].map((x) => x.split('\n').find((l) => /^No /.test(l))).join(' | ');
  });
  await step('no page errors across the run', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); return 'none'; });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []);
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · unhandled ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
async function audit0() { return (await J('/__audit')).length; }
