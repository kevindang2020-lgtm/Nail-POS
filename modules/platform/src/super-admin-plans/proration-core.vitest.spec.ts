import { describe, it, expect } from 'vitest';
import { classifyChange, computeProration } from './proration-core';

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse('2026-06-01T00:00:00Z');
const end = start + 30 * DAY;           // 30-day period
const day10 = start + 10 * DAY;         // 20 days (2/3) remaining

describe('classifyChange', () => {
  it('classifies initial / upgrade / downgrade / crossgrade', () => {
    expect(classifyChange(null, 9900)).toBe('initial');
    expect(classifyChange(9900, 19900)).toBe('upgrade');
    expect(classifyChange(19900, 9900)).toBe('downgrade');
    expect(classifyChange(9900, 9900)).toBe('crossgrade');
  });
});

describe('computeProration (decimal-safe, integer cents)', () => {
  it('credits unused old plan and charges prorated new plan for the remainder', () => {
    // upgrade pro/prem, 2/3 of period remaining
    const p = computeProration({ periodStartMs: start, periodEndMs: end, changeAtMs: day10, oldMonthlyCents: 9900, newMonthlyCents: 19900 });
    expect(p.creditCents).toBe(Math.round((9900 * 20) / 30)); // 6600
    expect(p.chargeCents).toBe(Math.round((19900 * 20) / 30)); // 13267
    expect(p.netCents).toBe(p.chargeCents - p.creditCents);    // 6667
    expect(p.netCents).toBeGreaterThan(0);
  });

  it('downgrade nets a credit back (negative net)', () => {
    const p = computeProration({ periodStartMs: start, periodEndMs: end, changeAtMs: day10, oldMonthlyCents: 19900, newMonthlyCents: 9900 });
    expect(p.netCents).toBe(p.chargeCents - p.creditCents);
    expect(p.netCents).toBeLessThan(0);
  });

  it('no proration at period end or with a non-positive period', () => {
    expect(computeProration({ periodStartMs: start, periodEndMs: end, changeAtMs: end, oldMonthlyCents: 9900, newMonthlyCents: 19900 }))
      .toMatchObject({ creditCents: 0, chargeCents: 0, netCents: 0 });
    expect(computeProration({ periodStartMs: end, periodEndMs: start, changeAtMs: day10, oldMonthlyCents: 9900, newMonthlyCents: 19900 }))
      .toMatchObject({ creditCents: 0, chargeCents: 0, netCents: 0 });
  });

  it('crossgrade (same price) nets zero', () => {
    const p = computeProration({ periodStartMs: start, periodEndMs: end, changeAtMs: day10, oldMonthlyCents: 9900, newMonthlyCents: 9900 });
    expect(p.netCents).toBe(0);
  });

  it('unknown old price (0) credits nothing and charges prorated new plan', () => {
    const p = computeProration({ periodStartMs: start, periodEndMs: end, changeAtMs: day10, oldMonthlyCents: 0, newMonthlyCents: 9900 });
    expect(p.creditCents).toBe(0);
    expect(p.chargeCents).toBe(Math.round((9900 * 20) / 30));
    expect(p.netCents).toBe(p.chargeCents);
  });
});
