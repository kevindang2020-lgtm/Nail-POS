// interact.mjs — Payment Terminals + Gift Cards one-screen E2E (Oct 29 2026). The REAL POS bundle in Chromium against
// live-server.mjs (real read models + the real gift-card writer on a seeded TEST database). Each step clicks what a salon
// user clicks and checks the answer on screen AND in the database. Nothing leaves the machine: no processor, no terminal,
// no phone, no messenger behind the harness; no card is charged. (Terminal / phone / routing mutations are the harness's
// SIMULATED row changes — see live-server.mjs.) Writes results/<label>/e2e.json and one screenshot per step.
//   node tooling/devices-giftcards-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = 4340, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p) => J('/api/v1' + p);
const SQL = async (k, a = '') => J('/__sql?k=' + k + (a ? '&a=' + encodeURIComponent(a) : ''));
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
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); }
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const T = (sel) => page.locator(sel).first().innerText();
const num = (s) => Number(String(s).replace(/[^\d-]/g, ''));
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(450); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit', { timeout: 20000 }); await settle(); };
const tid = (t) => `[data-testid="${t}"]`;
const noJunk = async () => { const body = await page.locator('body').innerText(); expect(!/Invalid Date|NaN|undefined|\[object Object\]/.test(body), 'page shows Invalid Date / NaN / undefined'); expect(!/\b\d{16}\b/.test(body.replace(/\s/g, ' ')), 'a full 16-digit number is on the page'); };
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };

try {
  // ══ Payment Terminals ══════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/devices/payment-terminals');
  const s0 = await API('/pos/devices/payment-terminals/summary');
  await step('terminals: the four physical KPIs are the server counts; Tap to Pay is counted apart', async () => {
    expect(num(await T(`${tid('kpi-physical')} .fk-kpi-v`)) === s0.physical.total, 'physical');
    expect(num(await T(`${tid('kpi-online')} .fk-kpi-v`)) === s0.physical.online, 'online');
    expect(num(await T(`${tid('kpi-attention')} .fk-kpi-v`)) === s0.physical.needsAttention, 'attention');
    expect(num(await T(`${tid('kpi-disabled')} .fk-kpi-v`)) === s0.physical.disabled, 'disabled');
    expect((await T(tid('tab-phones'))).includes(`${s0.tapToPay.active}/${s0.tapToPay.total}`), 'phones counted on their tab');
    await noJunk();
    return `physical ${s0.physical.total} · online ${s0.physical.online} · attention ${s0.physical.needsAttention} (${await T(`${tid('kpi-attention')} .fk-kpi-s`)}) · phones ${s0.tapToPay.active}/${s0.tapToPay.total}`;
  });
  await step('terminals: every terminal the KPIs count is listed — incl. the no-location reader the old list hid', async () => {
    const rows = await page.locator(tid('terminal-row')).count();
    expect(rows === s0.physical.total, `rows ${rows} vs KPI ${s0.physical.total}`);
    expect((await T(tid('physical-table'))).includes('Spare Reader'), 'no-location terminal');
    const first = await page.locator(tid('terminal-row')).first().innerText();
    expect(/Pedicure Lounge Mini/.test(first), 'newest paired first');
    expect(!/Online/.test(first) && /Not verified/.test(first), 'never-tested terminal is not Online');
    return `${rows} rows · first: ${first.split('\n')[0]}`;
  });
  await step('terminals: search by serial, then status filter "Needs attention" — server answers, Clear filters resets', async () => {
    await page.fill(tid('search'), 'C043UQ00002'); await settle();
    expect(await page.locator(tid('terminal-row')).count() === 1 && (await T(tid('physical-table'))).includes('Back Bar Flex'), 'serial search');
    await page.fill(tid('search'), ''); await page.selectOption(tid('status'), 'attention'); await settle();
    const c = await page.locator(tid('terminal-row')).count(); expect(c === s0.physical.needsAttention, `attention rows ${c}`);
    await page.fill(tid('search'), 'zzzz-no-match'); await settle();
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle();
    expect(await page.locator(tid('terminal-row')).count() === s0.physical.total, 'cleared');
    return `serial → 1 · attention → ${c} · cleared → ${s0.physical.total}`;
  });
  await step('terminals: details explain why (troubleshooting), Test Connection reports the answer without charging', async () => {
    await page.getByRole('button', { name: 'Back Bar Flex' }).click(); await page.waitForSelector(tid('terminal-dialog')); await settle();
    const why = await T(tid('troubleshoot')); expect(/Offline/.test(why), 'reason shown');
    await page.click(tid('test-connection')); await page.waitForSelector(tid('terminal-msg')); const msg = await T(tid('terminal-msg'));
    const row = (await SQL('terminals')).find((t) => t.id === 'term_cp_00002'); expect(row.last_ping_ok === false, 'ping recorded');
    await close(); return `${why.split('\n')[0]} · test: ${msg.slice(0, 80)}`;
  });
  await step('terminals: disable asks for a reason inline, is audited, and moves the KPI', async () => {
    await page.getByRole('button', { name: 'Spare Reader' }).click(); await page.waitForSelector(tid('terminal-dialog')); await settle();
    await page.click(tid('disable')); expect(await page.locator(tid('ask-confirm')).isDisabled(), 'confirm needs a reason');
    await page.fill(tid('ask-input'), 'Reader moved to storage'); await page.click(tid('ask-confirm')); await settle();
    await close(); await settle();
    const s1 = await API('/pos/devices/payment-terminals/summary');
    expect(s1.physical.disabled === s0.physical.disabled + 1, 'disabled +1');
    expect(num(await T(`${tid('kpi-disabled')} .fk-kpi-v`)) === s1.physical.disabled, 'KPI updated');
    const a = (await SQL('settingsAudit'))[0]; expect(a.action_type === 'pos_settings_terminal_disabled', 'audit row');
    return `disabled ${s0.physical.disabled} → ${s1.physical.disabled} · audit ${a.action_type}`;
  });
  await step('terminals: Pair Terminal wizard (model → identify → register → verify) — the new reader lands on Page 1, unverified', async () => {
    await page.click(tid('pair-terminal')); await page.waitForSelector(tid('pair-dialog'));
    await page.selectOption(tid('pair-model'), 'clover_flex'); await page.fill(tid('pair-label'), 'Nail Bar Flex'); await page.click(tid('pair-next'));
    expect(await page.locator(tid('pair-next')).isDisabled(), 'needs a 6-digit code');
    await page.fill(tid('pair-code'), '482913'); await page.fill(tid('pair-hsn'), 'C043UQ77777'); await page.click(tid('pair-next'));
    await page.selectOption(tid('pair-register'), { label: 'Front Desk' }); await settle();
    const warn = await page.locator(`${tid('pair-dialog')} .fk-preview.bad`).count(); expect(warn === 1, 'register already served is flagged');
    await page.click(tid('pair-submit')); await page.waitForSelector(`${tid('pair-verify')} .fk-preview`); const v = await T(tid('pair-verify'));
    await page.click(tid('pair-done')); await settle();
    const first = await page.locator(tid('terminal-row')).first().innerText(); expect(/Nail Bar Flex/.test(first), 'top of page 1');
    expect(!/\bOnline\b/.test(first) && /(Not verified|Offline)/.test(first), 'an unverified reader is never Online');
    const note = await T(tid('note'));
    return `verify: ${v.split('\n')[0]} · first row: ${first.split('\n')[0]} · note: ${note.slice(0, 70)}`;
  });
  await step('tap to pay: revoked phones are listed apart from active ones; revoke needs a reason and is final', async () => {
    await page.click(tid('tab-phones')); await settle();
    const rows = await page.locator(tid('phone-row')).count(); expect(rows === s0.tapToPay.total, `rows ${rows}`);
    await page.getByRole('button', { name: 'Kim iPhone 15' }).click(); await page.waitForSelector(tid('phone-dialog')); await settle();
    await page.click(tid('revoke')); await page.waitForSelector(tid('revoke-dialog'));
    expect(await page.locator(tid('confirm-revoke')).isDisabled(), 'reason required');
    await page.fill(tid('revoke-reason'), 'Phone replaced'); await page.click(tid('confirm-revoke')); await settle();
    const ph = (await SQL('phones')).find((p) => p.device_id === 'iphone-reg-0001'); expect(ph.status === 'revoked' && ph.revoke_reason === 'Phone replaced', 'revoked in db');
    expect(await page.locator(tid('revoke')).count() === 0, 'no revoke offered on a revoked phone');
    const r = await fetch(BASE + '/api/v1/mobile-checkout/devices/iphone-reg-0001/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status === 409, `re-approve answered ${r.status}`);
    await close(); return `${rows} phones · iphone-reg-0001 revoked · re-approve → 409 (never auto-reactivated)`;
  });
  await step('payment activity: payment → ticket → device → customer; a payment with no device says "Not linked"', async () => {
    await page.click(tid('tab-activity')); await settle();
    await page.selectOption(tid('activity-device'), 'unlinked'); await settle();
    const t = await T(tid('activity-table')); expect(/Not linked/.test(t), 'not linked shown');
    await page.selectOption(tid('activity-device'), ''); await page.fill(tid('search'), 'RR701998'); await settle();
    await page.locator(tid('activity-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('payment-dialog'));
    const d = await T(tid('payment-dialog')); expect(/Front Desk Clover/.test(d) && /#1054/.test(d), 'device + ticket in the trace');
    const s2 = await API('/pos/devices/payment-terminals/summary'); expect(s2.physical.total === s0.physical.total + 1, 'date filter never moved the live counts');
    await close(); await page.fill(tid('search'), ''); return d.split('\n').slice(0, 6).join(' · ').slice(0, 220);
  });
  await step('routing: Terminal-Driven ↔ Front Desk Manual is confirmed, saved, audited, and shows who changed it', async () => {
    await page.click(tid('tab-routing')); await settle();
    await page.locator(`${tid('mode-front_desk')} input`).check(); await page.click(tid('save-routing'));
    expect(await page.locator(tid('confirm-routing')).count() === 1, 'confirm first'); await page.click(tid('confirm-routing')); await settle();
    const m = (await SQL('routing'))[0].mode; expect(m === 'front_desk', `mode ${m}`);
    const t = await T(tid('routing-mode')); expect(/Linh Owner/.test(t), 'last change actor');
    return `mode → ${m} · ${t.split('\n').find((l) => /Last changed/.test(l))}`;
  });
  await J('/__role?r=TECHNICIAN');
  await step('technician: no pair / routing / revoke controls; the API refuses the change', async () => {
    await go('/tenant/devices/payment-terminals');
    const pair = await page.locator(tid('pair-terminal')).count();
    const r = await fetch(BASE + '/api/v1/pos/settings/payments-checkout', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerDisplayCaptureMode: 'terminal' }) });
    expect(pair === 0 && r.status === 403, `pair ${pair} · api ${r.status}`); return `pair button ${pair} · routing PATCH ${r.status}`;
  });
  await J('/__role?r=OWNER');

  // ══ Gift Cards ═════════════════════════════════════════════════════════════════════════════════════════════════
  await go('/tenant/customers/gift-cards');
  const g0 = await API('/pos/gift-cards/summary?preset=all&dateField=issued');
  await step('gift cards: five KPIs are the server aggregates over every card; liability = the ledger-backed balances', async () => {
    expect(num(await T(`${tid('kpi-liability')} .fk-kpi-v`)) === g0.kpis.outstandingLiabilityCents, 'liability');
    expect(num(await T(`${tid('kpi-active')} .fk-kpi-v`)) === g0.kpis.activeCards, 'active');
    expect(num(await T(`${tid('kpi-issued')} .fk-kpi-v`)) === g0.kpis.totalIssuedCents, 'issued');
    expect(num(await T(`${tid('kpi-redeemed')} .fk-kpi-v`)) === g0.kpis.redeemedValueCents, 'redeemed');
    expect(num(await T(`${tid('kpi-total')} .fk-kpi-v`)) === g0.kpis.totalCards, 'total');
    const db = (await SQL('liability'))[0].s; expect(db === g0.kpis.outstandingLiabilityCents, `db liability ${db}`);
    await noJunk(); return `liability ${g0.kpis.outstandingLiabilityCents} (db ${db}) · active ${g0.kpis.activeCards} · issued ${g0.kpis.totalIssuedCents} · redeemed ${g0.kpis.redeemedValueCents} · total ${g0.kpis.totalCards}`;
  });
  await step('gift cards: only masked identifiers; the list pages on the server, newest issued first', async () => {
    const rows = page.locator(tid('card-row')); const c = await rows.count(); expect(c > 3, `rows ${c}`);
    const t = await T(tid('cards-table')); expect(/•••• \d{4}/.test(t), 'masked'); expect(!/GC-[A-Z0-9]{8,}/.test(t), 'no raw code');
    const pager = await page.locator(`${tid('cards')} .fk-pager`).innerText(); return `${c} rows on page 1 · pager "${pager.replace(/\s+/g, ' ').slice(0, 60)}"`;
  });
  await step('gift cards: universal search — recipient phone in any format finds Mai Tran\'s card (purchaser John Smith)', async () => {
    await page.fill(tid('search'), '856.555.9876'); await settle();
    const t = await T(tid('cards-table')); expect(/Mai Tran/.test(t) && /John Smith/.test(t), 'found'); expect(await page.locator(tid('card-row')).count() === 1, 'one card');
    expect(/matched recipient/.test(t), 'match reason');
    return t.split('\n').slice(1, 3).join(' · ');
  });
  await step('gift cards: the detail ledger shows the worked example — $100 issued, $65 redeemed, $35 left', async () => {
    await page.locator(tid('card-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('ledger-table')); await settle();
    const bal = await T(tid('detail-balance')); expect(/\$35\.00/.test(bal), 'balance');
    const l = await T(tid('ledger-table')); expect(/−\$65\.00/.test(l) && /\+\$100\.00/.test(l) && /Redeemed/.test(l) && /Activated/.test(l), 'ledger rows');
    expect(await page.locator(tid('not-reconciled')).count() === 0, 'ledger reconciles');
    return bal.replace(/\s+/g, ' ');
  });
  await close(); await page.fill(tid('search'), ''); await settle();
  await step('gift cards: status tab Void + date field filter show chips; Clear All resets', async () => {
    await page.click(tid('tab-void')); await settle();
    const c = await page.locator(tid('card-row')).count(); expect(c === g0.kpis.closedCards, `void rows ${c}`);
    expect((await T(tid('chips'))).includes('Void'), 'chip');
    await page.click(tid('clear-all')); await settle(); expect(await page.locator(tid('chips')).count() === 0, 'cleared');
    return `void ${c} · cleared`;
  });
  let issued = null;
  await J('/__role?r=FRONT_DESK');
  await step('issue: payment-first — purchaser required, amount within limits, a double tap makes ONE card, number shown once', async () => {
    await go('/tenant/customers/gift-cards'); const before = (await SQL('cards'))[0].n;
    await page.click(tid('issue')); await page.waitForSelector(tid('issue-dialog')); await settle();
    await page.fill(tid('issue-amount'), '600'); expect(await page.locator(tid('issue-submit')).isDisabled(), 'over max / no purchaser blocked');
    await page.fill(tid('issue-amount'), '100');
    await page.fill(tid('customer-search'), 'John Sm'); await page.locator('.gc-hits button').first().click();
    await page.check(tid('is-gift')); await page.fill(tid('recipient-name'), 'Mai Tran');
    await page.locator(tid('issue-submit')).dblclick(); await page.waitForSelector(tid('issue-done'));
    const once = await T(tid('card-number-once')); const after = await SQL('cards'); const latest = (await SQL('latestCard'))[0];
    expect(after[0].n === before + 1, `cards ${before} → ${after[0].n}`); expect(latest.status === 'pending_payment' && latest.balance_cents === 0 || latest.status === 'pending_payment', 'pending, no value yet');
    expect(latest.recipient === 'Mai Tran', 'recipient kept apart from the purchaser');
    issued = latest; await page.click(tid('go-checkout')); await page.waitForURL(/\/checkout\?ticket=/);
    return `one card (${before} → ${after[0].n}) · pending_payment · number shown once (…${once.replace(/\D/g, '').slice(-4)}) · → ${new URL(page.url()).pathname}${new URL(page.url()).search.slice(0, 20)}…`;
  });
  await step('issue: unpaid card carries no liability; after Checkout takes the payment it is Active on Page 1 with its ledger', async () => {
    const l0 = (await SQL('liability'))[0].s; expect(l0 === g0.kpis.outstandingLiabilityCents, 'unpaid adds nothing');
    await J('/__pay?ticket=' + issued.sale_ticket_id);
    await go('/tenant/customers/gift-cards');
    const first = await page.locator(tid('card-row')).first().innerText(); expect(/Mai Tran/.test(first) && /Active/.test(first) && /\$100\.00/.test(first), `first row: ${first}`);
    const l1 = (await SQL('liability'))[0].s; expect(l1 === l0 + 10000, 'liability +$100');
    const tx = await SQL('cardTx', issued.id); expect(tx.length === 1 && tx[0].type === 'activate', 'one activate row');
    return `liability ${l0} → ${l1} · ledger ${tx.map((t) => t.type).join(',')}`;
  });
  await step('check balance: the protected lookup answers masked for the exact number only', async () => {
    await page.click(tid('check-balance')); await page.waitForSelector(tid('balance-dialog'));
    await page.fill(tid('balance-input'), '6000-0000-0000'); await page.click(tid('balance-submit')); await settle();
    expect(await page.locator(tid('balance-notfound')).count() === 1, 'partial number refused');
    await close(); return 'partial number → "No card matches"';
  });
  await step('front desk cannot void (no button, API 403)', async () => {
    await page.locator(tid('card-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('detail-dialog')); await settle();
    const v = await page.locator(tid('void')).count();
    const r = await fetch(`${BASE}/api/v1/pos/checkout/gift-cards/${issued.id}/void-card`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'try' }) });
    await close(); expect(v === 0 && r.status === 403, `void button ${v} · api ${r.status}`); return `void button ${v} · API ${r.status}`;
  });
  await J('/__role?r=MANAGER');
  await step('manager: reload opens its own ticket (value only after payment); void needs a reason, keeps history, zeroes the balance', async () => {
    await go('/tenant/customers/gift-cards');
    await page.locator(tid('card-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('detail-dialog')); await settle();
    await page.click(tid('reload')); await page.fill(tid('reload-amount'), '25'); await page.click(tid('reload-submit')); await page.waitForURL(/\/checkout\?ticket=/);
    const afterReload = await SQL('card', issued.id); expect(afterReload[0].balance_cents === 10000, 'reload adds nothing until paid');
    await go('/tenant/customers/gift-cards');
    await page.locator(tid('card-row')).first().getByRole('button', { name: 'View' }).click(); await page.waitForSelector(tid('detail-dialog')); await settle();
    await page.click(tid('void')); expect(await page.locator(tid('void-submit')).isDisabled(), 'reason required');
    await page.fill(tid('void-reason'), 'Customer changed their mind'); await page.click(tid('void-submit')); await settle();
    const c = (await SQL('card', issued.id))[0]; expect(c.status === 'void' && c.balance_cents === 0 && c.void_reason === 'Customer changed their mind', 'voided');
    const tx = await SQL('cardTx', issued.id); expect(tx.some((t) => t.type === 'activate') && tx.some((t) => t.type === 'adjust' && t.amount_cents === -10000), 'history kept + compensating entry');
    await close(); return `ledger ${tx.map((t) => `${t.type}:${t.amount_cents}`).join(' ')}`;
  });
  await J('/__role?r=OWNER');
  await step('empty salon: honest empty states for both screens, no fake $0 rows, no errors', async () => {
    await J('/__tenant?name=empty');
    await go('/tenant/devices/payment-terminals'); const a = await T(tid('physical'));
    await go('/tenant/customers/gift-cards'); const b = await T(tid('cards'));
    await J('/__tenant?name=pilot');
    expect(/No physical terminals/.test(a) && /No gift cards/.test(b), 'empty texts'); return `${a.split('\n').find((l) => /^No /.test(l))} | ${b.split('\n').find((l) => /^No /.test(l))}`;
  });
  await step('vietnamese: both screens switch language without losing state', async () => {
    await J('/__lang?l=vi'); await go('/tenant/customers/gift-cards'); const h = await T(tid('kpi-liability'));
    await go('/tenant/devices/payment-terminals'); const k = await T(tid('kpi-attention'));
    await J('/__lang?l=en'); expect(/số dư còn nợ/i.test(h) && /cần xử lý/i.test(k), `vi: ${h} / ${k}`); return `${h.split('\n')[0]} · ${k.split('\n')[0]}`;
  });
  await step('no page errors across the run', async () => { expect(errors.length === 0, errors.slice(0, 3).join(' | ')); return 'none'; });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []); const log = await J('/__log').catch(() => []);
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled, simulated: log.filter((l) => l.startsWith('SIMULATED')) }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · unhandled ${JSON.stringify(unhandled)}`);
  await browser.close(); srv.kill();
}
