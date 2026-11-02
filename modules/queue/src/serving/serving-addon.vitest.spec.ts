import { describe, it, expect } from 'vitest';
import { computeServingAddOnMetrics } from './serving.repository';

const L = (isAddOn: boolean, priceCents: number) => ({ serviceLineId: 'x', serviceId: 's', serviceName: 'n', priceCents, status: 'serving' as const, isAddOn, estDurationMin: 0 });

describe('computeServingAddOnMetrics', () => {
  it('no visit on the floor → no conversion number (Serving mandate §50: never a decorative 0 %)', () => {
    expect(computeServingAddOnMetrics([])).toEqual({ addOnAttachRatePercent: null, addOnRevenueCents: 0 });
  });

  it('computes attach rate (% of tickets with >=1 add-on) and total add-on revenue', () => {
    const tickets = [
      { lines: [L(false, 5000), L(true, 1500)] }, // has add-on, +1500
      { lines: [L(false, 6000)] },                 // no add-on
      { lines: [L(true, 2000), L(true, 1000)] },   // has add-on, +3000
      { lines: [] },                               // empty, no add-on
    ];
    const r = computeServingAddOnMetrics(tickets);
    expect(r.addOnRevenueCents).toBe(4500);
    expect(r.addOnAttachRatePercent).toBe(50); // 2 of 4 tickets carry an add-on
  });

  it('does not count add-on lines toward the attach numerator twice per ticket', () => {
    const tickets = [{ lines: [L(true, 1000), L(true, 1000)] }];
    const r = computeServingAddOnMetrics(tickets);
    expect(r.addOnAttachRatePercent).toBe(100);
    expect(r.addOnRevenueCents).toBe(2000);
  });
});
