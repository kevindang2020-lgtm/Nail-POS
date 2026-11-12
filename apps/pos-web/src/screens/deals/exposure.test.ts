import { describe, it, expect } from 'vitest';
import { exposure } from './exposure';

describe('exposure', () => {
  it('fixed off × uses left, capped per ticket', () => {
    expect(exposure({ discountType: 'fixed', discountCents: 1500, maxDiscountCents: 1000, maxRedemptions: 50, remaining: 20 })).toMatchObject({ perUse: 1000, usesLeft: 20, estimate: 20000, limitedBy: 'uses' });
  });
  it('the remaining budget wins when it is tighter', () => {
    expect(exposure({ discountType: 'percent', maxDiscountCents: 2000, maxRedemptions: 100, remaining: 100, budgetCents: 50000, savingsCents: 45000 })).toMatchObject({ byUses: 200000, budgetLeft: 5000, estimate: 5000, limitedBy: 'budget' });
  });
  it('no ceiling is reported, never guessed', () => {
    expect(exposure({ discountType: 'fixed', discountCents: 500, maxRedemptions: null })).toMatchObject({ usesLeft: null, estimate: null });
    expect(exposure({ discountType: 'percent', maxRedemptions: 10, remaining: 10 })).toMatchObject({ perUse: null, estimate: null });
  });
});
