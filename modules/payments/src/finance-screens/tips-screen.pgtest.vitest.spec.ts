// tips-screen.pgtest — Tips & Gratuity mandate (Oct 29 2026), against the REAL schema.
//   The photo: Total $9.60 · Card $9.60 · Cash $0.00 · No-tip 2 · Distribution $19.20. Reproduced here: ONE $9.60 card tip
//   whose frozen compensation snapshot carries the tip on TWO line rows (the retried-snapshot defect fixed in
//   compensation-snapshot.repository). The screen reads the allocation grain, so the technician shows $9.60, and the
//   ticket is FLAGGED as a snapshot mismatch — never silently corrected.
//   Also: cash tips, a 3-technician $20 split (Σ 20), a split-tender ticket (tip once, not per tender), a refund reversal,
//   a paid-out payroll period, every search form, paging, and another salon's tips being invisible.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TipsScreenRepository } from './tips-screen.repository';
import { FinanceError } from './finance-scope';

const P = 'a7b2c3d4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1');
const VISHAL = id('f1'), ANNA = id('f2'), BAO = id('f3'), CHI = id('f4');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.reports.view', 'pos.customers.view', 'tips.adjust'] } as any;
const desk = { ...ctx, permissions: ['pos.reports.view'] };
const other = { ...ctx, tenantId: T2, branchId: B2 };
const TZ = 'America/New_York';
let pg: any; let r: TipsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
// "the recent tips": the last 10 salon days (fixtures sit 1–5 days back; the 40-day-old one is outside). It was This Month,
// which made the suite fail on the first days of every month (Nov 3 2026) — a fixed window keeps it date-independent.
const ymdAgo = (d: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - d * 86_400_000));
const month = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'custom', from: ymdAgo(10), to: ymdAgo(0) }), extra);
const all = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'all' }), extra);
const pr = { page: 1, pageSize: 12 };
let n = 0;
async function ticket(o: { tenant?: string; branch?: string; tip: number; subtotal: number; number: string; tech?: string; customer?: string; daysAgo?: number; status?: string; chosen?: string; removed?: boolean }) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, chosen_payment_method, paid_at, created_at, removed_at)
    values ($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10,$11, now() - make_interval(days => $12), now() - make_interval(days => $12, mins => 30), case when $13 then now() else null end)`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('99') : id('92')), o.tech ?? (o.tenant ? id('f9') : VISHAL), o.status ?? 'paid', o.subtotal, o.subtotal + o.tip, o.tip, o.number, o.chosen ?? 'card', o.daysAgo ?? 1, !!o.removed]);
  // the sales live on the ticket's lines (what the screens read; subtotal_cents is only the paid, net figure)
  if (o.subtotal > 0) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$5,'Service',$4,45,$4,'completed')`,
    [o.tenant ?? T, o.branch ?? B, tid, o.subtotal, o.tenant ? id('8b') : id('8a')]);
  return tid;
}
async function pay(tid: string, method: string, amount: number, tip: number, status = 'approved', ref: string | null = null, tenant = T, branch = B) {
  const pid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '1 day')`, [pid, tenant, branch, tid, method, amount, tip, status, ref]);
  return pid;
}
const alloc = (tid: string, tech: string, cents: number, tenant = T, branch = B) => q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,$5)`, [tenant, branch, tid, tech, cents]);
const snap = (tid: string, line: string, tech: string, card: number, cash: number) => q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, card_tip_cents, cash_tip_cents, snapshot_at) values ($1,$2,$3,$4,$5,'1.0.0',$6,$7, now() - interval '1 day')`, [T, B, tid, line, tech, card, cash]);
let photo = '', trio = '', splitT = '', refunded = '', paidOut = '';

beforeAll(async () => {
  pg = await migratedPglite();
  r = new TipsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tp-pilot','TPP001','active'), ($2,'Other LLC','Other','tp-other','TPP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active',$5), ($3,$4,'Elsewhere','active',$5)`, [B, T, B2, T2, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Nails')`, [id('8c'), T, B, id('8d'), T2, B2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$7,'Service',45,1000), ($4,$5,$6,$8,'Service',45,1000)`, [id('8a'), T, B, id('8b'), T2, B2, id('8c'), id('8d')]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$5,$6,'Vishal','Verma','Vishal verma','active'), ($2,$5,$6,'Anna','Lee','Anna Lee','active'), ($3,$5,$6,'Bao','Tran','Bao Tran','active'), ($4,$5,$6,'Chi','Pham','Chi Pham','active'), ($7,$8,$9,'Other','Tech','Other Tech','active')`, [VISHAL, ANNA, BAO, CHI, T, B, id('f9'), T2, B2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com'), ($4,$5,$6,'John','Smith','John Smith','+18565551234','(856) 555-1234',null), ($7,$2,$3,'Walk','In','Walk-in','+18565550000',null,null)`, [id('91'), T, B, id('99'), T2, B2, id('92')]);

  // the photo: $9.60 card tip, one technician, snapshot doubled on two line rows (the defect), two no-tip tickets
  photo = await ticket({ tip: 960, subtotal: 14400, number: '1052', customer: id('91'), daysAgo: 1 });
  await pay(photo, 'card', 15360, 960, 'approved', 'RR9001');
  await alloc(photo, VISHAL, 960);
  await snap(photo, id('71'), VISHAL, 960, 0); await snap(photo, id('72'), VISHAL, 960, 0);
  for (const num of ['1050', '1051']) { const t = await ticket({ tip: 0, subtotal: 5000, number: num, daysAgo: 2 }); await pay(t, 'card', 5000, 0); }
  // a cash tip, allocated and snapshotted once
  const cash = await ticket({ tip: 500, subtotal: 4000, number: '1053', tech: ANNA, chosen: 'cash', daysAgo: 2 });
  await pay(cash, 'cash', 4500, 500); await alloc(cash, ANNA, 500); await snap(cash, id('73'), ANNA, 0, 500);
  // three technicians share one $20 tip: 10 / 6 / 4
  trio = await ticket({ tip: 2000, subtotal: 20000, number: '1054', tech: ANNA, daysAgo: 3 });
  await pay(trio, 'card', 22000, 2000, 'approved', 'RR9004');
  await alloc(trio, ANNA, 1000); await alloc(trio, BAO, 600); await alloc(trio, CHI, 400);
  await snap(trio, id('74'), ANNA, 1000, 0); await snap(trio, id('75'), BAO, 600, 0); await snap(trio, id('76'), CHI, 400, 0);
  // a split-tender ticket: $15 tip on the ticket, the two tender rows carry 0 (Checkout writes a split that way)
  splitT = await ticket({ tip: 1500, subtotal: 10000, number: '1055', tech: BAO, daysAgo: 4 });
  await pay(splitT, 'card', 6500, 0, 'approved', 'RR9005'); await pay(splitT, 'cash', 5000, 0); await alloc(splitT, BAO, 1500);
  // a refunded tip: the $8 tip was reversed by a refund (compensation_adjustments, source refund)
  refunded = await ticket({ tip: 800, subtotal: 6000, number: '1056', tech: CHI, daysAgo: 5 });
  await pay(refunded, 'card', 6800, 800, 'approved', 'RR9006'); await alloc(refunded, CHI, 800);
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source) values ($1,$2,$3,$4,'tip_correction',-800,'Refund','posted','refund')`, [T, B, CHI, refunded]);
  // a tip inside a PAID payroll period (40 days ago) — paid out; and a manual re-split (nets to zero)
  paidOut = await ticket({ tip: 1200, subtotal: 9000, number: '1040', tech: VISHAL, daysAgo: 40 });
  await pay(paidOut, 'card', 10200, 1200, 'approved', 'RR9040'); await alloc(paidOut, VISHAL, 700); await alloc(paidOut, ANNA, 500);
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status, payout_status, paid_at) values ($1,$2,$3,'Sep 16–30', (now() - interval '50 days')::date, (now() - interval '35 days')::date, 'paid', 'paid', now() - interval '30 days')`, [id('81'), T, B]);
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source) values ($1,$2,$3,$5,'tip_correction',-500,'Anna did the pedicure','posted','manual'), ($1,$2,$4,$5,'tip_correction',500,'Anna did the pedicure','posted','manual')`, [T, B, VISHAL, ANNA, paidOut]);
  // removed / unpaid tickets are not eligible; another salon's tips are invisible
  await ticket({ tip: 9999, subtotal: 1000, number: '1099', removed: true }); await ticket({ tip: 9999, subtotal: 1000, number: '1098', status: 'ready_checkout' });
  const o = await ticket({ tenant: T2, branch: B2, tip: 7777, subtotal: 1000, number: '1052', customer: id('99') }); await pay(o, 'card', 8777, 7777, 'approved', 'RR9001', T2, B2);
});

describe('Tips & Gratuity — KPIs', () => {
  it('the photo reconciled: Total $9.60 + the other tips, card / cash by the payment rows, no-tip 2, the doubled snapshot flagged — not summed', async () => {
    const s = await r.summary(ctx, await month());
    expect(s.kpis.totalTipsCents).toBe(960 + 500 + 2000 + 1500 + 800);
    expect(s.kpis.cardTipsCents).toBe(960 + 2000 + 1500 + 800);   // the split ticket's tip follows its chosen method (card)
    expect(s.kpis.cashTipsCents).toBe(500);
    expect(s.kpis.noTipCount).toBe(2);
    expect(s.kpis.tippedTickets).toBe(5); expect(s.kpis.eligibleTickets).toBe(7); expect(s.kpis.splitTickets).toBe(0);
    expect(s.kpis.reversedCents).toBe(-800); expect(s.kpis.netTipsCents).toBe(5760 - 800);
    expect(s.reconciliation.allocatedCents).toBe(5760); expect(s.reconciliation.unallocatedCents).toBe(0); expect(s.reconciliation.balanced).toBe(true);
    expect(s.reconciliation.snapshotMismatchTickets).toBe(1);   // the photo's ticket: snapshot 1920 vs 960 collected
    expect(s.kpis.avgTipRatePct).toBe(Math.round((5760 / (14400 + 5000 + 5000 + 4000 + 20000 + 10000 + 6000)) * 1000) / 10);
    expect(s.kpis.avgTipPerTippedTicketCents).toBe(Math.round(5760 / 5));
  });
  it('the 3-technician $20 split allocates exactly $20 and the technician distribution never multiplies a tip', async () => {
    const d = await r.distribution(ctx, await month(), pr);
    const by = Object.fromEntries(d.items.map((x) => [x.technicianId, x]));
    expect(by[VISHAL].allocatedCents).toBe(960);   // NOT 1920
    expect(by[ANNA].allocatedCents).toBe(1000 + 500); expect(by[ANNA].cashCents).toBe(500); expect(by[ANNA].cardCents).toBe(1000);
    expect(by[BAO].allocatedCents).toBe(600 + 1500); expect(by[CHI].allocatedCents).toBe(400 + 800); expect(by[CHI].reversedCents).toBe(-800); expect(by[CHI].netCents).toBe(400);
    expect(d.totals.allocatedCents).toBe(5760);
    expect(d.items[0].technicianId).toBe(BAO);   // largest first
    expect(d.items.reduce((a, x) => a + x.sharePct, 0)).toBeGreaterThan(99);
    // Individual Technician Tipping 05 (round 10): the per-recipient reconciliation — every ticket's allocations add up here
    expect(d.items.every((x) => x.unreconciledTickets === 0)).toBe(true);
    expect(d.totals).toMatchObject({ allocatedCents: 5760, cardCents: d.items.reduce((a, x) => a + x.cardCents, 0), cashCents: d.items.reduce((a, x) => a + x.cashCents, 0), unreconciledTechnicians: 0 });
    expect(d.totals.cardCents + d.totals.cashCents).toBe(5760);
  });
  it('a paid-out tip: the payout state comes from the payroll period; manual corrections re-split and net to zero', async () => {
    const s = await r.summary(ctx, await all());
    expect(s.reconciliation.paidOutCents).toBe(1200); expect(s.reconciliation.manualCorrectionCents).toBe(0);
    const d = await r.detail(ctx, paidOut);
    expect(d.tip.payout.state).toBe('paid');
    const v = d.allocations.find((a) => a.technicianId === VISHAL)!, a = d.allocations.find((x) => x.technicianId === ANNA)!;
    expect(v.allocatedCents).toBe(700); expect(v.manualCorrectionCents).toBe(-500); expect(a.manualCorrectionCents).toBe(500);
    expect(d.adjustments.filter((x) => x.kind === 'correction').length).toBe(2);
  });
  it('extras TIPS 01: one technician\'s earnings overlay — own share per ticket, payout state + payroll period, totals reconcile with the Distribution row; unknown / other-salon technician is 404', async () => {
    for (const f of [await month(), await all()]) {
      const d = await r.distribution(ctx, f, { page: 1, pageSize: 50 });
      for (const tech of [VISHAL, ANNA, BAO, CHI]) {
        const row = d.items.find((x) => x.technicianId === tech)!;
        const e = await r.technicianEarnings(ctx, f, tech, { page: 1, pageSize: 50 });
        expect(e.totals.allocatedCents).toBe(row.allocatedCents); expect(e.totals.paidCents).toBe(row.paidOutCents); expect(e.totals.pendingCents).toBe(row.pendingCents);
        expect(e.totals.tickets).toBe(row.tickets); expect(e.totals.netCents).toBe(row.netCents);
        expect(e.totals.paidCents + e.totals.approvedCents + e.totals.openCents + e.totals.unscheduledCents).toBe(e.totals.allocatedCents);
        expect(e.items.reduce((a, x) => a + x.allocatedCents, 0)).toBe(e.totals.allocatedCents);
        expect(e.periods.reduce((a, x) => a + x.allocatedCents, 0)).toBe(e.totals.allocatedCents);
      }
    }
    const v = await r.technicianEarnings(ctx, await all(), VISHAL, { page: 1, pageSize: 50 });
    const paidRow = v.items.find((x) => x.ticketId === paidOut)!;
    expect(paidRow).toMatchObject({ payoutState: 'paid', allocatedCents: 700, period: { id: id('81'), label: 'Sep 16–30' } });
    expect(paidRow.sharedWith).toBeGreaterThanOrEqual(1);
    expect(v.periods.find((p) => p.id === id('81'))).toMatchObject({ state: 'paid', allocatedCents: 700, tickets: 1 });
    const b = await r.technicianEarnings(ctx, await month(), BAO, { page: 1, pageSize: 1 });
    expect(b.items).toHaveLength(1); expect(b.total).toBe(2); expect(b.pageCount).toBe(2);
    await expect(r.technicianEarnings(ctx, await all(), id('f9'), { page: 1, pageSize: 10 })).rejects.toMatchObject({ code: 'TIP_NOT_FOUND', status: 404 });   // the other salon's technician
    await expect(r.technicianEarnings(ctx, await all(), 'nope', { page: 1, pageSize: 10 })).rejects.toMatchObject({ code: 'TIP_NOT_FOUND' });
  });
});

describe('Tips & Gratuity — transactions, detail, search', () => {
  it('lists one row per tip event, newest first; the split ticket is one tip; refunds and payout states are shown apart', async () => {
    const t = await r.transactions(ctx, await month(), pr);
    expect(t.total).toBe(7); expect(t.items[0].ticketNumber).toBe('1052');
    const sp = t.items.find((x) => x.ticketNumber === '1055')!; expect(sp.amountCents).toBe(1500); expect(sp.tenders).toBe(2); expect(sp.method).toBe('card');
    const rf = t.items.find((x) => x.ticketNumber === '1056')!; expect(rf.reversedCents).toBe(-800); expect(rf.netCents).toBe(0);
    const ph = t.items.find((x) => x.ticketNumber === '1052')!; expect(ph.snapshotMismatch).toBe(true); expect(ph.snapshotCents).toBe(1920); expect(ph.allocationState).toBe('allocated');
    expect(ph.customer?.phone).toBe('(856) 555-1234');
    const masked = await r.transactions(desk, await month(), pr); expect(masked.items.find((x) => x.ticketNumber === '1052')!.customer?.phone).toBe('(•••) •••-1234');
  });
  it('status filters: no-tip tickets, snapshot mismatches, reversed, pending payout', async () => {
    expect((await r.transactions(ctx, await month({ status: 'no_tip' }), pr)).total).toBe(2);
    expect((await r.transactions(ctx, await month({ status: 'mismatch' }), pr)).items.map((x) => x.ticketNumber)).toEqual(['1052']);
    expect((await r.transactions(ctx, await month({ status: 'reversed' }), pr)).items.map((x) => x.ticketNumber)).toEqual(['1056']);
    expect((await r.transactions(ctx, await all({ status: 'paid_out' }), pr)).items.map((x) => x.ticketNumber)).toEqual(['1040']);
    expect((await r.transactions(ctx, await month({ method: 'cash' }), pr)).items.map((x) => x.ticketNumber)).toEqual(['1053']);
    expect((await r.transactions(ctx, await month({ technicianId: CHI }), pr)).items.map((x) => x.ticketNumber).sort()).toEqual(['1054', '1056']);
  });
  it('search: customer name, every phone format, technician, ticket #, payment reference, exact amount', async () => {
    const find = async (s: string) => (await r.transactions(ctx, await all({ search: s }), pr)).items.map((x) => x.ticketNumber);
    expect(await find('john sm')).toEqual(['1052']);
    for (const ph of ['(856) 555-1234', '856.555.1234', '+1 856 555 1234', '8565551234']) expect(await find(ph)).toEqual(['1052']);
    expect(await find('Chi Pham')).toEqual(['1054', '1056']);
    expect(await find('#1054')).toEqual(['1054']);
    expect(await find('RR9005')).toEqual(['1055']);
    expect(await find('$20.00')).toEqual(['1054']);
    expect(await find('nobody-here')).toEqual([]);
    // extras TIPS & GRATUITY 07 (round 10): each hit says how it matched — an exact reference (ticket #, phone, payment ref,
    // amount) ranks above a partial name / ticket-prefix match (order by rank desc)
    const how = async (s: string) => (await r.transactions(ctx, await all({ search: s }), pr)).items.map((x) => [x.ticketNumber, x.matchedBy]);
    expect(await how('#1054')).toEqual([['1054', 'reference']]);
    expect(await how('RR9005')).toEqual([['1055', 'reference']]);
    expect(await how('8565551234')).toEqual([['1052', 'reference']]);
    expect((await how('Chi Pham')).every(([, m]) => m === 'name')).toBe(true);
    const prefix = await how('105');   // no ticket is exactly 105: every 105x is a partial (prefix) match
    expect(prefix.length).toBeGreaterThan(1); expect(prefix.every(([n, m]) => String(n).startsWith('105') && m === 'name')).toBe(true);
  });
  it('detail: payments with their tip parts, each technician against the frozen snapshot, the split rule, the audit', async () => {
    const d = await r.detail(ctx, trio);
    expect(d.tip.amountCents).toBe(2000); expect(d.payments.length).toBe(1); expect(d.payments[0].tipCents).toBe(2000);
    expect(d.allocations.map((a) => a.allocatedCents)).toEqual([1000, 600, 400]); expect(d.allocations.every((a) => !a.snapshotMismatch)).toBe(true);
    expect(d.splitRule).toBe('weighted_or_directed'); expect(d.unallocatedCents).toBe(0);
    const p = await r.detail(ctx, photo); expect(p.allocations[0].snapshotCents).toBe(1920); expect(p.allocations[0].snapshotMismatch).toBe(true); expect(p.allocations[0].snapshotRows).toBe(2);
    expect(p.permissions.adjust).toBe(true);
  });
  it('adjustments view lists corrections and reversals by their own date; export is masked and audited', async () => {
    const a = await r.adjustments(ctx, await r.period(ctx, { preset: 'all' }), {}, pr);
    expect(a.total).toBe(3); expect(a.items.filter((x) => x.kind === 'reversal').length).toBe(1);
    const csv = await r.exportCsv(ctx, await all());
    expect(csv).toContain('Tip events,8'); expect(csv).not.toContain('+1856'); expect(csv).not.toContain('(856) 555-1234');
  });
  it('tenant isolation: another salon sees only its own tip; a foreign ticket id answers 404; paging is stable', async () => {
    const o = await r.summary(other, r.filters(await r.period(other, { preset: 'all' }), {}));
    expect(o.kpis.totalTipsCents).toBe(7777); expect(o.kpis.eligibleTickets).toBe(1);
    await expect(r.detail(other, photo)).rejects.toBeInstanceOf(FinanceError);
    const p1 = await r.transactions(ctx, await all(), { page: 1, pageSize: 3 }), p2 = await r.transactions(ctx, await all(), { page: 2, pageSize: 3 });
    expect(p1.pageCount).toBe(3); expect(new Set([...p1.items, ...p2.items].map((x) => x.ticketId)).size).toBe(6);
    expect(() => r.filters({ preset: 'all', from: null, to: null, tz: TZ, today: '2026-10-29' }, { minAmount: '50', maxAmount: '10' })).toThrow(FinanceError);
  });
  it('Individual Technician Tipping 05 (round 10): an allocation that no longer adds up to its ticket\'s collected tip marks every technician on that ticket as unreconciled', async () => {
    await q(`update ticket_tip_allocations set tip_cents = tip_cents + 50 where tenant_id = $1 and ticket_id = $2 and technician_id = $3`, [T, trio, CHI]);   // allocations now exceed the 3-technician ticket's $20
    const d = await r.distribution(ctx, await month(), pr);
    const by = Object.fromEntries(d.items.map((x) => [x.technicianId, x]));
    expect([by[ANNA].unreconciledTickets, by[BAO].unreconciledTickets, by[CHI].unreconciledTickets].every((n) => n >= 1)).toBe(true);
    expect(by[VISHAL].unreconciledTickets).toBe(0);  // not on that ticket
    expect(d.totals.unreconciledTechnicians).toBeGreaterThanOrEqual(3);
    await q(`update ticket_tip_allocations set tip_cents = tip_cents - 50 where tenant_id = $1 and ticket_id = $2 and technician_id = $3`, [T, trio, CHI]);
    expect((await r.distribution(ctx, await month(), pr)).totals.unreconciledTechnicians).toBe(0);
  });
});

// extras TIPS & GRATUITY 04 (round 10): a cash tip says WHERE it went — handed straight to the technician (the visit was
// settled by Cash to Technician and the technician CONFIRMED it) or collected into the drawer; card / cash stay as they are
describe('Tips & Gratuity — cash tip source labels', () => {
  it('drawer vs handed to the technician, per row and in the KPIs; a pending (unconfirmed) cash-to-technician is still drawer; card rows have no source', async () => {
    const tech = await ticket({ tip: 700, subtotal: 3000, number: '1060', tech: BAO, chosen: 'cash', daysAgo: 1 });
    await pay(tech, 'cash', 3700, 700);
    await q(`insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, technician_id, amount_cents, status, confirmed_at) values ($1,$2,$3,$4,3700,'confirmed', now())`, [T, B, tech, BAO]);
    const pend = await ticket({ tip: 300, subtotal: 2000, number: '1061', tech: BAO, chosen: 'cash', daysAgo: 1 });
    await pay(pend, 'cash', 2300, 300);
    await q(`insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, technician_id, amount_cents, status) values ($1,$2,$3,$4,2300,'pending')`, [T, B, pend, BAO]);
    const rows = (await r.transactions(ctx, await month(), { page: 1, pageSize: 50 })).items;
    const by = (n: string) => rows.find((x) => x.ticketNumber === n)!;
    expect(by('1060')).toMatchObject({ cashCents: 700, cashSource: 'technician', cashToTechnicianCents: 700, cashDrawerCents: 0 });
    expect(by('1061')).toMatchObject({ cashCents: 300, cashSource: 'drawer', cashToTechnicianCents: 0, cashDrawerCents: 300 });
    expect(by('1053')).toMatchObject({ cashSource: 'drawer', cashDrawerCents: 500 });
    expect(by('1052')).toMatchObject({ cashCents: 0, cashSource: null });
    const k = (await r.summary(ctx, await month())).kpis;
    expect(k.cashToTechnicianTipsCents).toBe(700);
    expect(k.cashDrawerTipsCents + k.cashToTechnicianTipsCents).toBe(k.cashTipsCents);   // a split of the cash figure, never added to it
    const csv = await r.exportCsv(ctx, await month());
    expect(csv).toContain('Cash source'); expect(csv).toMatch(/1060[^\n]*technician/);
    expect((await r.summary(other, r.filters(await r.period(other, { preset: 'all' }), {}))).kpis.cashToTechnicianTipsCents).toBe(0);
  });
});
