import { describe, it, expect } from 'vitest';
import { computeReturnRatePercent } from './queue.dto';

describe('computeReturnRatePercent', () => {
  it('returns 0 when there are no identified customers', () => {
    expect(computeReturnRatePercent([], {})).toBe(0);
    expect(computeReturnRatePercent([{ customerId: null }, { customerId: undefined }], { x: 3 })).toBe(0);
  });

  it('counts customers with >=1 prior paid visit as returning', () => {
    // c1, c2 returning (visits > 0); c3, c4 new -> 50%
    const customers = [{ customerId: 'c1' }, { customerId: 'c2' }, { customerId: 'c3' }, { customerId: 'c4' }];
    const visits = { c1: 5, c2: 1, c3: 0 };
    expect(computeReturnRatePercent(customers, visits)).toBe(50);
  });

  it('dedupes the same customer appearing on multiple queue items', () => {
    const customers = [{ customerId: 'c1' }, { customerId: 'c1' }, { customerId: 'c2' }];
    const visits = { c1: 2 }; // c1 returning, c2 new -> 1 of 2 distinct = 50%
    expect(computeReturnRatePercent(customers, visits)).toBe(50);
  });

  it('rounds to a whole percent', () => {
    expect(computeReturnRatePercent([{ customerId: 'a' }, { customerId: 'b' }, { customerId: 'c' }], { a: 1 })).toBe(33);
    expect(computeReturnRatePercent([{ customerId: 'a' }, { customerId: 'b' }, { customerId: 'c' }], { a: 1, b: 4 })).toBe(67);
  });

  it('returns 100 when every queued customer is returning', () => {
    expect(computeReturnRatePercent([{ customerId: 'a' }, { customerId: 'b' }], { a: 3, b: 9 })).toBe(100);
  });
});
