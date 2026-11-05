import { describe, it, expect } from 'vitest';
import { computeOverage, normalizeOverageRulesUpdate } from './overage-core';

describe('normalizeOverageRulesUpdate', () => {
  it('validates metrics and non-negative integer fields', () => {
    const r = normalizeOverageRulesUpdate({ reason: 'reprice', changes: [
      { metric: 'sms_monthly', unitPriceCents: 2 },
      { metric: 'users', unitPriceCents: 1500, graceAmount: 1, warningThresholdPct: 80 },
    ] });
    expect(r.changes[0]).toEqual({ metric: 'sms_monthly', unitPriceCents: 2 });
    expect(r.changes[1]).toMatchObject({ unitPriceCents: 1500, graceAmount: 1, warningThresholdPct: 80 });
  });
  it('rejects missing reason, empty, unknown metric, duplicates, bad values', () => {
    expect(() => normalizeOverageRulesUpdate({ changes: [{ metric: 'sms_monthly', unitPriceCents: 1 }] })).toThrow(/reason/);
    expect(() => normalizeOverageRulesUpdate({ reason: 'x', changes: [] })).toThrow(/at least one/);
    expect(() => normalizeOverageRulesUpdate({ reason: 'x', changes: [{ metric: 'nope', unitPriceCents: 1 }] })).toThrow(/unknown/);
    expect(() => normalizeOverageRulesUpdate({ reason: 'x', changes: [{ metric: 'users', unitPriceCents: 1 }, { metric: 'users', unitPriceCents: 2 }] })).toThrow(/duplicate/);
    expect(() => normalizeOverageRulesUpdate({ reason: 'x', changes: [{ metric: 'users', unitPriceCents: -1 }] })).toThrow(/non-negative/);
  });
});

describe('computeOverage (decimal-safe)', () => {
  it('charges overage_qty * unit_price_cents exactly in integer cents', () => {
    // 1 branch over a soft cap of 1, at $25.00/branch
    expect(computeOverage(2, 1, { unitPriceCents: 2500 })).toMatchObject({ overageQty: 1, amountCents: 2500 });
    // 38 AI minutes over included 0 at $0.05/min => 38 * 5 = 190 cents
    expect(computeOverage(38, 0, { unitPriceCents: 5 })).toMatchObject({ overageQty: 38, amountCents: 190 });
  });

  it('respects grace, and unlimited (null) yields no charge', () => {
    expect(computeOverage(5, 3, { unitPriceCents: 100, graceAmount: 2 })).toMatchObject({ overageQty: 0, amountCents: 0 });
    expect(computeOverage(5, 3, { unitPriceCents: 100, graceAmount: 1 })).toMatchObject({ overageQty: 1, amountCents: 100 });
    expect(computeOverage(9999, null, { unitPriceCents: 100 })).toMatchObject({ overageQty: 0, amountCents: 0 });
  });

  it('applies min and max charge bounds', () => {
    expect(computeOverage(1, 0, { unitPriceCents: 10, minChargeCents: 100 })).toMatchObject({ amountCents: 100 });
    expect(computeOverage(100, 0, { unitPriceCents: 10, maxChargeCents: 250 })).toMatchObject({ amountCents: 250 });
  });

  it('never charges when under or at the limit', () => {
    expect(computeOverage(3, 3, { unitPriceCents: 100 })).toMatchObject({ overageQty: 0, amountCents: 0 });
    expect(computeOverage(2, 3, { unitPriceCents: 100 })).toMatchObject({ overageQty: 0, amountCents: 0 });
  });
});
