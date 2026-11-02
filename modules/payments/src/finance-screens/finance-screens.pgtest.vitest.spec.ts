// finance-screens.pgtest — Deposits & Settlements + AI Deposit Reconciliation mandates (Oct 29 2026), against the REAL schema.
//   Settlements: KPIs are server aggregates over the filtered set (unique batches, processor gross / fees, provider net payout
//   — never "deposited"), refunds counted once by refund date and only COMPLETED refunds added to the money; the
//   reconciliation strip never subtracts a refund the provider already netted; search ranks exact ids first and reaches a
//   customer ONLY through a payment in the batch; numbered paging is newest first and stable; another salon is invisible.
//   Reconciliation: allocations — 1:1, split (1 → n deposits), combined (n → 1 deposit), partial; over-allocation and a race
//   are refused under row locks; unmatch is a stamp (the row is immutable, never deleted); overdue only past arrival + grace;
//   Net Difference compares DUE payouts only; Record a Deposit is idempotent and duplicate-reference checked; bank accounts
//   are owner-administered and deactivated (not deleted); suggestions are evidence, never applied.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SettlementsScreenRepository } from './settlements-screen.repository';
import { ReconWorkspaceRepository } from './recon-workspace.repository';
import { FinanceError, resolvePeriod, pageReq, addDaysYmd } from './finance-scope';

const P = 'f1a2b3c4-0000-4000-8000-0000000';
// uuids are hex: the letter tags of the fixtures map to digits (s→5 settlement, p→9 payment, t→7 ticket, r→6 refund)
const id = (n: string) => P + n.replace(/s/g, '5').replace(/p/g, '9').replace(/t/g, '7').replace(/r/g, '6').padStart(5, '0');
const T = id('a1'), T2 = id('a2'), T3 = id('a3'), B = id('b1'), B2 = id('b2'), B3 = id('b3');
const key = (n: number) => `f1a2b3c4-0000-4000-9000-${String(n).padStart(12, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: [] as string[] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
const ctx3 = { ...ctx, tenantId: T3, branchId: B3 };   // a salon with nothing at all
let pg: any; let db: any; let st: SettlementsScreenRepository; let ws: ReconWorkspaceRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof FinanceError ? e.code : String((e as Error).message); } }
const audited: { tenantId: string; action: string; resourceId: string | null | undefined }[] = [];
const auditor = { record: async (c: any, i: any) => { audited.push({ tenantId: c.tenantId, action: i.action, resourceId: i.resourceId }); } };
const TZ = 'America/New_York';
const month = () => resolvePeriod({ preset: 'month' }, TZ);
const all = () => resolvePeriod({ preset: 'custom', from: '2021-01-01', to: '2030-12-31' }, TZ);

// settlement helper: daysAgo is relative to now (settled_at and created_at)
const settle = (sid: string, tenant: string, ref: string, gross: number, fee: number, net: number, daysAgo: number, extra: Record<string, unknown> = {}) =>
  q(`insert into payment_settlements (id, tenant_id, branch_id, payment_gateway_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, currency, status, settled_at, created_at, transaction_count, refunds_cents, adjustments_cents, expected_deposit_date)
     values ($1,$2,$3,$2,'cardpointe',$4,$5,$6,$7,'USD',$8, now() - make_interval(days => $9), now() - make_interval(days => $9) + make_interval(secs => $10), $11, $12, $13, $14)`,
    [sid, tenant, tenant === T ? B : B2, ref, gross, fee, net, extra.status ?? 'settled', daysAgo, Number(extra.sec ?? 0), extra.txns ?? 0, extra.refunds ?? 0, extra.adj ?? 0, extra.expected ?? null]);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','fs-lotus','FSL001','active'), ($2,'Other LLC','Other Nails','fs-other','FSL002','active'), ($3,'Empty LLC','Empty Nails','fs-empty','FSL003','active')`, [T, T2, T3]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active',$5), ($3,$4,'Other','active',$5), ($6,$7,'Empty','active',$5)`, [B, T, B2, T2, TZ, B3, T3]);
  db = kyselyFor(pg); st = new SettlementsScreenRepository(db, auditor); ws = new ReconWorkspaceRepository(db, auditor);
  await q(`insert into tenant_payment_config (tenant_id, processor, status) values ($1,'cardpointe','active')`, [T]);
  // this month: S1 (fees deducted), S2 (zero fee, provider netted a $10 refund into its net + a -$5 adjustment)
  await settle(id('s01'), T, 'BATCH-1001', 100000, 2500, 97500, 0, { txns: 2, sec: 1 });
  await settle(id('s02'), T, 'BATCH-1002', 50000, 0, 48500, 0, { txns: 1, sec: 2, refunds: 1000, adj: -500 });
  await settle(id('s03'), T, 'OLD-0001', 9999, 99, 9900, 400);                       // last year — out of this month
  await settle(id('s99'), T2, 'BATCH-1001', 77777, 0, 77777, 0);                     // the other salon, the SAME provider ref
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values ($1,$2,$3,'Ann','Lee','Ann Lee','+12155550101','ann@example.com'),
    ($4,$5,$6,'Ann','Other','Ann Other','+12155550101','ann@example.com')`, [id('c01'), T, B, id('c99'), T2, B2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Bo','Walk','Bo Walk')`, [id('c02'), T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number) values ($1,$2,$3,$4,'paid',60000,'T-77'), ($5,$2,$3,$6,'paid',40000,'T-78'), ($7,$8,$9,$10,'paid',77777,'T-99')`,
    [id('t01'), T, B, id('c01'), id('t02'), id('c02'), id('t99'), T2, B2, id('c99')]);
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status, processor_transaction_id, settlement_batch_id) values
    ($1,$2,$3,$4,'card',60000,'settled','TXN-AAA',$5), ($6,$2,$3,$7,'card',40000,'settled','TXN-BBB',$5), ($8,$9,$10,$11,'card',77777,'settled','TXN-ZZZ',$12)`,
    [id('p01'), T, B, id('t01'), id('s01'), id('p02'), id('t02'), id('p99'), T2, B2, id('t99'), id('s99')]);
  // refunds on P1: a completed partial ($20), a failed one ($10), a pending one ($5), a cancelled one (never reached the processor)
  await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, status, processor_refund_id, processor_type) values
    ($1,$2,$3,$4,2000,'refunded','RF-1','cardpointe'), ($5,$2,$3,$4,1000,'failed','RF-2','cardpointe'), ($6,$2,$3,$4,500,'pending','RF-3','cardpointe'), ($7,$2,$3,$4,700,'cancelled',null,'cardpointe')`,
    [id('r01'), T, B, id('p01'), id('r02'), id('r03'), id('r04')]);

}, 180_000);

describe('Deposits & Settlements — empty salon', () => {
  it('zero rows are a verified zero, the source says not configured, the bank is not verified', async () => {
    const p = month();
    const s = await st.summary(ctx3, st.settlementFilters(p, {}), st.refundFilters(p, {}));
    expect(s.kpis.settlements).toBe(0); expect(s.kpis.grossSettledCents).toBe(0); expect(s.kpis.refundsTotalCents).toBe(0);
    expect(s.sourceStatus.state).toBe('not_configured');
    expect(s.reconciliation.bankVerified).toBe(false); expect(s.reconciliation.bankConfirmedCents).toBeNull();
    const l = await st.listSettlements(ctx3, st.settlementFilters(p, {}), pageReq({}));
    expect(l.total).toBe(0); expect(l.page).toBe(1); expect(l.pageCount).toBe(1);
  });
});

describe('Deposits & Settlements — KPIs, refunds, search, paging', () => {
  it('six KPIs over the filtered set; refunds counted once and only completed refunds in the money', async () => {
    const p = month();
    const s = await st.summary(ctx, st.settlementFilters(p, {}), st.refundFilters(p, {}));
    expect(s.kpis.settlements).toBe(2); expect(s.kpis.uniqueBatches).toBe(2);
    expect(s.kpis.grossSettledCents).toBe(150000); expect(s.kpis.processorFeesCents).toBe(2500);
    expect(s.kpis.netProcessorPayoutCents).toBe(97500 + 48500);
    expect(s.kpis.refunds).toBe(3); expect(s.kpis.refundsCompleted).toBe(1); expect(s.kpis.refundsTotalCents).toBe(2000);
    expect(s.kpis.refundsFailed).toBe(1); expect(s.kpis.refundsOpen).toBe(1);
    expect(s.sourceStatus.state).toBe('connected');
  });

  it('the reconciliation strip shows the netted refund as a component — the provider net is not reduced twice', async () => {
    const p = month();
    const s = await st.summary(ctx, st.settlementFilters(p, {}), st.refundFilters(p, {}));
    const r = s.reconciliation;
    expect(r.grossCents - r.feesDeductedCents - r.refundsInBatchCents - r.chargebacksInBatchCents + r.adjustmentsCents).toBe(r.providerNetCents);
    expect(r.providerDefinedDifferenceCents).toBe(0);
    expect(r.expectedPayoutCents).toBe(146000);   // the provider's own net, NOT net − refunds again
  });

  it('search: exact batch id first; payment / customer only through the batch; never the other salon', async () => {
    const p = all();
    const f = (search: string) => st.settlementFilters(p, { search });
    const exact = await st.listSettlements(ctx, f('BATCH-1001'), pageReq({}));
    expect(exact.items.map((x) => x.id)).toEqual([id('s01')]); expect(exact.items[0].matchedBy).toBe('settlement');
    const partial = await st.listSettlements(ctx, f('batch-10'), pageReq({}));
    expect(partial.items.map((x) => x.id).sort()).toEqual([id('s01'), id('s02')]);
    expect((await st.listSettlements(ctx, f('TXN-AAA'), pageReq({}))).items.map((x) => [x.id, x.matchedBy])).toEqual([[id('s01'), 'payment']]);
    expect((await st.listSettlements(ctx, f('Ann'), pageReq({}))).items.map((x) => [x.id, x.matchedBy])).toEqual([[id('s01'), 'customer']]);
    expect((await st.listSettlements(ctx, f('(215) 555-0101'), pageReq({}))).items.map((x) => x.id)).toEqual([id('s01')]);
    expect((await st.listSettlements(ctx, f('T-77'), pageReq({}))).items.map((x) => x.id)).toEqual([id('s01')]);
    expect((await st.listSettlements(ctx, f('$485.00'), pageReq({}))).items.map((x) => [x.id, x.matchedBy])).toEqual([[id('s02'), 'amount']]);
    expect((await st.listSettlements(ctx, f('TXN-ZZZ'), pageReq({}))).total).toBe(0);          // the other salon's payment
    expect((await st.listSettlements(ctx2, f('Ann'), pageReq({}))).items.map((x) => x.id)).toEqual([id('s99')]);
    expect((await st.listSettlements(ctx, f('Nobody'), pageReq({}))).total).toBe(0);
  });

  it('refunds tab: newest first, by refund date, linked customer only via the payment, status groups', async () => {
    const p = month();
    const l = await st.listRefunds(ctx, st.refundFilters(p, {}), pageReq({}));
    expect(l.total).toBe(4);
    const r1 = l.items.find((x) => x.id === id('r01'))!;
    expect(r1.status).toBe('completed'); expect(r1.customer?.name).toBe('Ann Lee'); expect(r1.customer?.phone).toBe('•••-0101');
    expect(r1.payment?.refundsOnPayment).toBe(4); expect(r1.saleSettlement?.ref).toBe('BATCH-1001');
    expect((await st.listRefunds(ctx, st.refundFilters(p, { status: 'completed' }), pageReq({}))).items.map((x) => x.id)).toEqual([id('r01')]);
    expect((await st.listRefunds(ctx, st.refundFilters(p, { search: 'RF-2' }), pageReq({}))).items.map((x) => x.id)).toEqual([id('r02')]);
    expect((await st.listRefunds(ctx2, st.refundFilters(p, {}), pageReq({}))).total).toBe(0);
  });

  it('numbered paging: newest created first, stable, independent page size; a page past the end lands on the last', async () => {
    for (let i = 0; i < 13; i++) await settle(id(`s${100 + i}`), T, `PAGE-${100 + i}`, 1000 + i, 0, 1000 + i, 0, { sec: 10 + i });
    const p = month();
    const f = st.settlementFilters(p, {});
    const p1 = await st.listSettlements(ctx, f, { page: 1, pageSize: 5 });
    const p2 = await st.listSettlements(ctx, f, { page: 2, pageSize: 5 });
    const p3 = await st.listSettlements(ctx, f, { page: 3, pageSize: 5 });
    expect(p1.total).toBe(15); expect(p1.pageCount).toBe(3);
    expect(p1.items[0].settlementRef).toBe('PAGE-112');   // the newest
    const seen = [...p1.items, ...p2.items, ...p3.items].map((x) => x.id);
    expect(new Set(seen).size).toBe(15);
    const past = await st.listSettlements(ctx, f, { page: 9, pageSize: 5 });
    expect(past.page).toBe(3); expect(past.items.map((x) => x.id)).toEqual(p3.items.map((x) => x.id));
    // the KPIs do not depend on the page size
    const s = await st.summary(ctx, f, st.refundFilters(p, {}));
    expect(s.kpis.settlements).toBe(15);
  });

  it('calendar: a custom range is whole local days; end before start and malformed dates are refused', async () => {
    expect(() => resolvePeriod({ preset: 'custom', from: '2026-10-28', to: '2026-10-01' }, TZ)).toThrow(/start date/);
    expect(() => resolvePeriod({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' }, TZ)).toThrow(/valid date/);
    const today = resolvePeriod({ preset: 'today' }, TZ).today;
    const one = resolvePeriod({ preset: 'custom', from: today, to: today }, TZ);
    expect((await st.listSettlements(ctx, st.settlementFilters(one, {}), pageReq({}))).total).toBe(15);
    const week = resolvePeriod({ preset: 'week' }, TZ);
    expect(new Date(week.from + 'T12:00:00Z').getUTCDay()).toBe(1);   // weeks start Monday
  });

  it('detail: allocations / provenance; another salon\'s id is not found; transactions show the linked customer only', async () => {
    const d = await st.detail(ctx, id('s01'));
    expect(d?.settlement.settlementRef).toBe('BATCH-1001'); expect(d?.settlement.bankState).toBe('unverified');
    expect(await st.detail(ctx, id('s99'))).toBeNull();
    const tx = await st.transactions(ctx, id('s01'), {});
    expect(tx?.total).toBe(2);
    expect(tx?.items.find((x) => x.id === id('p01'))?.customer?.name).toBe('Ann Lee');
    expect(tx?.items.find((x) => x.id === id('p02'))?.customer?.name).toBe('Bo Walk');
    expect(tx?.items.find((x) => x.id === id('p01'))?.customer?.phone).toBe('•••-0101');   // last four only
    expect(await st.transactions(ctx, id('s99'), {})).toBeNull();
  });

  it('export: totals over every filtered record, scope written, audited, formula-safe', async () => {
    const p = month();
    const csv = await st.exportCsv(ctx, 'settlements', st.settlementFilters(p, {}), st.refundFilters(p, {}));
    expect(csv).toContain('Net processor payout');
    expect(csv).toContain('Settlements,15');
    expect(csv).toContain('Bank confirmed,Not bank verified');
    expect(audited.some((a) => a.action === 'settlements_exported' && a.tenantId === T)).toBe(true);
  });
});

describe('AI Deposit Reconciliation — bank accounts and Record a Deposit', () => {
  it('bank accounts: last 4 only, first is the default, duplicates refused, deactivate keeps the row', async () => {
    const a = await ws.createBankAccount(ctx, { nickname: 'Operating', bankName: 'Chase', accountLast4: '4321' });
    expect(a.isDefault).toBe(true); expect(a.masked).toBe('Operating ••••4321');
    expect(await code(ws.createBankAccount(ctx, { nickname: 'operating', accountLast4: '4321' }))).toBe('BANK_ACCOUNT_DUPLICATE');
    expect(await code(ws.createBankAccount(ctx, { nickname: 'Full', accountLast4: '123456789' }))).toBe('BANK_ACCOUNT_INVALID');
    const b = await ws.createBankAccount(ctx, { nickname: 'Savings', accountLast4: '9999' });
    expect(b.isDefault).toBe(false);
    const d = await ws.updateBankAccount(ctx, b.id, { makeDefault: true });
    expect(d.isDefault).toBe(true);
    expect((await ws.bankAccounts(ctx)).filter((x) => x.isDefault).length).toBe(1);
    const off = await ws.updateBankAccount(ctx, b.id, { deactivate: true });
    expect(off.status).toBe('inactive'); expect(off.isDefault).toBe(false);
    expect((await ws.bankAccounts(ctx2)).length).toBe(0);
  });

  it('Record a Deposit: a record only, idempotent, duplicate reference checked, future dates and inactive accounts refused', async () => {
    const [acct, savings] = await ws.bankAccounts(ctx).then((xs) => [xs.find((x) => x.nickname === 'Operating')!, xs.find((x) => x.nickname === 'Savings')!]);
    const today = resolvePeriod({ preset: 'today' }, TZ).today;
    const r1 = await ws.createDeposit(ctx, { bankAccountId: acct.id, amountCents: 97500, depositDate: today, reference: 'CARDPOINTE BATCH-1001', idempotencyKey: key(1) }, today);
    expect(r1.duplicate).toBe(false); expect(r1.deposit.matchState).not.toBe('reconciled');
    const again = await ws.createDeposit(ctx, { bankAccountId: acct.id, amountCents: 97500, depositDate: today, reference: 'CARDPOINTE BATCH-1001', idempotencyKey: key(1) }, today);
    expect(again.duplicate).toBe(true); expect(again.id).toBe(r1.id);
    expect(await code(ws.createDeposit(ctx, { bankAccountId: acct.id, amountCents: 100, depositDate: today, reference: 'cardpointe batch 1001', idempotencyKey: key(2) }, today))).toBe('DEPOSIT_DUPLICATE_REFERENCE');
    expect(await code(ws.createDeposit(ctx, { bankAccountId: acct.id, amountCents: 100, depositDate: addDaysYmd(today, 2), idempotencyKey: key(3) }, today))).toBe('DEPOSIT_DATE_IN_FUTURE');
    expect(await code(ws.createDeposit(ctx, { bankAccountId: acct.id, amountCents: 0, depositDate: today, idempotencyKey: key(4) }, today))).toBe('DEPOSIT_AMOUNT_INVALID');
    expect(await code(ws.createDeposit(ctx, { bankAccountId: savings.id, amountCents: 100, depositDate: today, idempotencyKey: key(5) }, today))).toBe('BANK_ACCOUNT_INACTIVE');
    expect(await code(ws.createDeposit(ctx2, { bankAccountId: acct.id, amountCents: 100, depositDate: today, idempotencyKey: key(6) }, today))).toBe('BANK_ACCOUNT_NOT_FOUND');
    expect((await q(`select count(*)::int as n from bank_deposits where tenant_id = $1`, [T])).rows[0].n).toBe(1);
    expect(audited.filter((a) => a.action === 'deposit_recorded').length).toBe(1);
  });
});

describe('AI Deposit Reconciliation — allocations', () => {
  const today = () => resolvePeriod({ preset: 'today' }, TZ).today;
  const dep = async (n: number, cents: number, ref: string | null = null) => {
    const acct = (await ws.bankAccounts(ctx)).find((x) => x.nickname === 'Operating')!.id;
    return (await ws.createDeposit(ctx, { bankAccountId: acct, amountCents: cents, depositDate: today(), reference: ref, idempotencyKey: key(100 + n) }, today())).id;
  };

  it('a suggestion is evidence with a confidence — and applies nothing', async () => {
    const d1 = (await q(`select id from bank_deposits where tenant_id = $1 and reference = 'CARDPOINTE BATCH-1001'`, [T])).rows[0].id;
    const s = await ws.suggestions(ctx, d1, TZ);
    expect(s?.suggestions[0].settlement.id).toBe(id('s01')); expect(s?.suggestions[0].confidence).toBe('high'); expect(s?.suggestions[0].basis).toBe('exact_reference');
    expect((await q(`select count(*)::int as n from reconciliation_allocations where tenant_id = $1`, [T])).rows[0].n).toBe(0);
  });

  it('1:1 — review required, exact match → matched, idempotent; the provider payout does not change', async () => {
    const d1 = (await q(`select id from bank_deposits where tenant_id = $1 and reference = 'CARDPOINTE BATCH-1001'`, [T])).rows[0].id;
    expect(await code(ws.allocate(ctx, { settlementId: id('s01'), depositId: d1, amountCents: 97500, reviewed: false, idempotencyKey: key(200), canApprove: true }))).toBe('ALLOCATION_REVIEW_REQUIRED');
    const a = await ws.allocate(ctx, { settlementId: id('s01'), depositId: d1, amountCents: 97500, reviewed: true, idempotencyKey: key(201), basis: 'exact_reference', canApprove: false });
    const again = await ws.allocate(ctx, { settlementId: id('s01'), depositId: d1, amountCents: 97500, reviewed: true, idempotencyKey: key(201), canApprove: false });
    expect(again.duplicate).toBe(true); expect(again.id).toBe(a.id);
    const p = all();
    const row = (await ws.listSettlements(ctx, ws.filters(p, { search: 'BATCH-1001' }), pageReq({}))).items[0];
    expect(row.status).toBe('matched'); expect(row.matchedCents).toBe(97500); expect(row.expectedNetCents).toBe(97500);
    const sd = await st.detail(ctx, id('s01'));
    expect(sd?.settlement.expectedPayoutCents).toBe(97500); expect(sd?.settlement.bankConfirmedCents).toBe(97500); expect(sd?.settlement.bankState).toBe('matched');
    expect((await ws.depositDetail(ctx, d1))?.deposit.matchState).toBe('reconciled');
  });

  it('split payout: one settlement → two deposits; over-allocation refused with the remaining amounts', async () => {
    const d2 = await dep(2, 30000), d3 = await dep(3, 20000);
    await ws.allocate(ctx, { settlementId: id('s02'), depositId: d2, amountCents: 30000, reviewed: true, idempotencyKey: key(210), canApprove: false });
    let row = (await ws.listSettlements(ctx, ws.filters(all(), { search: 'BATCH-1002' }), pageReq({}))).items[0];
    expect(row.status).toBe('partially_matched'); expect(row.remainingCents).toBe(18500);
    expect(await code(ws.allocate(ctx, { settlementId: id('s02'), depositId: d3, amountCents: 20000, reviewed: true, idempotencyKey: key(211), canApprove: true }))).toBe('ALLOCATION_EXCEEDS_REMAINING');
    await ws.allocate(ctx, { settlementId: id('s02'), depositId: d3, amountCents: 18500, reviewed: true, idempotencyKey: key(212), canApprove: false });
    row = (await ws.listSettlements(ctx, ws.filters(all(), { search: 'BATCH-1002' }), pageReq({}))).items[0];
    expect(row.status).toBe('matched'); expect(row.linkedDeposits).toBe(2);
    expect((await ws.depositDetail(ctx, d3))?.deposit.remainingCents).toBe(1500);
  });

  it('combined payout: two settlements → one deposit; a partial on BOTH sides needs an approver', async () => {
    await settle(id('s05'), T, 'COMB-1', 10000, 0, 10000, 1); await settle(id('s06'), T, 'COMB-2', 20000, 0, 20000, 1);
    const d4 = await dep(4, 30000);
    expect(await code(ws.allocate(ctx, { settlementId: id('s05'), depositId: d4, amountCents: 5000, reviewed: true, idempotencyKey: key(220), canApprove: false }))).toBe('ALLOCATION_NEEDS_APPROVER');
    await ws.allocate(ctx, { settlementId: id('s05'), depositId: d4, amountCents: 10000, reviewed: true, idempotencyKey: key(221), canApprove: false });
    await ws.allocate(ctx, { settlementId: id('s06'), depositId: d4, amountCents: 20000, reviewed: true, idempotencyKey: key(222), canApprove: false });
    expect((await ws.depositDetail(ctx, d4))?.deposit.matchState).toBe('reconciled');
    expect((await ws.depositDetail(ctx, d4))?.allocations.length).toBe(2);
  });

  it('a race for the same deposit allocates it once (row locks)', async () => {
    await settle(id('s07'), T, 'RACE-1', 8000, 0, 8000, 1); await settle(id('s08'), T, 'RACE-2', 8000, 0, 8000, 1);
    const d5 = await dep(5, 8000);
    const r = await Promise.allSettled([
      ws.allocate(ctx, { settlementId: id('s07'), depositId: d5, amountCents: 8000, reviewed: true, idempotencyKey: key(230), canApprove: true }),
      ws.allocate(ctx, { settlementId: id('s08'), depositId: d5, amountCents: 8000, reviewed: true, idempotencyKey: key(231), canApprove: true }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect((await q(`select coalesce(sum(amount_cents), 0)::int as s from reconciliation_allocations where tenant_id = $1 and deposit_id = $2 and unmatched_at is null`, [T, d5])).rows[0].s).toBe(8000);
  });

  it('unmatch is a stamp with a reason — the allocation row is immutable and never deleted', async () => {
    const a = (await q(`select id from reconciliation_allocations where tenant_id = $1 and settlement_id = $2`, [T, id('s05')])).rows[0].id;
    expect(await code(ws.unmatch(ctx, a, ''))).toBe('ALLOCATION_REASON_REQUIRED');
    await ws.unmatch(ctx, a, 'Wrong batch');
    expect(await code(ws.unmatch(ctx, a, 'again'))).toBe('ALLOCATION_ALREADY_UNMATCHED');
    expect(await code(ws.unmatch(ctx2, a, 'other salon'))).toBe('ALLOCATION_NOT_FOUND');
    expect(await code(q(`update reconciliation_allocations set amount_cents = 1 where id = $1`, [a]))).toMatch(/immutable/);
    expect(await code(q(`delete from reconciliation_allocations where id = $1`, [a]))).toMatch(/never deleted/);
    const row = (await ws.listSettlements(ctx, ws.filters(all(), { search: 'COMB-1' }), pageReq({}))).items[0];
    expect(row.status).toBe('expected'); expect(row.matchedCents).toBe(0);
    expect(audited.some((x) => x.action === 'allocation_unmatched' && x.resourceId === a)).toBe(true);
  });

  it('overdue only after the arrival window + grace; Net Difference compares DUE payouts only', async () => {
    await settle(id('s09'), T, 'LATE-1', 5000, 0, 5000, 10);      // 10 days ago, nothing matched → overdue
    const p = resolvePeriod({ preset: 'custom', from: '2021-01-01', to: '2030-12-31' }, TZ);
    const late = (await ws.listSettlements(ctx, ws.filters(p, { search: 'LATE-1' }), pageReq({}))).items[0];
    expect(late.status).toBe('overdue'); expect(late.arrivalSourced).toBe(false);
    const fresh = (await ws.listSettlements(ctx, ws.filters(p, { search: 'COMB-1' }), pageReq({}))).items[0];
    expect(fresh.status).toBe('expected');
    const k = await ws.kpis(ctx, ws.filters(p, {}));
    expect(k.missingDeposits).toBeGreaterThanOrEqual(1);
    expect(k.netDifferenceCents).toBe(k.netDifference.dueMatchedCents - k.netDifference.dueExpectedCents);
    expect(k.netDifference.notYetDueCount).toBeGreaterThan(0);
    const overdueOnly = await ws.listSettlements(ctx, ws.filters(p, { status: 'overdue' }), pageReq({}));
    expect(overdueOnly.items.every((x) => x.status === 'overdue')).toBe(true);
  });

  it('unmatched deposits list: newest first, only what still has an unallocated amount, bank-posted basis', async () => {
    const l = await ws.listDeposits(ctx, ws.filters(month(), {}), pageReq({}), { unmatchedOnly: true });
    expect(l.dateBasis).toBe('bank_posted');
    expect(l.items.every((x) => x.remainingCents > 0)).toBe(true);
    expect(l.items.some((x) => x.matchState === 'partial_allocation')).toBe(true);
  });

  it('Investigate raises one case per target and kind; the exceptions list classifies it; reports reconcile', async () => {
    const a = await ws.raiseException(ctx, { targetType: 'settlement', targetId: id('s09'), kind: 'missing_deposit', note: 'No bank credit yet' }, async (input) => {
      const r = await q(`insert into reconciliation_exceptions (tenant_id, kind, severity, title, detail, amount_cents, source_ref) values ($1,$2,'high',$3,$4,$5,$6) returning id`, [T, input.kind, input.title, input.detail, input.amountCents, input.sourceRef]);
      return { id: r.rows[0].id };
    });
    const b = await ws.raiseException(ctx, { targetType: 'settlement', targetId: id('s09'), kind: 'missing_deposit' }, async () => { throw new Error('must not create twice'); });
    expect(b.existing).toBe(true); expect(b.id).toBe(a.id);
    const ex = await ws.exceptions(ctx, ws.filters(month(), {}), pageReq({}), { cls: 'missing' });
    expect(ex.items[0].settlementRef).toBe('LATE-1'); expect(ex.items[0].class).toBe('missing');
    const row = (await ws.listSettlements(ctx, ws.filters(all(), { search: 'LATE-1' }), pageReq({}))).items[0];
    expect(row.status).toBe('exception');
    const p = all();
    const sum = await ws.report(ctx, 'settlement_summary', ws.filters(p, {}), pageReq({ pageSize: 50 }));
    const k = await ws.kpis(ctx, ws.filters(p, {}));
    expect(sum.totals.settlements).toBe(k.settlements);
    expect(sum.totals.matchedCents).toBe(k.matchedCents);
    for (const t of ['matched_deposits', 'unmatched_deposits', 'missing_overdue', 'processing_fees', 'exceptions_aging', 'net_difference_trend', 'bank_accounts', 'processor_comparison'] as const) {
      const r = await ws.report(ctx, t, ws.filters(p, {}), pageReq({}));
      expect(Array.isArray(r.rows)).toBe(true);
    }
    const csv = await ws.reportCsv(ctx, 'bank_accounts', ws.filters(p, {}));
    expect(csv).toContain('••••4321'); expect(csv).not.toMatch(/\d{5,}4321/);
  });

  it('universal search returns typed results and nothing of another salon', async () => {
    const r = await ws.universalSearch(ctx, 'BATCH-1001', TZ);
    expect(r.results.some((x) => x.type === 'settlement' && x.id === id('s01'))).toBe(true);
    expect(r.results.some((x) => x.type === 'bank_deposit')).toBe(true);
    const other = await ws.universalSearch(ctx2, 'CARDPOINTE', TZ);
    expect(other.results.filter((x) => x.type === 'bank_deposit').length).toBe(0);
  });
});
