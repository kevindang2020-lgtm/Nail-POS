import { describe, it, expect } from 'vitest';
import { remainingCapacity, canReserve } from './deals-redemption-core';

describe('deals redemption capacity', () => {
  it('uncapped deals are unlimited', () => {
    expect(remainingCapacity(null, 100, 50)).toBeNull();
    expect(canReserve(null, 999, 999)).toBe(true);
  });
  it('remaining = cap - redeemed - active holds, floored at 0', () => {
    expect(remainingCapacity(10, 3, 2)).toBe(5);
    expect(remainingCapacity(5, 3, 2)).toBe(0);
    expect(remainingCapacity(5, 4, 3)).toBe(0); // never negative
  });
  it('canReserve only while capacity remains', () => {
    expect(canReserve(2, 1, 0)).toBe(true);
    expect(canReserve(2, 1, 1)).toBe(false); // 1 redeemed + 1 held = full
    expect(canReserve(2, 2, 0)).toBe(false);
  });
});
