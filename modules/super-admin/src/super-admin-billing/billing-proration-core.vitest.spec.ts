import { describe, it, expect } from 'vitest';
import { computeProration, computeTrialExtension, TrialExtensionError } from './billing-proration-core';

describe('computeProration', () => {
  it('prorates an upgrade to a net charge for the remaining days', () => {
    // 30-day period, 15 days remaining, $99 → $199
    const p = computeProration({ oldMonthlyCents: 9900, newMonthlyCents: 19900, periodStart: '2026-05-01', periodEnd: '2026-05-31', effectiveDate: '2026-05-16' });
    expect(p.daysTotal).toBe(30); expect(p.daysRemaining).toBe(15);
    expect(p.creditCents).toBe(4950); expect(p.chargeCents).toBe(9950);
    expect(p.netCents).toBe(5000); // positive → charge now
  });
  it('prorates a downgrade to a net credit', () => {
    const p = computeProration({ oldMonthlyCents: 19900, newMonthlyCents: 9900, periodStart: '2026-05-01', periodEnd: '2026-05-31', effectiveDate: '2026-05-16' });
    expect(p.netCents).toBe(-5000); // negative → credit back
  });
  it('is zero when no days remain', () => {
    const p = computeProration({ oldMonthlyCents: 9900, newMonthlyCents: 19900, periodStart: '2026-05-01', periodEnd: '2026-05-31', effectiveDate: '2026-05-31' });
    expect(p.daysRemaining).toBe(0); expect(p.netCents).toBe(0);
  });
});

describe('computeTrialExtension', () => {
  it('adds days and returns an ISO date', () => {
    expect(computeTrialExtension('2026-05-10', 7, 0)).toBe('2026-05-17');
  });
  it('enforces the cumulative maximum and rejects non-positive input', () => {
    expect(() => computeTrialExtension('2026-05-10', 20, 15)).toThrow(TrialExtensionError);
    expect(() => computeTrialExtension('2026-05-10', 0, 0)).toThrow(/positive/);
  });
});
