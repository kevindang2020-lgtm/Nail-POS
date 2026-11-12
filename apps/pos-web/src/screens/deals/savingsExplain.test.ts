import { describe, it, expect } from 'vitest';
import { savingsExplain } from './savingsExplain';

describe('savingsExplain', () => {
  it('percent off: rule line, cap removal, recorded saving', () => {
    expect(savingsExplain({ discountType: 'percent', discountPercent: 20, maxDiscountCents: 1000 }, 8000, 1000))
      .toEqual({ eligible: 8000, rule: 1600, cap: 600, capKind: 'cap', expected: 1000, recorded: 1000, matches: true });
  });
  it('fixed off larger than the subtotal is limited to the subtotal', () => {
    expect(savingsExplain({ discountType: 'fixed', discountCents: 2500 }, 1800, 1800)).toMatchObject({ rule: 2500, cap: 700, capKind: 'subtotal', matches: true });
  });
  it('rounds like the server and flags a recorded saving that differs; no subtotal → nothing to explain', () => {
    expect(savingsExplain({ discountType: 'percent', discountPercent: 15 }, 3333, 400)).toMatchObject({ rule: 500, cap: null, expected: 500, matches: false });
    expect(savingsExplain({ discountType: 'percent', discountPercent: 15 }, null, 400)).toBeNull();
  });
});
