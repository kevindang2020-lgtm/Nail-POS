import { describe, it, expect } from 'vitest';
import { refundOutcome } from './refund-outcome';

const r = (o: Record<string, unknown>) => ({ status: 'redeemed', amount_discounted_cents: 2000, reversed_cents: 0, line_allocations: [{ lineId: 'a', cents: 1200 }, { lineId: 'b', cents: 800 }], ...o });
describe('refundOutcome — the one refund rule', () => {
  it('whole ticket or all discounted lines → reverse, place returned', () => {
    expect(refundOutcome(r({}), null)).toEqual({ kind: 'reverse', shareCents: 2000, nextReversedCents: 2000, placeReturned: true });
    expect(refundOutcome(r({}), ['a', 'b']).kind).toBe('reverse');
  });
  it('some lines → partial share, the place stays used; already-reversed cents are not counted twice', () => {
    expect(refundOutcome(r({}), ['a'])).toEqual({ kind: 'partial', shareCents: 1200, nextReversedCents: 1200, placeReturned: false });
    expect(refundOutcome(r({ status: 'partially_reversed', reversed_cents: 1200 }), ['b'])).toMatchObject({ kind: 'partial', shareCents: 800, nextReversedCents: 2000 });
  });
  it('unpaid ticket: whole void releases, a line refund keeps it; an untouched line changes nothing', () => {
    expect(refundOutcome(r({ status: 'applied' }), null).kind).toBe('release');
    expect(refundOutcome(r({ status: 'applied' }), ['a']).kind).toBe('keep');
    expect(refundOutcome(r({}), ['zzz']).kind).toBe('none');
  });
});
