import { describe, it, expect } from 'vitest';
import { allocationCheck } from './allocationCheck';

describe('allocationCheck', () => {
  it('exact cents across branches with percentages', () => {
    const c = allocationCheck([{ branchId: 'b1', amountCents: 6667 }, { branchId: 'b2', amountCents: 3333 }], 10000);
    expect(c).toMatchObject({ sumCents: 10000, diffCents: 0, exact: true }); expect(c.rows.map((r) => r.pct)).toEqual([66.7, 33.3]);
  });
  it('a stored split that does not reconcile is reported with the difference; junk rows are ignored', () => {
    expect(allocationCheck([{ branchId: 'b1', amountCents: 5000 }, { branchId: 'b2', amountCents: 4999 }, { nope: 1 }], 10000)).toMatchObject({ sumCents: 9999, diffCents: 1, exact: false });
  });
});
