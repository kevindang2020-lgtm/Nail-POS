import { describe, it, expect } from 'vitest';
import { mergeConfig, DEFAULT_CONFIG } from './loyalty-config.service';

describe('loyalty config merge/validate', () => {
  it('fills defaults for missing keys', () => {
    const c = mergeConfig(DEFAULT_CONFIG, {});
    expect(c.limits.maxPointsPerTxn).toBe(DEFAULT_CONFIG.limits.maxPointsPerTxn);
    expect(c.programTypes.points).toBe(true);
    expect(c.valuation.centsPerPoint).toBe(1);
  });

  it('applies and clamps a partial patch (never negative / out of range)', () => {
    const c = mergeConfig(DEFAULT_CONFIG, { limits: { maxPointsPerTxn: -50, minRedemptionThreshold: 250 }, expiration: { enabled: true, pointExpiryDays: 99999 }, valuation: { centsPerPoint: 3 } });
    expect(c.limits.maxPointsPerTxn).toBe(0);              // clamped up from negative
    expect(c.limits.minRedemptionThreshold).toBe(250);
    expect(c.expiration.enabled).toBe(true);
    expect(c.expiration.pointExpiryDays).toBe(3650);       // clamped to max
    expect(c.valuation.centsPerPoint).toBe(3);
  });

  it('toggles program types and plan features, ignoring malformed plan keys', () => {
    const c = mergeConfig(DEFAULT_CONFIG, { programTypes: { visit_based: true }, planFeatures: { starter: true, 'bad key!': true } });
    expect(c.programTypes.visit_based).toBe(true);
    expect(c.programTypes.points).toBe(true);              // untouched
    expect(c.planFeatures.starter).toBe(true);
    expect((c.planFeatures as any)['bad key!']).toBeUndefined();
  });
});
