import { describe, it, expect } from 'vitest';
import { evaluateBonus, evaluateBonuses, totalEarnedBonusCents, validateBonusRule, type BonusRule, type BonusFacts } from './compensation-bonus';

describe('evaluateBonus (§17, target-based)', () => {
  it('earns the amount when a money metric meets the target', () => {
    const rule: BonusRule = { label: 'Production $5k', metric: 'service_production', target: 500000, amountCents: 20000 };
    expect(evaluateBonus(rule, { serviceProductionCents: 520000 })).toMatchObject({ qualified: true, earnedCents: 20000, metricValue: 520000 });
  });

  it('earns nothing when below target', () => {
    const rule: BonusRule = { metric: 'service_production', target: 500000, amountCents: 20000 };
    expect(evaluateBonus(rule, { serviceProductionCents: 480000 })).toMatchObject({ qualified: false, earnedCents: 0 });
  });

  it('treats a missing fact as 0 (not qualified)', () => {
    expect(evaluateBonus({ metric: 'retail_sales', target: 10000, amountCents: 5000 }, {})).toMatchObject({ qualified: false, earnedCents: 0, metricValue: 0 });
  });

  it('works for count metrics (rebooking) and rating', () => {
    expect(evaluateBonus({ metric: 'rebooking_count', target: 20, amountCents: 3000 }, { rebookingCount: 22 }).qualified).toBe(true);
    expect(evaluateBonus({ metric: 'rating_avg', target: 4.5, amountCents: 2500 }, { ratingAvg: 4.6 }).qualified).toBe(true);
    expect(evaluateBonus({ metric: 'rating_avg', target: 4.5, amountCents: 2500 }, { ratingAvg: 4.4 }).qualified).toBe(false);
  });
});

describe('evaluateBonuses + total', () => {
  const rules: BonusRule[] = [
    { label: 'Production', metric: 'service_production', target: 500000, amountCents: 20000 },
    { label: 'Retail', metric: 'retail_sales', target: 100000, amountCents: 5000 },
    { label: 'Rebooking', metric: 'rebooking_count', target: 20, amountCents: 3000 },
  ];
  const facts: BonusFacts = { serviceProductionCents: 520000, retailSalesCents: 90000, rebookingCount: 25 };

  it('returns every rule with its qualified flag (transparent review)', () => {
    const out = evaluateBonuses(rules, facts);
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.qualified)).toEqual([true, false, true]); // retail missed target
  });

  it('totals only the earned bonuses', () => {
    expect(totalEarnedBonusCents(rules, facts)).toBe(23000); // 20000 + 3000; retail 0
  });
});

describe('validateBonusRule', () => {
  it('accepts a well-formed rule', () => { expect(validateBonusRule({ metric: 'service_production', target: 500000, amountCents: 20000 })).toBeNull(); });
  it('rejects an unknown metric', () => { expect(validateBonusRule({ metric: 'bogus' as any, target: 1, amountCents: 1 })).toMatch(/valid metric/); });
  it('rejects a negative target', () => { expect(validateBonusRule({ metric: 'retail_sales', target: -1, amountCents: 1 })).toMatch(/target/); });
  it('rejects a negative amount', () => { expect(validateBonusRule({ metric: 'retail_sales', target: 1, amountCents: -1 })).toMatch(/amount/); });
});
