// residual-eligible-expenses.vitest.spec.ts — which processor costs may be deducted before the residual split.
// The rule under test: nothing is deducted unless it is classified AND eligible, and nothing is silently dropped.
import { describe, it, expect } from 'vitest';
import { computeApplicableCosts, isEligible, RESIDUAL_EXPENSE_CATEGORIES } from './residual-eligible-expenses';

describe('the default eligible-expense list', () => {
  it('treats genuine pass-throughs as deductible', () => {
    for (const k of ['interchange', 'assessments', 'network_fees', 'authorization_fees', 'settlement_fees', 'pci_compliance']) {
      expect(isEligible(k), k).toBe(true);
    }
  });

  it('does NOT deduct losses, fines, or the platform’s own cost of doing business', () => {
    for (const k of ['chargeback_losses', 'fines_penalties', 'gateway_platform', 'equipment', 'marketing', 'support_labor', 'other']) {
      expect(isEligible(k), k).toBe(false);
    }
  });

  it('separates a chargeback FEE (deductible) from a chargeback LOSS (not)', () => {
    expect(isEligible('chargeback_fees')).toBe(true);
    expect(isEligible('chargeback_losses')).toBe(false);
  });

  it('defaults an unknown category to NOT deductible (silence never costs the salon money)', () => {
    expect(isEligible('mystery_fee')).toBe(false);
  });

  it('every catalog entry carries a reason a reviewer can read', () => {
    for (const c of RESIDUAL_EXPENSE_CATEGORIES) expect(c.note.length, c.key).toBeGreaterThan(20);
  });
});

describe('itemized costs → the single total the split engine deducts', () => {
  it('sums only the eligible lines and reports the excluded ones separately', () => {
    const r = computeApplicableCosts([
      { category: 'interchange', amountCents: 12_000 },
      { category: 'assessments', amountCents: 3_000 },
      { category: 'marketing', amountCents: 50_000 },
      { category: 'fines_penalties', amountCents: 9_000 },
    ]);
    expect(r.applicableCostsCents).toBe(15_000);
    expect(r.excludedCostsCents).toBe(59_000);
    expect(r.totalSubmittedCents).toBe(74_000);
  });

  it('an agreement override wins over the default, in BOTH directions', () => {
    const lines = [{ category: 'gateway_platform', amountCents: 5_000 }, { category: 'interchange', amountCents: 1_000 }];
    expect(computeApplicableCosts(lines).applicableCostsCents).toBe(1_000);
    expect(computeApplicableCosts(lines, { gateway_platform: true }).applicableCostsCents).toBe(6_000);
    expect(computeApplicableCosts(lines, { interchange: false }).applicableCostsCents).toBe(5_000 - 5_000); // interchange excluded → 0
  });

  it('an unrecognized category is NAMED and excluded, never silently deducted or dropped', () => {
    const r = computeApplicableCosts([{ category: 'mystery_fee', amountCents: 7_000 }]);
    expect(r.applicableCostsCents).toBe(0);
    expect(r.excludedCostsCents).toBe(7_000);
    expect(r.unknownCategories).toEqual(['mystery_fee']);
    expect(r.lines[0].known).toBe(false);
    expect(r.lines[0].reason).toMatch(/classified/i);
  });

  it('amounts are magnitudes — a negative cost still deducts its size, and cents stay integers', () => {
    const r = computeApplicableCosts([{ category: 'interchange', amountCents: -2_500 }, { category: 'assessments', amountCents: 10.6 }]);
    expect(r.applicableCostsCents).toBe(2_511);
  });

  it('junk amounts are skipped rather than poisoning the total with NaN', () => {
    const r = computeApplicableCosts([{ category: 'interchange', amountCents: Number.NaN }, { category: 'interchange', amountCents: 500 }]);
    expect(r.applicableCostsCents).toBe(500);
  });

  it('an empty submission deducts nothing', () => {
    expect(computeApplicableCosts([]).applicableCostsCents).toBe(0);
  });

  it('every line explains itself, so a deduction is never unattributable', () => {
    const r = computeApplicableCosts([{ category: 'interchange', amountCents: 100, note: 'Visa' }, { category: 'marketing', amountCents: 100 }]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ eligible: true, note: 'Visa' });
    expect(r.lines[1].eligible).toBe(false);
    for (const l of r.lines) expect(l.reason.length).toBeGreaterThan(10);
  });
});
