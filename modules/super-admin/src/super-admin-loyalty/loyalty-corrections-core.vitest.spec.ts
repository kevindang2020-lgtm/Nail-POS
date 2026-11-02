import { describe, it, expect } from 'vitest';
import { expectedBalance, differencePoints, correctionBucket, canCorrectionTransition } from './loyalty-corrections-core';

describe('loyalty corrections core', () => {
  it('expected balance is earned − redeemed', () => {
    expect(expectedBalance(5000, 4000)).toBe(1000);
    expect(expectedBalance(1000, 1200)).toBe(-200);
  });
  it('difference is signed expected − actual', () => {
    expect(differencePoints(1000, 800)).toBe(200);   // under-credited
    expect(differencePoints(1000, 1200)).toBe(-200);  // over-credited
  });
  it('bucket is stable per tenant/customer/type', () => {
    expect(correctionBucket('t', 'c', 'balance_mismatch')).toBe('t|c|balance_mismatch');
    expect(correctionBucket('t', null, 'negative_balance')).toBe('t|none|negative_balance');
  });
  it('enforces the correction workflow', () => {
    expect(canCorrectionTransition('detected', 'proposed')).toBe(true);
    expect(canCorrectionTransition('proposed', 'approved')).toBe(true);
    expect(canCorrectionTransition('approved', 'proposed')).toBe(false);   // terminal
    expect(canCorrectionTransition('rejected', 'approved')).toBe(false);
  });
});
