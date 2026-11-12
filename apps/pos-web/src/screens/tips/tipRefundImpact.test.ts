import { describe, it, expect } from 'vitest';
import { tipRefundImpact } from './tipRefundImpact';

const base = { collectedCents: 1000, reversedCents: 0, payoutState: 'open', allocations: [{ technicianId: 'a', name: 'An', netCents: 600 }, { technicianId: 'b', name: 'Bao', netCents: 400 }] };

describe('tipRefundImpact (Tips & Gratuity 05)', () => {
  it('a service-only refund leaves the tip, every allocation and payable untouched', () => {
    const r = tipRefundImpact(base, 'service_only');
    expect(r).toMatchObject({ tipReversed: false, collectedCents: 1000, netNowCents: 1000, netAfterCents: 1000, reversalCents: 0, posting: 'none' });
    expect(r.rows.map((x) => x.changeCents)).toEqual([0, 0]);
  });
  it('a refund that includes the tip reverses what each technician holds; the collected figure itself never changes', () => {
    const r = tipRefundImpact(base, 'full_with_tip');
    expect(r.rows.map((x) => [x.technicianId, x.changeCents, x.afterCents])).toEqual([['a', -600, 0], ['b', -400, 0]]);
    expect(r).toMatchObject({ collectedCents: 1000, netAfterCents: 0, reversalCents: -1000, posting: 'posted_now' });
  });
  it('a void always reverses; after a paid payroll period it lands in a future period pending approval', () => {
    expect(tipRefundImpact({ ...base, payoutState: 'paid' }, 'void')).toMatchObject({ tipReversed: true, posting: 'future_period_pending', reversalCents: -1000 });
  });
  it('a chargeback waits for review; earlier reversals are counted once and nothing goes below zero', () => {
    const r = tipRefundImpact({ collectedCents: 1000, reversedCents: -400, payoutState: 'open', allocations: [{ technicianId: 'a', name: null, netCents: 600 }, { technicianId: 'b', name: null, netCents: 0 }] }, 'chargeback');
    expect(r).toMatchObject({ netNowCents: 600, netAfterCents: 0, reversalCents: -600, posting: 'pending_review' });
    expect(r.rows[1]).toMatchObject({ changeCents: 0, afterCents: 0 });
  });
});

import { tipSourceLabel } from './tipSourceLabel';
describe('tipSourceLabel (Tips & Gratuity 10)', () => {
  const ok = { amountCents: 1000, allocationState: 'allocated', snapshotCents: 1000, snapshotMismatch: false, reversedCents: 0, manualCorrectionCents: 0 };
  it('verified only when collected, allocated and snapshot agree with no corrections', () => {
    expect(tipSourceLabel(ok)).toBe('verified');
    expect(tipSourceLabel({ ...ok, reversedCents: -200 })).toBe('adjusted');
    expect(tipSourceLabel({ ...ok, manualCorrectionCents: 100 })).toBe('adjusted');
  });
  it('pending when allocation or the snapshot is not there yet; review on a mismatch; nothing for a zero tip', () => {
    expect(tipSourceLabel({ ...ok, allocationState: 'partial' })).toBe('pending');
    expect(tipSourceLabel({ ...ok, snapshotCents: null })).toBe('pending');
    expect(tipSourceLabel({ ...ok, snapshotMismatch: true, reversedCents: -5 })).toBe('review');
    expect(tipSourceLabel({ ...ok, amountCents: 0 })).toBeNull();
  });
});
