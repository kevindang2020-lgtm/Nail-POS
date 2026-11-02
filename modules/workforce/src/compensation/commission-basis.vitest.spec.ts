// commission-basis.vitest.spec.ts — THE commissionable base + the ONE per-line formula (Payroll mandate §17–§20, §176).
import { describe, it, expect } from 'vitest';
import { commissionableBaseCents, lineCommissionCents, PLATFORM_FALLBACK_COMMISSION_PERCENT } from './commission-basis';

describe('commissionableBaseCents', () => {
  it('is line_total_cents minus the line discount, never below zero, and zero for a removed line', () => {
    expect(commissionableBaseCents({ line_total_cents: 4500 })).toBe(4500);
    expect(commissionableBaseCents({ line_total_cents: 4500, discount_cents: 500 })).toBe(4000);
    expect(commissionableBaseCents({ line_total_cents: 4500, discount_cents: 9000 })).toBe(0);
    expect(commissionableBaseCents({ line_total_cents: 4500, removed_at: '2026-10-12T00:00:00Z' })).toBe(0);
    expect(commissionableBaseCents({ line_total_cents: '4500', discount_cents: '1' })).toBe(4499);   // strings from the driver
    expect(commissionableBaseCents({ line_total_cents: null })).toBe(0);
    expect(commissionableBaseCents({ line_total_cents: -10 })).toBe(0);
  });
});

describe('lineCommissionCents — the one formula', () => {
  it('percent rounds half-up on the base; flat/fixed is capped at the base; unknown type ⇒ percent', () => {
    expect(lineCommissionCents(4500, 'percent', 60)).toBe(2700);   // the mandate's Lisa example
    expect(lineCommissionCents(2000, 'percent', 70)).toBe(1400);
    expect(lineCommissionCents(1, 'percent', 50)).toBe(1);        // $0.01 → rounds to 1
    expect(lineCommissionCents(2, 'percent', 33)).toBe(1);
    expect(lineCommissionCents(8000, 'flat', 1500)).toBe(1500);
    expect(lineCommissionCents(1000, 'fixed', 1500)).toBe(1000);  // never more than the base
    expect(lineCommissionCents(1000, 'weird', 10)).toBe(100);
    expect(lineCommissionCents(commissionableBaseCents({ line_total_cents: 1000, removed_at: new Date() }), 'percent', 10)).toBe(0);
    expect(lineCommissionCents(10_000_000_00, 'percent', 60)).toBe(600_000_000);   // large amount, exact
  });
  it('the platform fallback is 50 (matches the tenants.default_commission_percent column default)', () => {
    expect(PLATFORM_FALLBACK_COMMISSION_PERCENT).toBe(50);
  });
});
