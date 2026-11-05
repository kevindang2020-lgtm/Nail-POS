// ai-plans.vitest.spec.ts — plan membership coverage + pricing math (pure).
import { describe, it, expect } from 'vitest';
import { AI_PLANS, AI_PLAN_CODES, getAiPlan, isAiPlanCode, planFullPriceCents, effectivePlanPriceCents, planCoverage, planForPackage, proratePlanPriceCents, planPeriodPriceCents } from './ai-plans';
import { AI_PACKAGES } from './ai-catalog';

describe('AI plans membership', () => {
  it('covers all 15 packages exactly once (no gaps, no overlap)', () => {
    const all = AI_PLANS.flatMap((p) => p.packageCodes);
    expect(all.length).toBe(15);
    expect(new Set(all).size).toBe(15);
    const cov = planCoverage();
    expect(cov.every((c) => c.planCode !== null)).toBe(true);
    expect(cov.length).toBe(AI_PACKAGES.length);
  });
  it('maps each package back to its plan', () => {
    expect(planForPackage('ai_booking_assistant')?.code).toBe('plan_booking_calls');
    expect(planForPackage('ai_inventory_assistant')?.code).toBe('plan_operations_insights');
    expect(planForPackage('nope')).toBeUndefined();
  });
  it('recognizes valid plan codes', () => {
    expect(AI_PLAN_CODES.length).toBe(5);
    expect(isAiPlanCode('plan_money_owner')).toBe(true);
    expect(isAiPlanCode('plan_nope')).toBe(false);
    expect(getAiPlan('plan_client_growth')?.name).toBe('Client & Growth');
  });
});

describe('AI plan pricing', () => {
  it('full price defaults to the sum of member packages', () => {
    expect(planFullPriceCents('plan_booking_calls')).toBe(14800);       // 4900 + 9900
    expect(planFullPriceCents('plan_checkin_queue')).toBe(9800);        // 5900 + 3900
    expect(planFullPriceCents('plan_client_growth')).toBe(18600);       // 3900+4900+5900+3900
    expect(planFullPriceCents('plan_money_owner')).toBe(15700);         // 6900+2900+5900
    expect(planFullPriceCents('plan_operations_insights')).toBe(18600); // 7900+3900+3900+2900
  });
  it('with no pricing override or discount, effective = full', () => {
    const r = effectivePlanPriceCents('plan_booking_calls');
    expect(r.fullCents).toBe(14800);
    expect(r.effectiveCents).toBe(14800);
    expect(r.discountCents).toBe(0);
  });
  it('applies a percent discount', () => {
    const r = effectivePlanPriceCents('plan_booking_calls', { discountType: 'percent', discountValue: 25 });
    expect(r.discountCents).toBe(3700); // 25% of 14800
    expect(r.effectiveCents).toBe(11100);
  });
  it('applies a flat discount, clamped to the full price', () => {
    expect(effectivePlanPriceCents('plan_checkin_queue', { discountType: 'flat', discountValue: 1900 }).effectiveCents).toBe(7900);
    expect(effectivePlanPriceCents('plan_checkin_queue', { discountType: 'flat', discountValue: 99999 }).effectiveCents).toBe(0);
  });
  it('honors a manual full-price override', () => {
    const r = effectivePlanPriceCents('plan_money_owner', { priceCentsOverride: 12900, discountType: 'percent', discountValue: 10 });
    expect(r.fullCents).toBe(12900);
    expect(r.discountCents).toBe(1290);
    expect(r.effectiveCents).toBe(11610);
  });
});

describe('AI plan proration', () => {
  it('splits an even discount cleanly across members', () => {
    const split = proratePlanPriceCents('plan_booking_calls', 11100); // 25% off 14800
    expect(split).toEqual([{ code: 'ai_booking_assistant', priceCents: 3675 }, { code: 'ai_phone_call_assistant', priceCents: 7425 }]);
  });
  it('always sums EXACTLY to the effective price, even with rounding remainders', () => {
    for (const code of AI_PLAN_CODES) {
      for (const eff of [0, 1, 7, 9999, 11101, 12345, planFullPriceCents(code)]) {
        const sum = proratePlanPriceCents(code, eff).reduce((s, x) => s + x.priceCents, 0);
        expect(sum).toBe(eff);
      }
    }
  });
  it('gives leftover cents to the largest fractional share', () => {
    const split = proratePlanPriceCents('plan_booking_calls', 11101); // remainder of 1 cent
    expect(split.reduce((s, x) => s + x.priceCents, 0)).toBe(11101);
    expect(split.find((x) => x.code === 'ai_phone_call_assistant')!.priceCents).toBe(7426); // larger member takes it
  });
});

describe('AI plan billing period', () => {
  it('monthly period = effective monthly price', () => {
    const r = planPeriodPriceCents('plan_booking_calls', undefined, 'monthly');
    expect(r.periodCents).toBe(14800);
    expect(r.monthlyEquivalentCents).toBe(14800);
    expect(r.annualSavingsCents).toBe(0);
  });
  it('yearly at 12 months = 12× monthly, no annual saving', () => {
    const r = planPeriodPriceCents('plan_booking_calls', undefined, 'yearly', 12);
    expect(r.periodCents).toBe(177600);
    expect(r.monthlyEquivalentCents).toBe(14800);
    expect(r.annualSavingsCents).toBe(0);
  });
  it('yearly with 2 months free (annualMonths=10) discounts the year and lowers MRR', () => {
    const r = planPeriodPriceCents('plan_booking_calls', undefined, 'yearly', 10);
    expect(r.periodCents).toBe(148000);                 // 10 × 14800
    expect(r.annualSavingsCents).toBe(29600);           // 2 × 14800
    expect(r.monthlyEquivalentCents).toBe(Math.round(148000 / 12)); // MRR contribution
  });
  it('annual pricing composes with a plan discount', () => {
    const r = planPeriodPriceCents('plan_booking_calls', { discountType: 'percent', discountValue: 25 }, 'yearly', 10);
    expect(r.effectiveMonthlyCents).toBe(11100);        // 25% off 14800
    expect(r.periodCents).toBe(111000);                 // 10 × 11100
  });
});
