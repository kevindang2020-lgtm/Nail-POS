import { describe, it, expect } from 'vitest';
import {
  netDepositCents, reconciliationDiffCents, diffSeverity, isUnresolvedDiscrepancy, depositTimingState,
  depositStatusDistribution, rollupKpis, fundingExceptionType, maskAccount, normalizeSettlementStatus,
  normalizeReconStatus, type BatchLike,
} from './settlements-core';

const batch = (o: Partial<BatchLike> = {}): BatchLike => ({
  grossCents: 2681235, refundsCents: 102540, chargebacksCents: 24500, feesCents: 56215, adjustmentsCents: 0,
  settlementStatus: 'settled', reconciliationStatus: 'reconciled', actualDepositCents: 2497980, expectedNetCents: 2497980, ...o,
});

describe('settlements-core money', () => {
  it('nets deposits with the documented sign convention (deductions subtracted, adjustments signed)', () => {
    // 26812.35 - 1025.40 - 245.00 - 562.15 + 0 = 24979.80
    expect(netDepositCents({ grossCents: 2681235, refundsCents: 102540, chargebacksCents: 24500, feesCents: 56215, adjustmentsCents: 0 })).toBe(2497980);
    // negative adjustment decreases; positive increases
    expect(netDepositCents({ grossCents: 1000, refundsCents: 0, chargebacksCents: 0, feesCents: 0, adjustmentsCents: -250 })).toBe(750);
    expect(netDepositCents({ grossCents: 1000, refundsCents: 0, chargebacksCents: 0, feesCents: 0, adjustmentsCents: 250 })).toBe(1250);
    // deductions passed as negatives are still treated as magnitudes (never silently double-signed)
    expect(netDepositCents({ grossCents: 1000, refundsCents: -100, chargebacksCents: 0, feesCents: 0, adjustmentsCents: 0 })).toBe(900);
  });

  it('computes a SIGNED reconciliation difference, null when actual is unknown', () => {
    expect(reconciliationDiffCents(2497980, 2497980)).toBe(0);
    expect(reconciliationDiffCents(2498112, 2497980)).toBe(132);       // overfunded +
    expect(reconciliationDiffCents(2497848, 2497980)).toBe(-132);      // underfunded −
    expect(reconciliationDiffCents(null, 2497980)).toBeNull();
  });

  it('classifies difference severity with tolerance bands (unknown → review, never exact)', () => {
    expect(diffSeverity(0)).toBe('exact');
    expect(diffSeverity(50)).toBe('rounding');
    expect(diffSeverity(132)).toBe('minor');
    expect(diffSeverity(-30000)).toBe('review');
    expect(diffSeverity(90000)).toBe('critical');
    expect(diffSeverity(null)).toBe('review');
  });

  it('only flags unresolved discrepancies (resolved/reconciled are cleared)', () => {
    expect(isUnresolvedDiscrepancy(132, 'in_review')).toBe(true);
    expect(isUnresolvedDiscrepancy(132, 'resolved')).toBe(false);
    expect(isUnresolvedDiscrepancy(0, 'in_review')).toBe(false);
    expect(isUnresolvedDiscrepancy(null, 'in_review')).toBe(false);
  });
});

describe('settlements-core timing', () => {
  const DAY = 86_400_000;
  it('never marks a deposit missing before the grace window elapses', () => {
    const exp = 1_000_000_000_000;
    expect(depositTimingState({ settlementStatus: 'settled', hasActualDeposit: true, expectedDateMs: exp, nowMs: exp + DAY })).toBe('confirmed');
    expect(depositTimingState({ settlementStatus: 'settled', hasActualDeposit: false, expectedDateMs: exp, nowMs: exp - DAY })).toBe('expected'); // before expected
    expect(depositTimingState({ settlementStatus: 'settled', hasActualDeposit: false, expectedDateMs: exp, nowMs: exp + DAY, graceBusinessDays: 1, businessDaysPastExpected: 1 })).toBe('delayed');
    expect(depositTimingState({ settlementStatus: 'settled', hasActualDeposit: false, expectedDateMs: exp, nowMs: exp + 3 * DAY, graceBusinessDays: 1, businessDaysPastExpected: 3 })).toBe('missing');
    expect(depositTimingState({ settlementStatus: 'failed', hasActualDeposit: false, expectedDateMs: exp, nowMs: exp + 3 * DAY })).toBe('failed');
  });
});

describe('settlements-core distributions & kpis', () => {
  it('deposit-status distribution reconciles to the total', () => {
    const d = depositStatusDistribution([{ settlementStatus: 'settled' }, { settlementStatus: 'settled' }, { settlementStatus: 'pending' }, { settlementStatus: 'delayed' }]);
    expect(d.total).toBe(4);
    expect(d.slices.reduce((a, s) => a + s.count, 0)).toBe(4);
    expect(d.slices.find((s) => s.status === 'settled')!.count).toBe(2);
    expect(d.slices.find((s) => s.status === 'settled')!.pct).toBe(50);
  });

  it('rolls up KPIs that reconcile to the rows', () => {
    const k = rollupKpis([
      batch(),
      batch({ settlementStatus: 'pending', actualDepositCents: null, reconciliationStatus: 'pending', expectedNetCents: 2211800 }),
      batch({ settlementStatus: 'settled', actualDepositCents: 1875772, expectedNetCents: 1875640, reconciliationStatus: 'in_review' }), // +132 unresolved
    ]);
    expect(k.totalBatches).toBe(3);
    expect(k.grossCents).toBe(2681235 * 3);
    expect(k.pendingDepositsCents).toBe(2211800);              // only the pending batch's expected
    expect(k.reconDiffCents).toBe(132);                        // only the unresolved in_review diff
    expect(k.feesCents).toBe(56215 * 3);
    expect(k.chargebackCents).toBe(24500 * 3);
  });

  it('categorizes funding exceptions', () => {
    expect(fundingExceptionType(batch({ settlementStatus: 'delayed' }))).toBe('delayed_deposit');
    expect(fundingExceptionType(batch({ settlementStatus: 'failed' }))).toBe('failed_deposit');
    expect(fundingExceptionType(batch({ actualDepositCents: 2600000, expectedNetCents: 2497980, reconciliationStatus: 'in_review' }))).toBe('large_difference');
    expect(fundingExceptionType(batch())).toBeNull();
  });
});

describe('settlements-core safety', () => {
  it('masks bank accounts to at most a 4-digit suffix', () => {
    expect(maskAccount('1234567890')).toBe('•••• 7890');
    expect(maskAccount('7890')).toBe('•••• 7890');
    expect(maskAccount(null)).toBeNull();
    expect(maskAccount('12')).toBeNull();
  });
  it('normalizes status vocab safely', () => {
    expect(normalizeSettlementStatus('In Review')).toBe('unknown');
    expect(normalizeSettlementStatus('partially settled')).toBe('partially_settled');
    expect(normalizeReconStatus('Discrepancy Found')).toBe('discrepancy_found');
    expect(normalizeReconStatus('nonsense')).toBe('not_started');
  });
});
