// upsell-added-value-cap.vitest.spec.ts — Functional Decision 27: at most 2 suggestions; their added value normally
// ≤ 30% of the booked service subtotal, with a default hard cap of $30 — both configurable by the tenant.
import { describe, it, expect } from 'vitest';
import { PLATFORM_DEFAULTS, resolveSettings, effectiveAddedValueCapCents } from './ai-checkout-upsell-settings';
import { enforceAddedValueCap, recommendAddOns } from './ai-checkout-upsell-core';

const card = (type: string, targetId: string, priceCents: number): any => ({ type, targetId, title: targetId, description: '', priceCents, confidence: 'high', reason: '', eligible: true });
const addOn = (addOnId: string, priceCents: number, durationDeltaMinutes = 10): any => ({ addOnId, name: addOnId, priceCents, durationDeltaMinutes, isTaxable: false, isActive: true, sourceServiceId: 's', sourceServiceName: 'Gel' });

describe('Decision 27 defaults', () => {
  it('max 2 suggestions, $30 hard cap, 30% of the booked subtotal', () => {
    expect(PLATFORM_DEFAULTS.maxTotal).toBe(2);
    expect(PLATFORM_DEFAULTS.maxAddedValueCents).toBe(3000);
    expect(PLATFORM_DEFAULTS.maxAddedPercent).toBe(30);
  });
});

describe('effectiveAddedValueCapCents — the lower of the hard cap and the percentage', () => {
  const t = { maxAddedValueCents: 3000, maxAddedPercent: 30 };
  it('$50 booking → $15 (30%); $200 booking → $30 (the hard cap); nothing booked → the hard cap alone', () => {
    expect(effectiveAddedValueCapCents(t, 5000)).toBe(1500);
    expect(effectiveAddedValueCapCents(t, 20000)).toBe(3000);
    expect(effectiveAddedValueCapCents(t, 0)).toBe(3000);
  });
  it('the tenant can change both — and the settings resolver keeps them in safe ranges', () => {
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { tunables: { maxAddedValueCents: 5000, maxAddedPercent: 50 } } }).tunables;
    expect(effectiveAddedValueCapCents(eff, 20000)).toBe(5000);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { tunables: { maxAddedPercent: 400 } } }).tunables.maxAddedPercent).toBe(100);
  });
});

describe('enforceAddedValueCap — the TOTAL of add-on + product suggestions', () => {
  it('a $15 cap keeps $10 + skips $15 (would make $25) + keeps a later $5', () => {
    const out = enforceAddedValueCap([card('service_addon', 'a', 1000), card('service_addon', 'b', 1500), card('product', 'c', 500)], 1500);
    expect(out.map((c) => c.targetId)).toEqual(['a', 'c']);
  });
  it('memberships / gift cards / rebooking are not added value to THIS visit — the cap does not remove them', () => {
    const out = enforceAddedValueCap([card('membership', 'm', 5900), card('service_addon', 'a', 1000)], 1500);
    expect(out.map((c) => c.targetId)).toEqual(['m', 'a']);
  });
});

describe('recommendAddOns honours the TENANT cap (it used a hard-coded $30/30% constant)', () => {
  it('a tenant cap of $50 allows a $40 add-on on a $200 booking; the default would not', () => {
    const p = { candidates: [addOn('big', 4000)], cartAddOnIds: [], sameVisitFeasible: true, maxAddOns: 2, ticketSubtotalCents: 20000 };
    expect(recommendAddOns({ ...p, maxPriceCents: 5000 }).map((c) => c.targetId)).toEqual(['big']);
    expect(recommendAddOns({ ...p, maxPriceCents: 3000 })).toEqual([]);
  });
});
