import { describe, it, expect } from 'vitest';
import { computeThreeWaySplit, splitPercentsValid } from './revenue-split';

describe('computeThreeWaySplit', () => {
  it('reproduces the spec example exactly (gross $15,230.45, 60/15/25, refunds $185.20)', () => {
    const r = computeThreeWaySplit(1523045, { ai: 60, processor: 15, salon: 25 }, { refundsCreditsCents: 18520 });
    expect(r.aiShareCents).toBe(913827);            // $9,138.27
    expect(r.processorShareCents).toBe(228457);     // $2,284.57 (largest-remainder gives the leftover cent to Fiserv)
    expect(r.salonIncentiveShareCents).toBe(380761); // $3,807.61
    expect(r.netRevenueCents).toBe(895307);         // $8,953.07
    expect(r.reconciles).toBe(true);
  });

  it('always reconciles: shares sum to gross for many awkward values', () => {
    for (const gross of [1, 2, 3, 99, 100, 101, 333333, 1000001, 7777777]) {
      for (const pct of [{ ai: 60, processor: 15, salon: 25 }, { ai: 70, processor: 10, salon: 20 }, { ai: 65, processor: 35, salon: 0 }, { ai: 33.333, processor: 33.333, salon: 33.334 }]) {
        const r = computeThreeWaySplit(gross, pct);
        expect(r.aiShareCents + r.processorShareCents + r.salonIncentiveShareCents).toBe(gross);
        expect(r.reconciles).toBe(true);
      }
    }
  });

  it('never loses or creates pennies (leftover tracked in rounding adjustment)', () => {
    const r = computeThreeWaySplit(100, { ai: 33.333, processor: 33.333, salon: 33.334 });
    // 33/33/33 floors sum to 99 → 1 leftover cent redistributed
    expect(r.aiShareCents + r.processorShareCents + r.salonIncentiveShareCents).toBe(100);
    expect(r.roundingAdjustmentCents).toBe(1);
  });

  it('ai_absorbs policy routes all leftover to AI PowerSalon', () => {
    const r = computeThreeWaySplit(101, { ai: 33.333, processor: 33.333, salon: 33.334 }, { roundingPolicy: 'ai_absorbs' });
    expect(r.aiShareCents + r.processorShareCents + r.salonIncentiveShareCents).toBe(101);
  });

  it('two-party split (65/35/0) puts nothing to the salon', () => {
    const r = computeThreeWaySplit(1000000, { ai: 65, processor: 35, salon: 0 });
    expect(r.salonIncentiveShareCents).toBe(0);
    expect(r.aiShareCents + r.processorShareCents).toBe(1000000);
  });

  it('proportional refund allocation deducts only AI\u2019s proportional share from net', () => {
    const r = computeThreeWaySplit(1000000, { ai: 60, processor: 15, salon: 25 }, { refundsCreditsCents: 10000, refundAllocation: 'proportional' });
    // AI absorbs 60% of the 10000-cent refund = 6000
    expect(r.netRevenueCents).toBe(600000 - 6000);
  });

  it('signed adjustments adjust net', () => {
    const r = computeThreeWaySplit(1000000, { ai: 60, processor: 15, salon: 25 }, { adjustmentsCents: -5000 });
    expect(r.netRevenueCents).toBe(600000 - 5000);
  });

  it('splitPercentsValid enforces exact 100 total and non-negative', () => {
    expect(splitPercentsValid({ ai: 60, processor: 15, salon: 25 })).toBe(true);
    expect(splitPercentsValid({ ai: 70, processor: 10, salon: 20 })).toBe(true);
    expect(splitPercentsValid({ ai: 60, processor: 15, salon: 20 })).toBe(false); // 95
    expect(splitPercentsValid({ ai: -10, processor: 60, salon: 50 })).toBe(false);
  });
});

import { computeLayeredResidualSplit, layeredFromFlat } from './revenue-split';

describe('computeLayeredResidualSplit — the Schedule A two-layer model', () => {
  it('maps flat agreement pcts 40/35/25 onto layered 65/35/25 (tenant carved from the platform contractual share)', () => {
    expect(layeredFromFlat({ ai: 40, processor: 35, salon: 25 })).toEqual({ platformContractual: 65, processor: 35, tenantIncentive: 25 });
  });

  it('deducts applicable costs FIRST, then splits the net pool: $1,000 residual, $100 costs → 65/35 contractual, 25 carved → economic 40/35/25', () => {
    const r = computeLayeredResidualSplit(100000, layeredFromFlat({ ai: 40, processor: 35, salon: 25 }), { applicableCostsCents: 10000 });
    expect(r.netPoolCents).toBe(90000);                 // $900 net pool — the split never touches the raw gross
    expect(r.processorOwesPlatformCents).toBe(58500);   // $585 = 65% of net — what Fiserv remits to AI PowerSalon
    expect(r.processorRetainedCents).toBe(31500);       // $315 = 35% of net — Fiserv keeps
    expect(r.platformOwesTenantCents).toBe(22500);      // $225 = 25% of net — AI PowerSalon-managed tenant payable
    expect(r.platformRetainedCents).toBe(36000);        // $360 = 40% of net — carved: 65 − 25
    expect(r.contractualReconciles).toBe(true);
    expect(r.economicReconciles).toBe(true);
    expect(r.effectivePcts).toEqual({ platform: 40, processor: 35, tenant: 25 });
  });

  it('reconciles both layers to the exact cent on awkward amounts (net pool 101¢)', () => {
    const r = computeLayeredResidualSplit(101, layeredFromFlat({ ai: 40, processor: 35, salon: 25 }));
    expect(r.processorRetainedCents + r.processorOwesPlatformCents).toBe(101);
    expect(r.platformRetainedCents + r.processorRetainedCents + r.platformOwesTenantCents).toBe(101);
    expect(r.contractualReconciles && r.economicReconciles).toBe(true);
  });

  it('caps a misconfigured tenant share at the contractual share — never pays out money the platform was not owed', () => {
    const r = computeLayeredResidualSplit(10000, { platformContractual: 30, processor: 70, tenantIncentive: 45 });
    expect(r.platformOwesTenantCents).toBe(3000);       // capped at the 30% contractual share
    expect(r.platformRetainedCents).toBe(0);
    expect(r.tenantShareCapped).toBe(true);
    expect(r.economicReconciles).toBe(true);
  });

  it('handles a negative net pool (clawback period) with both layers still reconciling', () => {
    const r = computeLayeredResidualSplit(5000, layeredFromFlat({ ai: 40, processor: 35, salon: 25 }), { applicableCostsCents: 15000 });
    expect(r.netPoolCents).toBe(-10000);
    expect(r.processorRetainedCents + r.processorOwesPlatformCents).toBe(-10000);
    expect(r.platformRetainedCents + r.processorRetainedCents + r.platformOwesTenantCents).toBe(-10000);
    expect(r.platformOwesTenantCents).toBeLessThanOrEqual(0); // tenant shares the clawback, never profits from it
  });

  it('zero costs preserves the flat economics: layered on gross === flat 40/35/25 shares of gross', () => {
    const flat = computeThreeWaySplit(1523045, { ai: 40, processor: 35, salon: 25 });
    const layered = computeLayeredResidualSplit(1523045, layeredFromFlat({ ai: 40, processor: 35, salon: 25 }));
    expect(layered.netPoolCents).toBe(1523045);
    expect(layered.platformRetainedCents + layered.platformOwesTenantCents + layered.processorRetainedCents)
      .toBe(flat.aiShareCents + flat.salonIncentiveShareCents + flat.processorShareCents);
  });
});
