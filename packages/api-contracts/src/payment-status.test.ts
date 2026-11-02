import { describe, it, expect } from 'vitest';
import { REVENUE_BEARING_STATUSES, REFUND_STATUSES, REPORTABLE_PAYMENT_STATUSES, isRefundStatus } from './payment-status';

// Pins the canonical revenue classification so Overview and Reports can never drift apart again. The original bug:
// checkout writes captured payments as 'approved', but Overview filtered on 'completed' → Overview revenue read ~$0.
describe('payment-status (single source of truth)', () => {
  it('counts the statuses the checkout flow actually writes on capture', () => {
    expect(REVENUE_BEARING_STATUSES).toContain('approved'); // cash + card capture in checkout.service.ts
    expect(REVENUE_BEARING_STATUSES).toContain('paid');
    expect(REVENUE_BEARING_STATUSES).toContain('partial');  // split captures
  });
  it('never counts refunds or the (effectively unused) "completed" status as revenue', () => {
    expect(REVENUE_BEARING_STATUSES as readonly string[]).not.toContain('refunded');
    expect(REVENUE_BEARING_STATUSES as readonly string[]).not.toContain('completed');
  });
  it('classifies refunds / voids / reversals as refunds (case-insensitive)', () => {
    for (const s of ['refunded', 'voided', 'reversed', 'REFUND']) expect(isRefundStatus(s)).toBe(true);
    expect(isRefundStatus('approved')).toBe(false);
  });
  it('reportable set = revenue-bearing + refunds (what Reports loads, then splits by refund)', () => {
    expect([...REPORTABLE_PAYMENT_STATUSES].sort()).toEqual([...REVENUE_BEARING_STATUSES, ...REFUND_STATUSES].sort());
  });
});
