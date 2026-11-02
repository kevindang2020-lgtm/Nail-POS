import { describe, it, expect } from 'vitest';
import { computeBalance, isPostableAmount, canDebit } from './wallet-ledger';

describe('wallet-ledger (pure)', () => {
  it('balance is the signed sum of integer-cent entries', () => {
    expect(computeBalance([])).toBe(0);
    expect(computeBalance([{ amountCents: 5000 }, { amountCents: -3500 }, { amountCents: 1000 }])).toBe(2500);
  });
  it('only positive whole-cent amounts are postable', () => {
    expect(isPostableAmount(1)).toBe(true);
    expect(isPostableAmount(0)).toBe(false);
    expect(isPostableAmount(-5)).toBe(false);
    expect(isPostableAmount(1.5)).toBe(false);
  });
  it('a debit is allowed only up to the available balance', () => {
    expect(canDebit(2500, 5000)).toBe(true);
    expect(canDebit(5000, 5000)).toBe(true);
    expect(canDebit(5001, 5000)).toBe(false);
    expect(canDebit(0, 5000)).toBe(false);
  });
});
