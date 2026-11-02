import { describe, it, expect } from 'vitest';
import { computeTieredCommission, validateTiers, type TierBand } from './compensation-tiered';

// $0–$4000 → 50%, $4000–$6000 → 55%, $6000+ → 60%
const bands: TierBand[] = [
  { uptoCents: 400000, ratePercent: 50 },
  { uptoCents: 600000, ratePercent: 55 },
  { uptoCents: null, ratePercent: 60 },
];

describe('computeTieredCommission — entire-period', () => {
  it('$3000 lands in band 1 → 50% of the whole', () => {
    expect(computeTieredCommission(300000, bands, 'entire')).toEqual({ commissionCents: 150000, effectiveRatePercent: 50 });
  });
  it('$5000 lands in band 2 → 55% of the whole', () => {
    expect(computeTieredCommission(500000, bands, 'entire')).toEqual({ commissionCents: 275000, effectiveRatePercent: 55 });
  });
  it('$7000 lands in the top band → 60% of the whole', () => {
    expect(computeTieredCommission(700000, bands, 'entire')).toEqual({ commissionCents: 420000, effectiveRatePercent: 60 });
  });
});

describe('computeTieredCommission — marginal (bracketed)', () => {
  it('$3000: entirely in band 1', () => {
    expect(computeTieredCommission(300000, bands, 'marginal')).toEqual({ commissionCents: 150000, effectiveRatePercent: 50 });
  });
  it('$5000: 400000@50% + 100000@55% = 255000 (differs from entire-period 275000)', () => {
    expect(computeTieredCommission(500000, bands, 'marginal')).toEqual({ commissionCents: 255000, effectiveRatePercent: 51 });
  });
  it('$7000: 400000@50% + 200000@55% + 100000@60% = 370000', () => {
    const r = computeTieredCommission(700000, bands, 'marginal');
    expect(r.commissionCents).toBe(370000);
    expect(r.effectiveRatePercent).toBeCloseTo(52.86, 1);
  });
  it('zero production → zero', () => {
    expect(computeTieredCommission(0, bands, 'marginal')).toEqual({ commissionCents: 0, effectiveRatePercent: 0 });
  });
});

describe('validateTiers', () => {
  it('accepts a well-formed ladder', () => { expect(validateTiers(bands)).toBeNull(); });
  it('rejects an empty ladder', () => { expect(validateTiers([])).toMatch(/at least one/); });
  it('rejects an out-of-range rate', () => { expect(validateTiers([{ uptoCents: 400000, ratePercent: 120 }])).toMatch(/between 0 and 100/); });
  it('rejects duplicate bounds', () => { expect(validateTiers([{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 400000, ratePercent: 55 }])).toMatch(/strictly increase/); });
  it('rejects more than one open-ended band', () => { expect(validateTiers([{ uptoCents: null, ratePercent: 50 }, { uptoCents: null, ratePercent: 60 }])).toMatch(/top band/); });
});
