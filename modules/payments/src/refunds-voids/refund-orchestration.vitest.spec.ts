// refund-orchestration.vitest.spec.ts — Functional Decision 20: proportional split-tender refund allocation.
import { describe, it, expect } from 'vitest';
import { calculateRefundAllocations } from './refund-orchestration';

const t = (paymentId: string, method: string, amountCents: number, refundedCents = 0, captured = true) => ({ paymentId, method, amountCents, refundedCents, captured });
const sum = (a: { amountToRefundCents: number }[]) => a.reduce((n, x) => n + x.amountToRefundCents, 0);

describe('calculateRefundAllocations (Decision 20)', () => {
  it("the decision's own example: $60 card + $40 cash, refund $50 → $30 card + $20 cash", () => {
    const a = calculateRefundAllocations(5000, [t('c', 'card', 6000), t('k', 'cash', 4000)]);
    expect(a).toEqual([{ paymentId: 'c', method: 'card', amountToRefundCents: 3000, action: 'refund' }, { paymentId: 'k', method: 'cash', amountToRefundCents: 2000, action: 'refund' }]);
  });
  it('odd cents: shares are whole cents and always sum exactly to the refund', () => {
    for (const total of [1, 2, 3, 7, 101, 3333, 9999]) {
      const a = calculateRefundAllocations(total, [t('a', 'card', 3333), t('b', 'cash', 3333), t('c', 'gift_card', 3334)]);
      expect(sum(a)).toBe(total);
      a.forEach((x) => expect(Number.isInteger(x.amountToRefundCents)).toBe(true));
    }
  });
  it('after an earlier partial refund, shares follow what each tender can STILL return — no tender exceeds its cap', () => {
    const a = calculateRefundAllocations(5000, [t('c', 'card', 6000, 3000), t('k', 'cash', 4000, 2000)]);   // remaining 3000 / 2000
    expect(a.map((x) => x.amountToRefundCents)).toEqual([3000, 2000]);
    expect(() => calculateRefundAllocations(5001, [t('c', 'card', 6000, 3000), t('k', 'cash', 4000, 2000)])).toThrow(/exceeds/);
  });
  it('a fully refunded tender takes no share; refunding the whole remainder refunds each tender exactly its remainder', () => {
    const a = calculateRefundAllocations(4000, [t('c', 'card', 6000, 6000), t('k', 'cash', 4000)]);
    expect(a).toEqual([{ paymentId: 'k', method: 'cash', amountToRefundCents: 4000, action: 'refund' }]);
  });
  it('an uncaptured tender is voided, a captured one refunded (Decision 19); nothing to refund → no allocations', () => {
    expect(calculateRefundAllocations(1000, [t('c', 'card', 1000, 0, false)])[0].action).toBe('void');
    expect(calculateRefundAllocations(0, [t('c', 'card', 1000)])).toEqual([]);
  });
});
