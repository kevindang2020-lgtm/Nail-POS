// refunds-voids-screen.pgtest — Refunds & Voids mandate (Oct 29 2026), against the REAL schema:
//   #3001 $100 card: a completed $30 refund + a PENDING $20 reservation → $50 still refundable (never more);
//   #3002 $100 split, $60 card + $40 cash: a $30 refund on the CARD tender only (the cash tender keeps its $40);
//   #3003 $45 card VOIDED before settlement (the original marked voided + the zero-amount void record + the audit reason) —
//         one void at face value, never two rows;
//   #3004 a $25 refund whose processor answer was lost and the sweep could not decide → Needs review;
//   #3005 a refund the processor declined → Failed (kept; it does not lower the refundable balance);
//   #3006 a $20 gift-card refund restored onto the card (the gift ledger entry linked, never the code);
//   another salon's refund (invisible). Search in every form, Find Original Payment with eligibility, filters, paging.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RefundsVoidsScreenRepository } from './refunds-voids-screen.repository';
import { FinanceError } from './finance-scope';

const P = 'd9e2f3a4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.refund', 'pos.checkout.void', 'pos.reports.export'] } as any;
const other = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let r: RefundsVoidsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const all = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'all' }), extra);
const pr = { page: 1, pageSize: 12 };
let n = 0;
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, 12) + h * 3600_000).toISOString();
async function ticket(num: string, total: number, o: { tenant?: string; branch?: string; customer?: string; h: number }) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,$4,'paid',$5,0,0,$5,0,$6,$7,$7)`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('99') : id('92')), total, num, at(o.h)]);
  return tid;
}
async function pay(tid: string, method: string, amount: number, o: { status?: string; ref?: string | null; h: number; tenant?: string; branch?: string; settlement?: string | null; last4?: string | null }) {
  const pid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor, processor_transaction_id, settlement_batch_id, card_brand, card_last4, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [pid, o.tenant ?? T, o.branch ?? B, tid, method, amount, o.status ?? 'approved', method === 'card' ? 'cardpointe' : null, o.ref ?? null, o.settlement ?? null, o.last4 ? 'VISA' : null, o.last4 ?? null, at(o.h)]);
  return pid;
}
async function refund(paymentId: string, amount: number, status: string, o: { h: number; ref?: string | null; reason?: string; review?: string | null; tenant?: string; branch?: string; processor?: string | null; settled?: boolean }) {
  const rid = id('f' + String(++n).padStart(3, '0'));
  await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, processor_type, amount_cents, reason, status, processor_refund_id, created_by_user_id, created_at, review_reason, stranded_at, settled_at, settled_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [rid, o.tenant ?? T, o.branch ?? B, paymentId, o.processor ?? null, amount, o.reason ?? 'Customer request', status, o.ref ?? null, o.tenant ? null : U, at(o.h), o.review ?? null, o.review ? at(o.h + 1) : null, o.settled ? at(o.h) : null, o.settled ? 'live' : null]);
  return rid;
}
const ids: Record<string, string> = {};

beforeAll(async () => {
  pg = await migratedPglite();
  r = new RefundsVoidsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','rv-pilot','RVP001','active'), ($2,'Other LLC','Other','rv-other','RVP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','john.smith@example.com'), ($4,$2,$3,'Walk','In','Walk-in','+18565550000',null), ($5,$6,$7,'John','Smith','John Smith','+18565551234',null)`, [id('91'), T, B, id('92'), id('99'), T2, B2]);
  await q(`insert into payment_settlements (id, tenant_id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, status, settled_at) values ($1,$2,$3,'cardpointe','BATCH-77',10000,300,9700,'settled',$4)`, [id('71'), T, B, at(30)]);

  const t1 = await ticket('3001', 10000, { customer: id('91'), h: 0 });
  ids.p1 = await pay(t1, 'card', 10000, { ref: 'RR3001', h: 0, last4: '4242', settlement: id('71') });
  await pay(t1, 'card', 3000, { status: 'refunded', ref: 'RF3001', h: 2 });
  ids.r1 = await refund(ids.p1, 3000, 'refunded', { h: 2, ref: 'RF3001', processor: 'cardpointe', settled: true });
  ids.r1b = await refund(ids.p1, 2000, 'reserved', { h: 3, processor: 'cardpointe' });
  const t2 = await ticket('3002', 10000, { customer: id('91'), h: 4 });
  ids.p2card = await pay(t2, 'card', 6000, { ref: 'RR3002', h: 4 }); ids.p2cash = await pay(t2, 'cash', 4000, { h: 4 });
  await pay(t2, 'card', 3000, { status: 'refunded', ref: 'RF3002', h: 5 });
  ids.r2 = await refund(ids.p2card, 3000, 'refunded', { h: 5, ref: 'RF3002', processor: 'cardpointe', settled: true });
  const t3 = await ticket('3003', 4500, { h: 6 });
  ids.p3 = await pay(t3, 'card', 4500, { status: 'voided', ref: 'RR3003', h: 6 });
  await pay(t3, 'card', 0, { status: 'voided', ref: 'VD3003', h: 7 });
  await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json, created_at) values ($1,$2,$3,'OWNER','pos_checkout_void_created','pos_void',$4,$5::jsonb,$6)`,
    [T, B, U, ids.p3, JSON.stringify({ before: null, after: null, metadata: { reason: 'Wrong amount keyed', sandbox: false } }), at(7)]);
  const t4 = await ticket('3004', 2500, { customer: id('92'), h: 8 });
  ids.p4 = await pay(t4, 'card', 2500, { ref: 'RR3004', h: 8 });
  ids.r4 = await refund(ids.p4, 2500, 'processing', { h: 9, processor: 'cardpointe', review: 'processor_status_unavailable' });
  const t5 = await ticket('3005', 5000, { h: 10 });
  ids.p5 = await pay(t5, 'card', 5000, { ref: 'RR3005', h: 10 });
  ids.r5 = await refund(ids.p5, 5000, 'failed', { h: 11, processor: 'cardpointe' });
  const t6 = await ticket('3006', 2000, { h: 12 });
  await q(`insert into gift_cards (id, tenant_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,'GC-SECRETCODE','7719',5000,5000,5000,'active')`, [id('72'), T]);
  ids.p6 = await pay(t6, 'gift_card', 2000, { h: 12 });
  const rp6 = await pay(t6, 'gift_card', 2000, { status: 'refunded', h: 13 });
  ids.r6 = await refund(ids.p6, 2000, 'refunded', { h: 13, ref: rp6, settled: true });
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, payment_id, created_at) values ($1,$2,$3,'refund',2000,5000,$4,$5,$6)`, [T, B, id('72'), t6, rp6, at(13)]);
  // another salon: a $99 refund that must never appear
  const o = await ticket('3001', 9900, { tenant: T2, branch: B2, h: 1 });
  const op = await pay(o, 'card', 9900, { tenant: T2, branch: B2, ref: 'RR9999', h: 1 });
  await refund(op, 9900, 'refunded', { tenant: T2, branch: B2, h: 2, ref: 'RF9999' });
});

describe('Refunds & Voids — KPIs', () => {
  it('Refunds count completed only; Voids at face value once; Pending and Needs Review apart; Total Reversed adds without double counting', async () => {
    const s = await r.summary(ctx, await all());
    expect(s.kpis).toMatchObject({ refunds: 3, refundedCents: 3000 + 3000 + 2000, partialRefunds: 2, voids: 1, voidedCents: 4500, totalReversed: 4, totalReversedCents: 8000 + 4500,
      pending: 1, pendingCents: 2000, needsReview: 2, needsReviewCents: 2500 + 5000, unknown: 1, failed: 1 });
    expect(s.kpis.byMethod).toEqual({ cashCents: 0, cardCents: 6000, giftCardCents: 2000 });
    expect(s.permissions).toMatchObject({ refund: true, void: true, export: true });
  });
  it('a period with nothing is a verified zero', async () => {
    const s = await r.summary(ctx, r.filters(await r.period(ctx, { preset: 'custom', from: '2026-01-01', to: '2026-01-31' }), {}));
    expect(s.kpis).toMatchObject({ refunds: 0, refundedCents: 0, voids: 0, totalReversedCents: 0, pending: 0, needsReview: 0 });
  });
});

describe('Refunds & Voids — the ledger', () => {
  it('one row per reversal, newest first; types and states from the authoritative rows', async () => {
    const l = await r.list(ctx, await all(), pr);
    expect(l.total).toBe(7);
    expect(l.items.map((x) => [x.ticketNumber, x.type, x.state])).toEqual([
      ['3006', 'refund', 'completed'], ['3005', 'refund', 'failed'], ['3004', 'refund', 'needs_review'], ['3003', 'void', 'completed'],
      ['3002', 'partial_refund', 'completed'], ['3001', 'partial_refund', 'pending'], ['3001', 'partial_refund', 'completed']]);
    const v = l.items.find((x) => x.kind === 'void')!;
    expect(v).toMatchObject({ originalCents: 4500, reversedCents: 4500, reason: 'Wrong amount keyed', actor: 'Pat Owner', providerRef: 'VD3003' });
    const split = l.items.find((x) => x.ticketNumber === '3002')!;
    expect(split).toMatchObject({ paymentId: ids.p2card, originalCents: 6000, reversedCents: 3000, method: 'card' });   // the card tender, never the $100 ticket
  });
  it('type, status, method and amount filters and sorts go to the server', async () => {
    const t = async (x: Record<string, unknown>) => (await r.list(ctx, await all(x), pr)).items.map((i) => i.ticketNumber);
    expect(await t({ type: 'void' })).toEqual(['3003']);
    expect(await t({ status: 'needs_review' })).toEqual(['3004']);
    expect(await t({ method: 'gift_card' })).toEqual(['3006']);
    expect(await t({ minAmount: '40', maxAmount: '50' })).toEqual(['3005', '3003']);
    expect((await t({ sort: 'amount_desc' }))[0]).toBe('3005');
  });
  it('search: name, phone in any format, email, ticket #, provider / original reference, amount, ids — every page', async () => {
    const t = async (s: string) => (await r.list(ctx, await all({ search: s }), pr)).items.map((i) => i.ticketNumber).sort();
    expect(await t('john')).toEqual(['3001', '3001', '3002']);
    expect(await t('+1 856 555 1234')).toEqual(['3001', '3001', '3002']);
    expect(await t('john.smith@example.com')).toEqual(['3001', '3001', '3002']);
    expect(await t('#3004')).toEqual(['3004']);
    expect(await t('RF3002')).toEqual(['3002']);
    expect(await t('RR3003')).toEqual(['3003']);
    expect(await t('$45.00')).toEqual(['3003']);
    expect(await t(ids.r5)).toEqual(['3005']);
    expect(await t('RF9999')).toEqual([]);                                     // another salon's reference
  });
  it('another salon sees only its own refund', async () => {
    const l = await r.list(other, r.filters(await r.period(other, { preset: 'all' }), {}), pr);
    expect(l.items.map((x) => [x.ticketNumber, x.reversedCents])).toEqual([['3001', 9900]]);
  });
  it('pages are stable', async () => {
    const f = await all(); const a = await r.list(ctx, f, { page: 1, pageSize: 3 }), b = await r.list(ctx, f, { page: 2, pageSize: 3 }), c = await r.list(ctx, f, { page: 3, pageSize: 3 });
    expect(new Set([...a.items, ...b.items, ...c.items].map((x) => x.kind + x.id)).size).toBe(7); expect(a.pageCount).toBe(3);
  });
});

describe('Refunds & Voids — detail and Find Original Payment', () => {
  it('a refund detail shows the original tender with refunded, pending and remaining refundable ($100 − $30 − $20 = $50) and the settlement', async () => {
    const d = await r.detail(ctx, 'refund', ids.r1);
    expect(d.original).toMatchObject({ id: ids.p1, amountCents: 10000, refundedCents: 3000, pendingCents: 2000, refundableCents: 5000, settlementId: id('71') });
    expect(d.original!.eligibility).toMatchObject({ refund: true, void: false, voidWhy: 'already_refunded' });
    expect(d.refunds.map((x) => [x.amountCents, x.status, x.isThis])).toEqual([[2000, 'reserved', false], [3000, 'refunded', true]]);
  });
  it('a split ticket lists each tender with its own refundable amount', async () => {
    const d = await r.detail(ctx, 'refund', ids.r2);
    expect(d.tenders.map((x) => [x.method, x.amountCents, x.refundableCents, x.isOriginal])).toEqual([['card', 6000, 3000, true], ['cash', 4000, 4000, false]]);
  });
  it('a gift-card refund links its ledger entry (last four, never the code); a void shows its reason', async () => {
    const g = await r.detail(ctx, 'refund', ids.r6);
    expect(g.giftLedger).toEqual([expect.objectContaining({ type: 'refund', amountCents: 2000, balanceAfterCents: 5000, last4: '7719' })]);
    expect(JSON.stringify(g)).not.toContain('SECRETCODE');
    const v = await r.detail(ctx, 'void', ids.p3);
    expect(v.reversal).toMatchObject({ type: 'void', reason: 'Wrong amount keyed' }); expect(v.original!.eligibility).toMatchObject({ refund: false, refundWhy: 'not_captured' });
    await expect(r.detail(ctx, 'refund', id('ff'))).rejects.toBeInstanceOf(FinanceError);
    await expect(r.detail(other, 'refund', ids.r1)).rejects.toMatchObject({ code: 'REVERSAL_NOT_FOUND' });
  });
  it('find: by phone, ticket and reference; a settled card cannot be voided; a lost answer blocks a new refund; another salon is never found', async () => {
    const f = await r.find(ctx, '(856) 555-1234', await r.period(ctx, { preset: 'all' }));
    expect(f.items.map((x) => [x.ticketNumber, x.method, x.refundableCents])).toEqual([['3002', 'cash', 4000], ['3002', 'card', 3000], ['3001', 'card', 5000]]);
    const settled = f.items.find((x) => x.id === ids.p1)!; expect(settled.eligibility.voidWhy).toBe('already_refunded');
    expect(f.items.find((x) => x.id === ids.p2cash)!.eligibility).toMatchObject({ refund: true, void: false, voidWhy: 'not_card' });   // a void is for a card authorisation
    const lost = (await r.find(ctx, '#3004', await r.period(ctx, { preset: 'all' }))).items[0];
    expect(lost.eligibility).toMatchObject({ refund: false, refundWhy: 'pending_verification' });
    const fresh = (await r.find(ctx, 'RR3005', await r.period(ctx, { preset: 'all' }))).items[0];
    expect(fresh).toMatchObject({ refundableCents: 5000 }); expect(fresh.eligibility).toMatchObject({ refund: true, void: false, voidWhy: 'already_refunded' });   // the failed refund held nothing; Checkout's void still refuses any refund row
    expect((await r.find(ctx, 'RR9999', await r.period(ctx, { preset: 'all' }))).items).toEqual([]);
    const viewer = { ...ctx, permissions: ['pos.checkout.view'] };
    expect((await r.find(viewer, 'RR3005', await r.period(ctx, { preset: 'all' }))).items[0].eligibility).toMatchObject({ refund: false, refundWhy: 'permission', void: false });
  });
  it('the CSV carries every matching reversal with masked contact and no card data', async () => {
    const csv = await r.exportCsv(ctx, await all());
    expect(csv.split('\n').filter((l) => /^"?[0-9a-f]{8}-/.test(l)).length).toBe(7);
    expect(csv).not.toContain('4242'); expect(csv).not.toContain('555-1234');
  });
});
