// REFUNDS & VOIDS extras #03 — the smart duplicate warning on the ticket refund preview.
import { describe, it, expect } from 'vitest';
import { groupRefundEvents, possibleDuplicateRefunds } from './refund-duplicate-warning';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

describe('groupRefundEvents / possibleDuplicateRefunds (pure)', () => {
  it('per-tender rows written close together are ONE refund; rows far apart are separate', () => {
    const ev = groupRefundEvents([
      { paymentId: 'r2', method: 'cash', amountCents: 2000, createdAt: '2026-11-10T15:00:20Z' },
      { paymentId: 'r1', method: 'card', amountCents: 3000, createdAt: '2026-11-10T15:00:00Z' },
      { paymentId: 'r3', method: 'cash', amountCents: 500, createdAt: '2026-11-10T18:00:00Z' },
    ]);
    expect(ev).toEqual([
      { at: '2026-11-10T15:00:00Z', amountCents: 5000, methods: ['card', 'cash'], refundPaymentIds: ['r1', 'r2'] },
      { at: '2026-11-10T18:00:00Z', amountCents: 500, methods: ['cash'], refundPaymentIds: ['r3'] },
    ]);
  });
  it('only an equal amount is a possible duplicate; sameTenders says whether the tender mix also matches', () => {
    const ev = [{ at: 'a', amountCents: 5000, methods: ['card', 'cash'], refundPaymentIds: ['r1'] }, { at: 'b', amountCents: 500, methods: ['cash'], refundPaymentIds: ['r3'] }];
    expect(possibleDuplicateRefunds(ev, { amountCents: 5000, methods: ['cash', 'card'] })).toEqual([{ ...ev[0], sameTenders: true }]);
    expect(possibleDuplicateRefunds(ev, { amountCents: 500, methods: ['card'] })).toEqual([{ ...ev[1], sameTenders: false }]);
    expect(possibleDuplicateRefunds(ev, { amountCents: 501, methods: ['cash'] })).toEqual([]);
  });
});

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_1', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.refund', 'checkout.approve_refund'] } as any;
const TK = 'tk_2042';   // a seeded in-memory ticket
function setup() {
  const repo = new InMemoryCheckoutRepository();
  const P = (repo as any).P(ctx) as any[];
  const now = new Date().toISOString();
  P.push({ paymentId: 'pay_cash', ticketId: TK, method: 'cash', amountCents: 10000, tipCents: 0, status: 'approved', createdAt: now });
  return { repo, svc: new CheckoutService(repo) };
}

describe('refund preview names an earlier equal refund (warning only — the refund itself still runs)', () => {
  it('no earlier refund → no warning', async () => {
    const { svc } = setup();
    const p: any = await svc.refundAllocationPreview(ctx, TK, 2000);
    expect(p.earlierRefundCount).toBe(0);
    expect(p.possibleDuplicates).toEqual([]);
  });
  it('after a $20 refund, previewing $20 again warns; $15 does not; a second $20 is still allowed (not blocked)', async () => {
    const { svc, repo } = setup();
    await svc.refundTicket(ctx, TK, { amountCents: 2000, reason: 'Chipped polish' } as any);
    const p: any = await svc.refundAllocationPreview(ctx, TK, 2000);
    expect(p.earlierRefundCount).toBe(1);
    expect(p.possibleDuplicates).toHaveLength(1);
    expect(p.possibleDuplicates[0]).toMatchObject({ amountCents: 2000, methods: ['cash'], sameTenders: true });
    const q: any = await svc.refundAllocationPreview(ctx, TK, 1500);
    expect(q.possibleDuplicates).toEqual([]);
    const r: any = await svc.refundTicket(ctx, TK, { amountCents: 2000, reason: 'Second, genuine' } as any);
    expect(r).toMatchObject({ refundedCents: 2000, complete: true });
    expect(await repo.refundedTotalCents(ctx, 'pay_cash')).toBe(4000);
  });
});
