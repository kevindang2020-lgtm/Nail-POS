// membership-controls-core.ts — pure validation/normalization for the Platform Membership Controls (gating, limits,
// rules, templates). No I/O. Guards platform guardrails so a bad config can't be persisted. Money is integer cents.

export const BILLING_INTERVALS = ['week', 'month', 'quarter', 'year'] as const;
export const PRODUCT_TYPES = ['nail', 'spa', 'premium', 'family', 'other'] as const;
export const BENEFIT_TYPES = ['service_credit', 'product_discount', 'included_service', 'priority_booking', 'other'] as const;

export type Check<T> = { ok: boolean; errors: string[]; value: T };
const intIn = (v: unknown, min: number, max: number): number | null => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };

export function validateLimits(input: any): Check<Record<string, number>> {
  const errors: string[] = []; const value: Record<string, number> = {};
  const fields: [string, number, number][] = [['maxProgramsPerTenant', 0, 1000], ['maxActiveMembersPerTenant', 0, 1_000_000], ['maxBenefitsPerProgram', 0, 100], ['maxTrialDays', 0, 365]];
  for (const [key, min, max] of fields) {
    const n = intIn(input?.[key], min, max);
    if (n == null) errors.push(`${key} must be an integer between ${min} and ${max}`); else value[key] = n;
  }
  return { ok: errors.length === 0, errors, value };
}

export function validateRules(input: any): Check<any> {
  const errors: string[] = [];
  const intervals = Array.isArray(input?.allowedBillingIntervals) ? input.allowedBillingIntervals.filter((x: any) => (BILLING_INTERVALS as readonly string[]).includes(x)) : [];
  if (intervals.length === 0) errors.push('allowedBillingIntervals must include at least one of: ' + BILLING_INTERVALS.join(', '));
  const maxDiscount = intIn(input?.maxDiscountPercent, 0, 100);
  if (maxDiscount == null) errors.push('maxDiscountPercent must be between 0 and 100');
  const value = {
    allowedBillingIntervals: intervals,
    allowTrials: !!input?.allowTrials,
    allowFamily: !!input?.allowFamily,
    requireAutoRenewConsent: !!input?.requireAutoRenewConsent,
    maxDiscountPercent: maxDiscount ?? 0,
  };
  return { ok: errors.length === 0, errors, value };
}

// Keep only known subscription-plan codes; coerce values to booleans.
export function normalizeGating(map: any, validPlanCodes: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const valid = new Set(validPlanCodes);
  for (const [code, on] of Object.entries(map ?? {})) if (valid.has(code)) out[code] = !!on;
  return out;
}

export function validateTemplate(input: any, maxTrialDays = 365, maxBenefits = 100, maxDiscountPercent = 100): Check<any> {
  const errors: string[] = [];
  const name = String(input?.name ?? '').trim();
  if (!name) errors.push('name is required');
  const productType = (PRODUCT_TYPES as readonly string[]).includes(input?.productType) ? input.productType : (errors.push('invalid productType'), 'other');
  const billingInterval = (BILLING_INTERVALS as readonly string[]).includes(input?.billingInterval) ? input.billingInterval : (errors.push('invalid billingInterval'), 'month');
  const priceCents = intIn(input?.priceCents, 0, 100_000_00);
  if (priceCents == null) errors.push('priceCents must be a non-negative integer');
  const intervalCount = intIn(input?.intervalCount ?? 1, 1, 24) ?? 1;
  const trialDays = intIn(input?.trialDays ?? 0, 0, maxTrialDays);
  if (trialDays == null) errors.push(`trialDays must be between 0 and ${maxTrialDays}`);
  const rawBenefits = Array.isArray(input?.benefits) ? input.benefits : [];
  if (rawBenefits.length > maxBenefits) errors.push(`too many benefits (max ${maxBenefits})`);
  const benefits = rawBenefits.map((b: any, i: number) => {
    const bt = (BENEFIT_TYPES as readonly string[]).includes(b?.benefitType) ? b.benefitType : (errors.push(`benefit ${i + 1}: invalid benefitType`), 'other');
    const valueCents = intIn(b?.valueCents ?? 0, 0, 100_000_00) ?? 0;
    const percent = intIn(b?.percent ?? 0, 0, maxDiscountPercent);
    if (percent == null) errors.push(`benefit ${i + 1}: percent must be between 0 and ${maxDiscountPercent}`);
    return { benefitType: bt, label: String(b?.label ?? '').slice(0, 200), creditsPerCycle: intIn(b?.creditsPerCycle ?? 0, 0, 1000) ?? 0, valueCents, percent: percent ?? 0 };
  });
  const value = { name, description: input?.description ? String(input.description).slice(0, 2000) : null, productType, billingInterval, intervalCount, priceCents: priceCents ?? 0, trialDays: trialDays ?? 0, benefits };
  return { ok: errors.length === 0, errors, value };
}
