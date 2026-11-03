// split-payments-screen.pgtest — Split Payments mandate (Oct 29 2026), against the REAL schema: the canonical tickets
//   $100 = $60 card + $40 cash (1 ticket, 2 tenders, $0 due) · $120 = $70 card + a DECLINED $50 card (partially paid,
//   $50 due, the decline never a tender) · $80 = $30 gift card + $50 card (the gift ledger linked, no code) ·
//   $150 = $50 cash + $60 card + $40 gift card with a $20 tip (3 tenders, the tip once) · a $30 refund on one tender ·
//   a single-tender ticket (not listed) · another salon's split (invisible); search in every form; filters; paging;
//   a read error is an error (never a verified 0).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SplitPaymentsScreenRepository } from './split-payments-screen.repository';
import { FinanceError } from './finance-scope';

const P = 'b7c2d3e4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1'), REG = id('d1'), REG2 = id('d2');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.refund'] } as any;
const other = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let r: SplitPaymentsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const all = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'all' }), extra);
const pr = { page: 1, pageSize: 12 };
let n = 0;
async function ticket(o: { tenant?: string; branch?: string; total: number; tip?: number; number: string; customer?: string; daysAgo?: number; status?: string; register?: string | null; locked?: number | null }) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, locked_total_cents, ticket_number, checkout_register_id, paid_at, created_at)
    values ($1,$2,$3,$4,$5,$6,0,0,$7,$8,$9,$10,$11, case when $5 = 'paid' then now() - make_interval(days => $12) else null end, now() - make_interval(days => $12, mins => 20))`,
    // what Checkout writes: subtotal / total only at payment (0 before), the sales on the ticket's lines
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('99') : id('92')), o.status ?? 'paid', (o.status ?? 'paid') === 'paid' ? o.total - (o.tip ?? 0) : 0, (o.status ?? 'paid') === 'paid' ? o.total : 0, o.tip ?? 0, o.locked ?? null, o.number, o.register === undefined ? REG : o.register, o.daysAgo ?? 1]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$5,'Service',$4,45,$4,'completed')`,
    [o.tenant ?? T, o.branch ?? B, tid, o.total - (o.tip ?? 0), o.tenant ? id('8b') : id('8a')]);
  return tid;
}
async function pay(tid: string, method: string, amount: number, status = 'approved', ref: string | null = null, extra: { tenant?: string; branch?: string; surface?: string | null; last4?: string | null } = {}) {
  const pid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, payment_surface, card_last4, created_at) values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10, now() - interval '1 day' + make_interval(secs => $11))`,
    [pid, extra.tenant ?? T, extra.branch ?? B, tid, method, amount, status, ref, extra.surface ?? null, extra.last4 ?? null, n]);
  return pid;
}
let t100 = '', t120 = '', t80 = '', t150 = '', tRef = '', cardTender = '';

beforeAll(async () => {
  pg = await migratedPglite();
  r = new SplitPaymentsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','sp-pilot','SPP001','active'), ($2,'Other LLC','Other','sp-other','SPP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'tax', '{"enabled":false}'::jsonb)`, [T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Nails')`, [id('8c'), T, B, id('8d'), T2, B2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$7,'Service',45,1000), ($4,$5,$6,$8,'Service',45,1000)`, [id('8a'), T, B, id('8b'), T2, B2, id('8c'), id('8d')]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$3,$4,'Front Desk'), ($2,$3,$4,'Back Bar')`, [REG, REG2, T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com'), ($4,$2,$3,'Walk','In','Walk-in','+18565550000',null,null), ($5,$6,$7,'John','Smith','John Smith','+18565551234','(856) 555-1234',null)`, [id('91'), T, B, id('92'), id('99'), T2, B2]);

  t100 = await ticket({ total: 10000, number: '1042', customer: id('91'), daysAgo: 1 });
  cardTender = await pay(t100, 'card', 6000, 'approved', 'RR1042', { surface: 'cardpointe_terminal', last4: '4242' }); await pay(t100, 'cash', 4000, 'approved', null, { surface: 'cash' });
  t120 = await ticket({ total: 12000, number: '1043', status: 'ready_checkout', locked: 12000, daysAgo: 2 });
  await pay(t120, 'card', 7000, 'approved', 'RR1043'); await pay(t120, 'card', 5000, 'declined', null);
  t80 = await ticket({ total: 8000, number: '1044', daysAgo: 3 });
  await q(`insert into gift_cards (id, tenant_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,'GC-SECRETCODE','7719',5000,2000,5000,'active')`, [id('71'), T]);
  const gp = await pay(t80, 'gift_card', 3000, 'approved', null, { surface: 'pos' }); await pay(t80, 'card', 5000, 'approved', 'RR1044');
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, payment_id) values ($1,$2,$3,'redeem',3000,2000,$4,$5)`, [T, B, id('71'), t80, gp]);
  t150 = await ticket({ total: 15000, tip: 2000, number: '1045', customer: id('91'), daysAgo: 4, register: REG2 });
  await pay(t150, 'cash', 5000); await pay(t150, 'card', 6000, 'approved', 'RR1045'); await pay(t150, 'gift_card', 4000);
  // a $100 split with a $30 refund on the card tender (the original tender keeps its amount; the refund is its own row + ledger)
  tRef = await ticket({ total: 10000, number: '1046', daysAgo: 6 });
  const ct = await pay(tRef, 'card', 6000, 'approved', 'RR1046'); await pay(tRef, 'cash', 4000);
  await pay(tRef, 'card', 3000, 'refunded', 'RF1046');
  await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, reason, status, processor_refund_id, created_by_user_id) values ($1,$2,$3,$4,3000,'Customer unhappy with polish','refunded','RF1046',$5)`, [id('81'), T, B, ct, U]);
  // not listed: a single-tender ticket; invisible: another salon's split
  const single = await ticket({ total: 5000, number: '1047', daysAgo: 1 }); await pay(single, 'card', 5000, 'approved', 'RR1047');
  const o = await ticket({ tenant: T2, branch: B2, total: 9000, number: '1042', daysAgo: 1, register: null }); await pay(o, 'card', 5000, 'approved', 'RR1042', { tenant: T2, branch: B2 }); await pay(o, 'cash', 4000, 'approved', null, { tenant: T2, branch: B2 });
});

describe('Split Payments — KPIs and the one-row-per-ticket list', () => {
  it('the canonical tickets: one ticket each, counted once, tenders by their confirmed state, the breakdown adds up', async () => {
    const s = await r.summary(ctx, await all());
    expect(s.kpis.splitTickets).toBe(4);                                  // 1042, 1044, 1045, 1046 — 1043 has ONE confirmed tender
    expect(s.kpis.splitTotalCents).toBe(10000 + 8000 + 15000 + 10000);    // never $200 for the $100 ticket
    expect(s.kpis.avgTenders).toBe(Math.round(((2 + 2 + 3 + 2) / 4) * 10) / 10);
    expect(s.kpis.completedTickets).toBe(3); expect(s.kpis.outstandingTickets).toBe(1); expect(s.kpis.outstandingCents).toBe(5000);
    expect(s.kpis.refundedTickets).toBe(1); expect(s.kpis.tipsCents).toBe(2000);   // the $20 tip once, not per tender
    expect(s.kpis.byMethod).toEqual({ cashCents: 4000 + 5000 + 4000, cardCents: 6000 + 5000 + 6000 + 6000, giftCardCents: 3000 + 4000 });
    const l = await r.list(ctx, await all(), pr);
    expect(l.total).toBe(5); expect(l.items.map((x) => x.ticketNumber)).toEqual(['1042', '1043', '1044', '1045', '1046']);   // newest created first
    const a = l.items.find((x) => x.ticketNumber === '1042')!;
    expect(a).toMatchObject({ tenders: 2, totalCents: 10000, paidCents: 10000, balanceCents: 0, status: 'completed', methods: ['card', 'cash'] });
    expect(a.breakdown).toEqual({ totalCents: 10000, lines: [{ method: 'cash', cents: 4000 }, { method: 'card', cents: 6000 }], paidCents: 10000, refundedCents: 0, balanceCents: 0 });
    const b = l.items.find((x) => x.ticketNumber === '1043')!;
    expect(b).toMatchObject({ tenders: 1, failedAttempts: 1, totalCents: 12000, paidCents: 7000, balanceCents: 5000, status: 'partially_paid', qualifies: false });
    const c = l.items.find((x) => x.ticketNumber === '1045')!;
    expect(c).toMatchObject({ tenders: 3, totalCents: 15000, tipCents: 2000, status: 'completed' });
    expect(c.breakdown.lines).toEqual([{ method: 'cash', cents: 5000 }, { method: 'card', cents: 6000 }, { method: 'gift_card', cents: 4000 }]);
    const d = l.items.find((x) => x.ticketNumber === '1046')!;
    expect(d).toMatchObject({ status: 'partially_refunded', paidCents: 10000, refundedCents: 3000, balanceCents: 0 });
    expect(JSON.stringify(l)).not.toContain('SECRETCODE');
  });
  it('filters: status, method combination, register, due only, amount range', async () => {
    const nums = async (extra: Record<string, unknown>) => (await r.list(ctx, await all(extra), pr)).items.map((x) => x.ticketNumber);
    expect(await nums({ status: 'partially_paid' })).toEqual(['1043']);
    expect(await nums({ status: 'completed' })).toEqual(['1042', '1044', '1045']);
    expect(await nums({ methods: 'card_cash' })).toEqual(['1042', '1045', '1046']);
    expect(await nums({ methods: 'gift_card' })).toEqual(['1044', '1045']);
    expect(await nums({ methods: 'three_plus' })).toEqual(['1045']);
    expect(await nums({ methods: 'card_card' })).toEqual([]);
    expect(await nums({ register: REG2 })).toEqual(['1045']);
    expect(await nums({ due: '1' })).toEqual(['1043']);
    expect(await nums({ minAmount: '120', maxAmount: '150' })).toEqual(['1043', '1045']);
    expect(await nums({ sort: 'total_desc' })).toEqual(['1045', '1043', '1046', '1042', '1044']);   // equal totals: newest id first
    expect(await nums({ sort: 'tenders_desc' })).toEqual(['1045', '1042', '1044', '1046', '1043']);
  });
  it('search: name, every phone format, email, ticket #, processor reference, tender amount — one row per ticket', async () => {
    const find = async (s: string) => (await r.list(ctx, await all({ search: s }), pr)).items.map((x) => x.ticketNumber);
    expect(await find('john')).toEqual(['1042', '1045']);
    for (const ph of ['(856) 555-1234', '856.555.1234', '+1 856 555 1234', '8565551234']) expect(await find(ph)).toEqual(['1042', '1045']);
    expect(await find('john.smith@example.com')).toEqual(['1042', '1045']);
    expect(await find('#1044')).toEqual(['1044']); expect(await find('104')).toEqual(['1042', '1043', '1044', '1045', '1046']);
    expect(await find('RR1045')).toEqual(['1045']);
    expect(await find('$40.00')).toEqual(['1042', '1045', '1046']);   // a $40 tender on each
    expect(await find('nobody')).toEqual([]);
  });
});

describe('Split Payments — detail, isolation, errors', () => {
  it('detail: every tender attempt with method vs channel, state, reference, gift ledger link, refundable amount; the refund attributed to its tender', async () => {
    const d = await r.detail(ctx, tRef);
    expect(d.tenders.map((t) => [t.method, t.state, t.amountCents, t.refundedCents, t.refundableCents])).toEqual([['card', 'confirmed', 6000, 3000, 3000], ['cash', 'confirmed', 4000, 0, 4000]]);
    expect(d.reversalRows.length).toBe(1); expect(d.refunds[0]).toMatchObject({ amountCents: 3000, status: 'refunded', reason: 'Customer unhappy with polish' });
    expect(d.financials).toMatchObject({ totalCents: 10000, paidCents: 10000, refundedCents: 3000, balanceCents: 0 });
    const g = await r.detail(ctx, t80); const gift = g.tenders.find((t) => t.method === 'gift_card')!;
    expect(gift.giftCard).toMatchObject({ last4: '7719', cardId: id('71') }); expect(gift.giftCard!.ledgerEntryId).toBeTruthy(); expect(JSON.stringify(g)).not.toContain('SECRETCODE');
    const a = await r.detail(ctx, t100); expect(a.tenders[0]).toMatchObject({ channel: 'cardpointe_terminal', card: '••4242', processorRef: 'RR1042' });
    const p = await r.detail(ctx, t120); expect(p.tenders.map((t) => t.state)).toEqual(['confirmed', 'failed']); expect(p.ticket.status).toBe('partially_paid');
    expect(a.permissions.refund).toBe(true);
  });
  it('another salon sees only its own split; a foreign ticket id answers 404; paging is stable; a bad range is refused', async () => {
    const o = await r.summary(other, r.filters(await r.period(other, { preset: 'all' }), {}));
    expect(o.kpis.splitTickets).toBe(1); expect(o.kpis.splitTotalCents).toBe(9000);
    await expect(r.detail(other, t100)).rejects.toBeInstanceOf(FinanceError);
    const p1 = await r.list(ctx, await all(), { page: 1, pageSize: 2 }), p2 = await r.list(ctx, await all(), { page: 2, pageSize: 2 }), p3 = await r.list(ctx, await all(), { page: 3, pageSize: 2 });
    expect(p1.pageCount).toBe(3); expect(new Set([...p1.items, ...p2.items, ...p3.items].map((x) => x.ticketId)).size).toBe(5);
    expect(() => r.filters({ preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' }, { minAmount: '50', maxAmount: '10' })).toThrow(FinanceError);
    const csv = await r.exportCsv(ctx, await all()); expect(csv).toContain('Tickets,5'); expect(csv).not.toContain('(856) 555-1234'); expect(csv).toContain('150.00');
  });
});
