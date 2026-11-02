// transactions-screen.pgtest — Transactions mandate (Oct 29 2026), against the REAL schema:
//   the screenshot drill: three card tenders $63.16 + $53.27 + $51.72 (a split's 'partial' tender) = Gross $168.15, the
//   tickets' tips $4.00 + $3.60 + $2.00 = $9.60 counted once each, Net $168.15 (nothing refunded — correct, not a bug);
//   a split ticket ($60 card + $40 cash, ONE $10 tip, two technicians) counts two tenders and the tip once; a completed $15
//   refund lowers Net (a pending $5 does not); a voided tender and a declined attempt are listed, never counted; the
//   reversal rows Checkout writes are never tenders; the salon's day (a payment at 11:30 PM on Sep 30 is not October);
//   search by name / three phone formats / email / ticket / payment id / processor ref / technician / amount; filters;
//   newest-first paging past page 1; detail with the ticket, refunds and the settlement only when linked; other salon invisible.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TransactionsScreenRepository } from './transactions-screen.repository';
import { FinanceError } from './finance-scope';

const P = 'e7a1b2c3-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1');
const TA = id('71'), TB = id('72');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.refund', 'pos.reports.export', 'pos.receipts.send'] } as any;
const frontDesk = { ...ctx, role: 'FRONT_DESK', permissions: ['pos.checkout.view'] } as any;
const other = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let r: TransactionsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const oct = async (extra: Record<string, unknown> = {}, c = ctx) => r.filters(await r.period(c, { preset: 'custom', from: '2026-10-01', to: '2026-10-31' }), extra);
const day = async (d: string, extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'custom', from: d, to: d }), extra);
const pr = { page: 1, pageSize: 12 };
let n = 0;
async function ticket(num: string, o: { total: number; tip: number; customer?: string | null; at: string; tenant?: string; branch?: string; tech?: string | null }) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at, primary_technician_id) values ($1,$2,$3,$4,'paid',$5,0,0,$5,$6,$7,$8,$8,$9)`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('95') : id('94')), o.total, o.tip, num, o.at, o.tech ?? null]);
  return tid;
}
async function pay(tid: string, method: string, amount: number, tip: number, at: string, o: { status?: string; ref?: string | null; tenant?: string; branch?: string; settlement?: string | null } = {}) {
  const pid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor, processor_transaction_id, settlement_batch_id, card_brand, card_last4, created_at, approved_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14)`,
    [pid, o.tenant ?? T, o.branch ?? B, tid, method, amount, tip, o.status ?? 'approved', method === 'card' ? 'cardpointe' : null, o.ref ?? null, o.settlement ?? null, method === 'card' ? 'VISA' : null, method === 'card' ? '4242' : null, at, ['approved', 'partial'].includes(o.status ?? 'approved') ? at : null]);
  return pid;
}
const ids: Record<string, string> = {};

beforeAll(async () => {
  pg = await migratedPglite();
  r = new TransactionsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tx-pilot','TXP001','active'), ($2,'Other LLC','Other','tx-other','TXP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values
    ($1,$3,$4,'John','Smith','John Smith','+18565551234','john.smith@example.com'), ($2,$3,$4,'John','Smith','John Smith','+16095550000',null), ($5,$6,$7,'John','Smith','John Smith','+18565551234',null), ($8,$3,$4,'Walk','In','Walk-in',null,null), ($9,$6,$7,'Walk','In','Walk-in',null,null)`, [id('91'), id('92'), T, B, id('93'), T2, B2, id('94'), id('95')]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Anna','Nguyen','Anna Nguyen'), ($2,$3,$4,'Bao','Tran','Bao Tran')`, [TA, TB, T, B]);
  await q(`insert into payment_settlements (id, tenant_id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, status, settled_at) values ($1,$2,$3,'cardpointe','BATCH-88',6316,190,6126,'settled','2026-10-23T12:00:00Z')`, [id('61'), T, B]);

  // the screenshot (Oct 22): three card tenders, $9.60 of tips across the three tickets
  const s1 = await ticket('4001', { total: 5916, tip: 400, customer: id('91'), at: '2026-10-22T09:17:00Z', tech: TA });
  ids.s1 = await pay(s1, 'card', 6316, 400, '2026-10-22T09:17:00Z', { ref: 'RR4001', settlement: id('61') });
  const s2 = await ticket('4002', { total: 4967, tip: 360, customer: id('92'), at: '2026-10-22T13:40:00Z', tech: TB });
  ids.s2 = await pay(s2, 'card', 5327, 360, '2026-10-22T13:40:00Z', { ref: 'RR4002' });
  const s3 = await ticket('4003', { total: 7972, tip: 200, customer: null, at: '2026-10-22T15:05:00Z', tech: TA });
  ids.s3 = await pay(s3, 'card', 5172, 200, '2026-10-22T15:05:00Z', { status: 'partial', ref: 'RR4003' });
  ids.s3b = await pay(s3, 'card', 3000, 0, '2026-10-22T15:04:00Z', { status: 'declined' });   // the declined first attempt

  // Oct 20: a split ticket — $60 card (carries the $10 tip) + $40 cash, two technicians, ONE tip
  const sp = await ticket('4010', { total: 9000, tip: 1000, customer: id('91'), at: '2026-10-20T16:00:00Z', tech: TA });
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('81'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$3,$4,$5,'Gel Mani',45,5000), ($2,$3,$4,$5,'Pedicure',45,4000)`, [id('82'), id('83'), T, B, id('81')]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, technician_id, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$6,'Gel Mani',$4,5000,45,5000,'completed'), ($1,$2,$3,$7,'Pedicure',$5,4000,45,4000,'completed')`, [T, B, sp, TA, TB, id('82'), id('83')]);
  ids.spCard = await pay(sp, 'card', 6000, 1000, '2026-10-20T16:00:00Z', { ref: 'RR4010' });
  ids.spCash = await pay(sp, 'cash', 4000, 0, '2026-10-20T16:01:00Z');
  ids.spCash2 = await pay(sp, 'cash', 4000, 0, '2026-10-20T16:00:30Z', { status: 'pending' });
  // a $15 completed refund on the card tender (+ the reversal row Checkout writes) and a $5 still pending
  await pay(sp, 'card', 1500, 0, '2026-10-20T18:00:00Z', { status: 'refunded', ref: 'RF4010' });
  await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, reason, status, processor_refund_id, created_at, settled_at) values ($1,$2,$3,$4,1500,'Polish chipped','refunded','RF4010','2026-10-20T18:00:00Z','2026-10-20T18:00:00Z'), ($5,$2,$3,$4,500,'Goodwill','reserved',null,'2026-10-21T10:00:00Z',null)`, [id('f1'), T, B, ids.spCard, id('f2')]);
  // Oct 19: a $45 card tender voided before settlement (the original marked voided + the zero-amount void record)
  const vt = await ticket('4020', { total: 4500, tip: 0, customer: id('92'), at: '2026-10-19T14:00:00Z' });
  ids.void = await pay(vt, 'card', 4500, 0, '2026-10-19T14:00:00Z', { status: 'voided', ref: 'RR4020' });
  await pay(vt, 'card', 0, 0, '2026-10-19T14:05:00Z', { status: 'voided', ref: 'VD4020' });
  // the salon's day: 11:30 PM Sep 30 in New York is 03:30 UTC Oct 1 — NOT October
  const edge = await ticket('4030', { total: 2000, tip: 0, at: '2026-10-01T03:30:00Z' });
  ids.edge = await pay(edge, 'cash', 2000, 0, '2026-10-01T03:30:00Z');
  // 14 more cash tenders on Oct 5 for paging
  for (let i = 0; i < 14; i++) { const t = await ticket(String(4100 + i), { total: 1000 + i, tip: 0, at: `2026-10-05T${String(12 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00Z` }); await pay(t, 'cash', 1000 + i, 0, `2026-10-05T${String(12 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00Z`); }
  // another salon: a John Smith with the same phone and a tender on Oct 22
  const ot = await ticket('4001', { total: 9999, tip: 0, customer: id('93'), at: '2026-10-22T12:00:00Z', tenant: T2, branch: B2 });
  ids.other = await pay(ot, 'card', 9999, 0, '2026-10-22T12:00:00Z', { tenant: T2, branch: B2, ref: 'RR4001X' });
}, 120000);

describe('Transactions — the screenshot drill and the definitions', () => {
  it('Oct 22: 3 transactions, Gross $168.15, Tips $9.60, Net $168.15 — the declined attempt listed, not counted', async () => {
    const f = await day('2026-10-22');
    const s = await r.summary(ctx, f);
    expect(s.kpis).toEqual({ transactions: 3, grossCents: 16815, tipsCents: 960, netCents: 16815 });
    expect(s.context).toMatchObject({ tickets: 3, failed: 1, refundedCents: 0 });
    const l = await r.list(ctx, f, pr);
    expect(l.total).toBe(4);
    expect(l.items.map((x) => x.state)).toEqual(['completed', 'failed', 'completed', 'completed']);   // newest created first (the declined attempt came a minute before)
    expect(l.items[0]).toMatchObject({ id: ids.s3, ticketNumber: '4003', grossCents: 5172, rawStatus: 'partial', counted: true });
    expect(l.items[1]).toMatchObject({ id: ids.s3b, counted: false, netCents: 0 });
    expect(s.definitions.net).toMatch(/Equal to Gross when nothing was refunded/);
  });
  it('a split ticket counts two tenders and its tip ONCE; a completed refund lowers Net, a pending one does not; reversal rows are never tenders', async () => {
    const s = await r.summary(ctx, await day('2026-10-20'));
    expect(s.kpis).toEqual({ transactions: 2, grossCents: 10000, tipsCents: 1000, netCents: 8500 });
    expect(s.context).toMatchObject({ tickets: 1, refundedCents: 1500, refundPendingCents: 500, pending: 1 });
    const l = await r.list(ctx, await day('2026-10-20'), pr);
    expect(l.items.map((x) => x.id).sort()).toEqual([ids.spCard, ids.spCash, ids.spCash2].sort());
    expect(l.items.find((x) => x.id === ids.spCard)).toMatchObject({ state: 'partially_refunded', refundedCents: 1500, netCents: 4500, technicians: 'Anna Nguyen, Bao Tran' });
  });
  it('a voided tender is listed as voided at face value but never counted; the zero-amount void record is not a row', async () => {
    const l = await r.list(ctx, await day('2026-10-19'), pr);
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ id: ids.void, state: 'voided', grossCents: 4500, counted: false });
    expect((await r.summary(ctx, await day('2026-10-19'))).kpis).toEqual({ transactions: 0, grossCents: 0, tipsCents: 0, netCents: 0 });
  });
  it('the salon\'s day: 11:30 PM on Sep 30 (New York) is not in October', async () => {
    const l = await r.list(ctx, await oct({ search: '4030' }), pr);
    expect(l.total).toBe(0);
    const sep = await r.list(ctx, r.filters(await r.period(ctx, { preset: 'custom', from: '2026-09-30', to: '2026-09-30' }), {}), pr);
    expect(sep.items.map((x) => x.id)).toEqual([ids.edge]);
  });
  it('the whole month: KPIs over every matching tender, independent of the page', async () => {
    const s = await r.summary(ctx, await oct());
    const cash = Array.from({ length: 14 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0);
    expect(s.kpis.transactions).toBe(3 + 2 + 14);
    expect(s.kpis.grossCents).toBe(16815 + 10000 + cash);
    expect(s.kpis.netCents).toBe(16815 + 10000 + cash - 1500);
    expect(s.kpis.tipsCents).toBe(960 + 1000);
  });
});

describe('Transactions — search, filters, paging', () => {
  it('finds by name, by phone in three formats, by email — never the other salon\'s John Smith', async () => {
    const byName = await r.list(ctx, await oct({ search: 'john smith' }), pr);
    expect(byName.items.every((x) => x.customer?.name === 'John Smith')).toBe(true);
    expect(byName.items.some((x) => x.id === ids.other)).toBe(false);
    for (const phone of ['8565551234', '(856) 555-1234', '+1 856 555 1234']) {
      const l = await r.list(ctx, await oct({ search: phone }), pr);
      expect(l.items.map((x) => x.id).sort()).toEqual([ids.s1, ids.spCard, ids.spCash, ids.spCash2].sort());
    }
    expect((await r.list(ctx, await oct({ search: 'john.smith@example.com' }), pr)).total).toBe(4);
  });
  it('finds by ticket number, payment id, processor reference, refund reference, technician and exact amount', async () => {
    expect((await r.list(ctx, await oct({ search: '#4002' }), pr)).items.map((x) => x.id)).toEqual([ids.s2]);
    expect((await r.list(ctx, await oct({ search: ids.s1 }), pr)).items.map((x) => x.id)).toEqual([ids.s1]);
    expect((await r.list(ctx, await oct({ search: 'RR4003' }), pr)).items.map((x) => x.id)).toEqual([ids.s3]);
    expect((await r.list(ctx, await oct({ search: 'RF4010' }), pr)).items.map((x) => x.id)).toEqual([ids.spCard]);
    expect((await r.list(ctx, await oct({ search: '$53.27' }), pr)).items.map((x) => x.id)).toEqual([ids.s2]);
    const bao = await r.list(ctx, await oct({ search: 'bao' }), pr);
    expect(bao.items.map((x) => x.id).sort()).toEqual([ids.s2, ids.spCard, ids.spCash, ids.spCash2].sort());
    expect((await r.list(ctx, await oct({ technician: TB }), pr)).total).toBe(4);
  });
  it('status, method and amount filters; the KPIs keep counting money when the list is narrowed by status', async () => {
    expect((await r.list(ctx, await oct({ status: 'partially_refunded' }), pr)).items.map((x) => x.id)).toEqual([ids.spCard]);
    expect((await r.list(ctx, await oct({ method: 'card', status: 'completed' }), pr)).total).toBe(3);
    expect((await r.list(ctx, await oct({ minAmount: '50.00', maxAmount: '59.99' }), pr)).items.map((x) => x.id).sort()).toEqual([ids.s2, ids.s3].sort());
    expect(() => r.filters({ preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' } as any, { minAmount: '9', maxAmount: '1' })).toThrow(FinanceError);
    expect((await r.summary(ctx, await oct({ status: 'failed' }))).kpis.transactions).toBe(19);
  });
  it('pages on the server, newest created first, with a stable tie-break; page 2 continues page 1', async () => {
    const f = await oct();
    const p1 = await r.list(ctx, f, { page: 1, pageSize: 10 }), p2 = await r.list(ctx, f, { page: 2, pageSize: 10 });
    expect(p1.total).toBe(p2.total); expect(p1.pageCount).toBe(Math.ceil(p1.total / 10));
    const seen = [...p1.items, ...p2.items].map((x) => x.id);
    expect(new Set(seen).size).toBe(seen.length);
    const created = [...p1.items, ...p2.items].map((x) => x.createdAt!);
    expect([...created].sort().reverse()).toEqual(created);
    expect(p1.items[0].id).toBe(ids.s3);
    const big = await r.list(ctx, f, { page: 99, pageSize: 10 });
    expect(big.page).toBe(big.pageCount);   // clamped to the last page
  });
  it('the refunded date basis lists tenders by when they were refunded', async () => {
    const l = await r.list(ctx, r.filters(await r.period(ctx, { preset: 'custom', from: '2026-10-20', to: '2026-10-20' }), { dateField: 'refunded' }), pr);
    expect(l.items.map((x) => x.id)).toEqual([ids.spCard]);
  });
});

describe('Transactions — detail, privacy, isolation', () => {
  it('detail: the tender, its ticket (all tenders, lines, refunds), refundable balance, the settlement only when linked', async () => {
    const d = await r.detail(ctx, ids.spCard);
    expect(d.tender).toMatchObject({ grossCents: 6000, refundedCents: 1500, refundPendingCents: 500, refundableCents: 4000 });
    expect(d.refunds.map((x) => x.status).sort()).toEqual(['refunded', 'reserved']);
    expect(d.ticket?.tenders.map((x: any) => x.id).sort()).toEqual([ids.spCard, ids.spCash, ids.spCash2].sort());
    expect(d.ticket?.lines.map((x: any) => x.technician).sort()).toEqual(['Anna Nguyen', 'Bao Tran']);
    expect(d.settlement).toBeNull();
    expect(d.permissions).toMatchObject({ refund: true, sendReceipt: true });
    const s = await r.detail(ctx, ids.s1);
    expect(s.settlement).toMatchObject({ reference: 'BATCH-88', grossCents: 6316 });
    expect(s.ticket).toMatchObject({ ticketNumber: '4001', financials: { subtotalCents: 5916, tipCents: 400, paidCents: 6316, balanceCents: 0 } });   // a single-tender paid ticket has its ticket too
    await q(`update tickets set status = 'ready_checkout' where id = (select ticket_id from payments where id = $1)`, [ids.s3]);   // the split ticket is still at checkout
    expect((await r.detail(ctx, ids.s3)).ticket?.financials).toMatchObject({ paidCents: 5172, balanceCents: 7972 + 200 - 5172 });
    await q(`update tickets set status = 'paid' where id = (select ticket_id from payments where id = $1)`, [ids.s3]);
    expect((await r.detail(ctx, ids.void)).permissions.refund).toBe(false);
  });
  it('the front desk sees masked phones and no refund action', async () => {
    const l = await r.list(frontDesk, await oct({ search: 'RR4001' }, frontDesk), pr);
    expect(l.items[0].customer?.phone).toBe('(•••) •••-1234');
    expect((await r.detail(frontDesk, ids.s1)).permissions.refund).toBe(false);
  });
  it('another salon sees none of it — list, KPIs, detail', async () => {
    const f = await oct({}, other);
    expect((await r.list(other, f, pr)).items.map((x) => x.id)).toEqual([ids.other]);
    expect((await r.summary(other, f)).kpis.grossCents).toBe(9999);
    await expect(r.detail(other, ids.s1)).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    expect((await r.list(ctx, await oct({ search: 'RR4001X' }), pr)).total).toBe(0);
  });
  it('the export carries every matching tender, the totals and masked contact', async () => {
    const csv = await r.exportCsv(ctx, await day('2026-10-22'));
    expect(csv).toContain('Gross,168.15'); expect(csv).toContain('Tips (once per ticket),9.60');
    expect(csv).not.toContain('(856) 555-1234');
  });
});
