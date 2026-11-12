// money-overview-screen.pgtest — Payments & Money mandate (Oct 29 2026), against the REAL schema. The photo's discrepancy,
// reproduced: three tenders $63.16 + $53.27 + $51.72 = $168.15 while the old Overview said Revenue / Collections $116.43 —
// it summed only status 'approved' and so dropped the split's 'partial' $51.72 tender. Here Collections = $168.15 (every
// confirmed tender, = Transactions' Gross), Revenue counts the two PAID tickets' sales (no tax, no tips), the third ticket's
// remaining $30.00 is Outstanding (as of now) until it is paid. Plus: an open invoice in Outstanding, a pending vs a
// deposited settlement, a completed vs a pending refund, a declined and an unresolved attempt, a chargeback, the trend in
// the salon's days, the method mix, Top Services once per line (a removed line excluded), all-time totals, typed search
// results (payment / invoice / payout), and another salon's money never visible.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MoneyOverviewScreenRepository } from './money-overview-screen.repository';

const P = 'f8b2c3d4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.reports.view', 'pos.customers.view'] } as any;
const other = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let r: MoneyOverviewScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const on = (d: string, c = ctx) => r.period(c, { preset: 'custom', from: d, to: d });
const range = (a: string, b: string, c = ctx) => r.period(c, { preset: 'custom', from: a, to: b });
let n = 0;
async function ticket(o: { num: string; sub: number; disc?: number; tax?: number; tip: number; status: string; paidAt: string | null; at: string; tenant?: string; branch?: string; customer?: string }) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('95') : id('94')), o.status, o.paidAt ? o.sub - (o.disc ?? 0) : 0, o.disc ?? 0, o.tax ?? 0, o.paidAt ? o.sub - (o.disc ?? 0) + (o.tax ?? 0) : 0, o.tip, o.num, o.paidAt, o.at]);
  return tid;
}
async function pay(tid: string, method: string, amount: number, at: string, status = 'approved', o: { tenant?: string; branch?: string; stranded?: boolean } = {}) {
  const pid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at, approved_at, stranded_at, updated_at) values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$8)`,
    [pid, o.tenant ?? T, o.branch ?? B, tid, method, amount, status, at, ['approved', 'partial'].includes(status) ? at : null, o.stranded ? at : null]);
  return pid;
}
async function line(tid: string, svc: string, name: string, cents: number, o: { removed?: boolean; tenant?: string; branch?: string } = {}) {
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, removed_at) values ($1,$2,$3,$4,$5,$6,45,$6,'completed',$7)`,
    [o.tenant ?? T, o.branch ?? B, tid, svc, name, cents, o.removed ? '2026-10-22T10:00:00Z' : null]);
}
const ids: Record<string, string> = {};

beforeAll(async () => {
  pg = await migratedPglite();
  r = new MoneyOverviewScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','mo-pilot','MOP001','active'), ($2,'Other LLC','Other','mo-other','MOP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values
    ($1,$3,$4,'Mai','Pham','Mai Pham','+18565551234','mai@example.com'), ($2,$3,$4,'Walk','In','Walk-in',null,null), ($5,$6,$7,'Walk','In','Walk-in',null,null)`, [id('91'), id('94'), T, B, id('95'), T2, B2]);
  // the photo has no sales tax: the salon turned tax off (an unpaid ticket's balance includes tax when it is on)
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'tax', '{"enabled":false}'::jsonb)`, [T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Nails')`, [id('81'), T, B, id('89'), T2, B2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$4,$5,$6,'Gel Mani',45,3500), ($2,$4,$5,$6,'Pedicure',45,4500), ($3,$4,$5,$6,'Nail Art',20,1000), ($7,$8,$9,$10,'Gel Mani',45,3500)`,
    [id('82'), id('83'), id('84'), T, B, id('81'), id('85'), T2, B2, id('89')]);

  // Oct 22 (the photo): two PAID tickets and one partly paid ticket — tender amounts include the tips
  const t1 = await ticket({ num: '5001', sub: 5916, tip: 400, status: 'paid', paidAt: '2026-10-22T13:00:00Z', at: '2026-10-22T12:30:00Z', customer: id('91') });
  ids.p1 = await pay(t1, 'card', 6316, '2026-10-22T13:00:00Z');
  await line(t1, id('82'), 'Gel Mani', 3500); await line(t1, id('84'), 'Nail Art', 2416);
  const t2 = await ticket({ num: '5002', sub: 4967, tip: 360, status: 'paid', paidAt: '2026-10-22T15:00:00Z', at: '2026-10-22T14:00:00Z' });
  ids.p2 = await pay(t2, 'card', 5327, '2026-10-22T15:00:00Z');
  await line(t2, id('83'), 'Pedicure', 4967); await line(t2, id('82'), 'Gel Mani', 3500, { removed: true });   // removed — never revenue
  const t3 = await ticket({ num: '5003', sub: 7972, tip: 200, status: 'ready_checkout', paidAt: null, at: '2026-10-22T16:00:00Z' });
  ids.p3 = await pay(t3, 'card', 5172, '2026-10-22T16:30:00Z', 'partial');
  await line(t3, id('83'), 'Pedicure', 7972);
  await pay(t3, 'card', 3000, '2026-10-22T16:20:00Z', 'declined');
  await pay(t3, 'card', 3000, '2026-10-22T16:40:00Z', 'pending', { stranded: true });   // the processor never answered
  // Oct 23: a cash ticket with a $10 completed refund and a $5 pending refund; a gift-card ticket
  const t4 = await ticket({ num: '5004', sub: 4000, disc: 500, tip: 0, status: 'paid', paidAt: '2026-10-23T14:00:00Z', at: '2026-10-23T13:30:00Z' });
  ids.p4 = await pay(t4, 'cash', 3500, '2026-10-23T14:00:00Z');
  await line(t4, id('82'), 'Gel Mani', 4000);   // $40 of lines − $5 discount = $35 net (what checkout writes as subtotal_cents)
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, reason, status, created_at, settled_at) values ($1,$2,$3,1000,'Chipped','refunded','2026-10-23T18:00:00Z','2026-10-23T18:00:00Z'), ($1,$2,$3,500,'Goodwill','reserved','2026-10-23T19:00:00Z',null)`, [T, B, ids.p4]);
  const t5 = await ticket({ num: '5005', sub: 2500, tip: 0, status: 'paid', paidAt: '2026-10-23T16:00:00Z', at: '2026-10-23T15:30:00Z' });
  await pay(t5, 'gift_card', 2500, '2026-10-23T16:00:00Z'); await line(t5, id('83'), 'Pedicure', 2500);
  // 11:30 PM Oct 23 New York = 03:30 UTC Oct 24: still Oct 23 for the salon
  const t6 = await ticket({ num: '5006', sub: 1000, tip: 0, status: 'paid', paidAt: '2026-10-24T03:30:00Z', at: '2026-10-24T03:00:00Z' });
  await pay(t6, 'cash', 1000, '2026-10-24T03:30:00Z'); await line(t6, id('84'), 'Nail Art', 1000);
  // an invoice sent for $80 with $20 recorded on it → $60 outstanding; a paid invoice adds nothing
  await q(`insert into invoices (id, tenant_id, branch_id, customer_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, bill_to_name) values ($1,$3,$4,$5,'INV-0042','partially_paid',8000,0,8000,'Mai Pham'), ($2,$3,$4,$5,'INV-0043','paid',5000,0,5000,'Mai Pham')`, [id('61'), id('62'), T, B, id('91')]);
  await q(`insert into invoice_payments (tenant_id, invoice_id, amount_cents, paid_on, method, idempotency_key) values ($1,$2,2000,'2026-10-20','cash','ip-1'), ($1,$3,5000,'2026-10-20','card_external','ip-2')`, [T, id('61'), id('62')]);
  // settlements: one pending payout (expected), one deposited
  await q(`insert into payment_settlements (id, tenant_id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, status, expected_deposit_date, funding_account_last4, created_at, actual_deposit_date) values
    ($1,$3,$4,'cardpointe','BATCH-201',11643,350,11293,'pending','2026-10-24','6789','2026-10-23T02:00:00Z',null), ($2,$3,$4,'cardpointe','BATCH-200',9000,270,8730,'posted','2026-10-21','6789','2026-10-21T02:00:00Z','2026-10-21')`, [id('71'), id('72'), T, B]);
  await q(`insert into chargebacks (tenant_id, branch_id, payment_id, processor_type, amount_cents, status, opened_at) values ($1,$2,$3,'cardpointe',6316,'open','2026-10-22T20:00:00Z')`, [T, B, ids.p1]);
  // another salon: a paid ticket on Oct 22
  const o1 = await ticket({ num: '5001', sub: 9999, tip: 0, status: 'paid', paidAt: '2026-10-22T13:00:00Z', at: '2026-10-22T12:00:00Z', tenant: T2, branch: B2 });
  await pay(o1, 'card', 9999, '2026-10-22T13:00:00Z', 'approved', { tenant: T2, branch: B2 });
  await line(o1, id('85'), 'Gel Mani', 9999, { tenant: T2, branch: B2 });
}, 120000);

describe('Payments & Money — the photo\'s $116.43 vs $168.15', () => {
  it('Oct 22: Collections $168.15 (every confirmed tender, the partial one included) — the old approved-only sum was $116.43', async () => {
    const o = await r.overview(ctx, await on('2026-10-22'));
    expect(o.kpis.collectionsCents).toBe(16815);
    expect(6316 + 5327).toBe(11643);                                // what the old Overview summed (status 'approved' only)
    expect(o.kpis.totalTransactions).toBe(3);                       // = Transactions' count
    expect(o.kpis.revenueCents).toBe(5916 + 4967);                  // the two PAID tickets' sales, no tax, no tips
    expect(o.kpis.paidTickets).toBe(2);
    expect(o.kpis.averageTicketCents).toBe(Math.round((5916 + 4967) / 2));   // ÷ tickets, never ÷ tenders
    expect(o.kpis.failedTransactions).toBe(1);
    expect(o.kpis.unresolvedTransactions).toBe(1);                  // the unanswered attempt is NOT called failed
  });
  it('Revenue is net sales once: a $40 ticket with a $5 discount is $35 — the discount is not taken off twice (audit Nov 3 2026)', async () => {
    const o = await r.overview(ctx, await range('2026-10-23', '2026-10-23'));
    expect(o.kpis.revenueCents).toBe(3500 + 2500 + 1000);
  });
  it('Outstanding is as of now: the partly paid ticket\'s balance + the open invoice\'s balance', async () => {
    const o = await r.overview(ctx, await on('2026-10-22'));
    expect(o.outstanding).toMatchObject({ ticketsDueCents: 7972 + 200 - 5172, invoicesDueCents: 6000, ticketsDue: 1, invoicesDue: 1 });
    expect(o.kpis.outstandingBalanceCents).toBe(3000 + 6000);
    expect((await r.overview(ctx, await on('2026-10-01'))).kpis.outstandingBalanceCents).toBe(9000);   // the same whatever the period
  });
  it('refunds: completed by refund date; pending shown apart; payouts: pending is expected money, never deposited', async () => {
    const o = await r.overview(ctx, await on('2026-10-23'));
    expect(o.kpis.refundsIssuedCents).toBe(1000); expect(o.kpis.pendingRefundsCents).toBe(500);
    expect(o.kpis.pendingPayoutsCents).toBe(11293); expect(o.kpis.pendingPayouts).toBe(1);
    expect(o.upcomingPayouts.items).toHaveLength(1);
    expect(o.upcomingPayouts.items[0]).toMatchObject({ reference: 'BATCH-201', bank: 'not_confirmed', destination: '••6789', expectedDate: '2026-10-24' });
    expect(o.kpis.giftCardCollectionsCents).toBe(2500);
    expect(o.kpis.collectionsCents).toBe(3500 + 2500 + 1000);       // incl. 11:30 PM Oct 23 salon time
    expect(o.health.reasons).toContain('pending_refunds');
  });
  it('the method mix reconciles to Collections; card / cash / gift card', async () => {
    const o = await r.overview(ctx, await range('2026-10-22', '2026-10-23'));
    expect(o.paymentMethods.totalCents).toBe(o.kpis.collectionsCents);
    expect(o.paymentMethods.methods.map((m) => m.method)).toEqual(['card', 'cash', 'gift_card']);
    expect(o.paymentMethods.methods[0]).toMatchObject({ amountCents: 16815, count: 3 });
  });
  it('Top Services: lines on PAID tickets in the period, removed lines excluded, once per line', async () => {
    const s = await r.services(ctx, await range('2026-10-22', '2026-10-23'), { page: 1, pageSize: 10 });
    expect(s.items.map((x) => [x.name, x.revenueCents])).toEqual([['Gel Mani', 7500], ['Pedicure', 4967 + 2500], ['Nail Art', 2416 + 1000]]);   // line sales, before the $5 discount
    expect(s.items.find((x) => x.name === 'Pedicure')?.tickets).toBe(2);   // the partly paid ticket's Pedicure is not yet revenue
    const p2 = await r.services(ctx, await range('2026-10-22', '2026-10-23'), { page: 2, pageSize: 2 });
    expect(p2.items.map((x) => x.name)).toEqual(['Nail Art']); expect(p2.pageCount).toBe(2);
    expect((await r.services(ctx, await range('2026-10-22', '2026-10-23'), { page: 1, pageSize: 10 }, 'pedi')).total).toBe(1);
  });
  it('the trend: one bucket per salon day, revenue and collections agreeing with the headline', async () => {
    const p = await range('2026-10-21', '2026-10-24');
    const o = await r.overview(ctx, p);
    expect(o.revenueTrend.bucket).toBe('day');
    expect(o.revenueTrend.points.map((x) => x.start)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(o.revenueTrend.points.map((x) => x.collectionsCents)).toEqual([0, 16815, 7000, 0]);
    expect(o.revenueTrend.points.reduce((a, x) => a + x.revenueCents, 0)).toBe(o.kpis.revenueCents);
    expect(o.revenueTrend.points.reduce((a, x) => a + x.collectionsCents, 0)).toBe(o.kpis.collectionsCents);
    const yr = await r.overview(ctx, await range('2026-01-01', '2026-12-31'));
    expect(yr.revenueTrend.bucket).toBe('week');
  });
  it('health discloses its ratios; recent activity is a 5-row preview; all-time totals are labelled apart', async () => {
    const o = await r.overview(ctx, await on('2026-10-22'));
    expect(o.health).toMatchObject({ successful: 3, failed: 1, unresolved: 1, chargebacks: 1, status: 'attention', successRatePercent: 75 });
    expect(o.health.reasons).toEqual(expect.arrayContaining(['failed_payments', 'unresolved_payments', 'chargebacks']));
    expect(o.recentTransactions.length).toBeLessThanOrEqual(5);
    expect(o.recentTransactions[0]).toMatchObject({ state: 'pending' });   // newest created first
    expect(o.totals).toMatchObject({ totalCollectedCents: 16815 + 3500 + 2500 + 1000, totalRefundsCents: 1000, totalPayoutsCents: 8730, totalTipsCents: 760, outstandingBalanceCents: 9000 });
    expect(o.definitions.collections).toMatch(/same as Gross on Transactions/);
  });
  it('payout history paginates newest first', async () => {
    const all = await r.payoutList(ctx, { page: 1, pageSize: 1 }, { status: 'all' });
    expect(all.total).toBe(2); expect(all.pageCount).toBe(2); expect(all.items[0].reference).toBe('BATCH-201');
    expect((await r.payoutList(ctx, { page: 1, pageSize: 10 }, { status: 'paid' })).items[0]).toMatchObject({ reference: 'BATCH-200', bank: 'deposit_recorded' });
  });
});

describe('Payments & Money — search and isolation', () => {
  it('one box: phone (any format) and name find the payments; invoice number and payout reference find theirs', async () => {
    const p = await range('2026-10-01', '2026-10-31');
    for (const s of ['(856) 555-1234', '8565551234', '+1 856 555 1234']) {
      const res = await r.search(ctx, p, s);
      expect(res.payments.items.map((x) => x.id)).toEqual([ids.p1]);
      expect(res.invoices.map((x) => x.number).sort()).toEqual(['INV-0042', 'INV-0043']);
    }
    expect((await r.search(ctx, p, 'INV-0042')).invoices.map((x) => x.number)).toEqual(['INV-0042']);
    expect((await r.search(ctx, p, 'BATCH-201')).payouts.map((x) => x.reference)).toEqual(['BATCH-201']);
    expect((await r.search(ctx, p, '#5003')).payments.items.map((x) => x.id)).toContain(ids.p3);
    await expect(r.search(ctx, p, 'x')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('another salon sees only its own money', async () => {
    const o = await r.overview(other, await on('2026-10-22', other));
    expect(o.kpis).toMatchObject({ collectionsCents: 9999, revenueCents: 9999, outstandingBalanceCents: 0, pendingPayoutsCents: 0, refundsIssuedCents: 0 });
    expect((await r.services(other, await on('2026-10-22', other), { page: 1, pageSize: 10 })).items.map((x) => x.revenueCents)).toEqual([9999]);
    const res = await r.search(other, await range('2026-10-01', '2026-10-31', other), 'INV-0042');
    expect(res.invoices).toEqual([]); expect(res.payments.total).toBe(0);
    expect((await r.overview(ctx, await on('2026-10-22'))).kpis.collectionsCents).toBe(16815);
  });
});

describe('PAYMENTS 05 (Nov 12 2026): Revenue vs Collections explainer', () => {
  it('Oct 22 bridges $108.83 revenue to $168.15 collected: + $7.60 tips, + $51.72 taken on a ticket that is not paid yet', async () => {
    const o: any = await r.overview(ctx, await on('2026-10-22'));
    expect(o.revenueBridge).toMatchObject({ revenueCents: 10883, taxCents: 0, tipsCents: 760, expectedCents: 11643, collectedOnPaidTicketsCents: 11643, otherDifferenceCents: 0,
      collectedOtherDaysCents: 0, collectedForOtherTicketsCents: 5172, otherTicketsCount: 1, collectionsCents: 16815, balanced: true });
  });
  it('a ticket paid on Oct 23 with a deposit taken Oct 22: the deposit is "another day" for Oct 23 and "other tickets" for Oct 22; every period balances', async () => {
    const tid = id('c900');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,$4,'paid',2000,0,150,2150,0,'5090','2026-10-23T17:00:00Z','2026-10-22T17:00:00Z')`, [tid, T, B, id('94')]);
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at, approved_at, updated_at) values ($1,$3,$4,$5,'card',1000,0,'approved','2026-10-22T17:05:00Z','2026-10-22T17:05:00Z','2026-10-22T17:05:00Z'), ($2,$3,$4,$5,'cash',1150,0,'approved','2026-10-23T17:00:00Z','2026-10-23T17:00:00Z','2026-10-23T17:00:00Z')`, [id('d900'), id('d901'), T, B, tid]);
    const d23: any = (await r.overview(ctx, await on('2026-10-23'))).revenueBridge;
    expect(d23).toMatchObject({ taxCents: 150, collectedOtherDaysCents: 1000, balanced: true });
    expect(d23.collectedOnPaidTicketsCents - d23.collectedOtherDaysCents + d23.collectedForOtherTicketsCents).toBe(d23.collectionsCents);
    const d22: any = (await r.overview(ctx, await on('2026-10-22'))).revenueBridge;
    expect(d22).toMatchObject({ collectedForOtherTicketsCents: 5172 + 1000, otherTicketsCount: 2, balanced: true });
    expect((await r.overview(other, await on('2026-10-22')) as any).revenueBridge).toMatchObject({ collectedForOtherTicketsCents: 0, balanced: true });   // another salon sees only its own
    await q(`delete from payments where id in ($1,$2)`, [id('d900'), id('d901')]); await q(`delete from tickets where id = $1`, [tid]);
  });
});
