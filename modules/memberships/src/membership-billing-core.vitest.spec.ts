// membership-billing-core.vitest.spec.ts — the billing math + dunning state machine, no I/O.
import { describe, it, expect } from 'vitest';
import {
  addInterval, applyMembershipBillingEvent, dunningStep, renewalIdempotencyKey, prorate, renewalAllocation, cardpointeRenewalToEvent,
} from './membership-billing-core';

describe('addInterval', () => {
  const base = new Date('2026-01-15T00:00:00Z');
  it('advances by interval', () => {
    expect(addInterval(base, 'month').toISOString().slice(0, 10)).toBe('2026-02-15');
    expect(addInterval(base, 'quarter').toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(addInterval(base, 'six_month').toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(addInterval(base, 'year').toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(addInterval(base, 'none').toISOString()).toBe(base.toISOString()); // prepaid does not advance
  });
});

describe('dunning state machine', () => {
  it('steps down on failure and recovers on success', () => {
    expect(applyMembershipBillingEvent('active', 'renewal_succeeded')).toMatchObject({ status: 'active', setPeriod: true });
    expect(applyMembershipBillingEvent('active', 'renewal_failed').status).toBe('grace');
    expect(applyMembershipBillingEvent('grace', 'renewal_failed').status).toBe('past_due');
    expect(applyMembershipBillingEvent('past_due', 'renewal_failed').status).toBe('suspended');
    expect(applyMembershipBillingEvent('past_due', 'renewal_succeeded')).toMatchObject({ status: 'active', setPeriod: true });
    expect(applyMembershipBillingEvent('suspended', 'recovered').status).toBe('active');
  });
  it('treats terminal/invalid as safe no-ops', () => {
    expect(applyMembershipBillingEvent('canceled', 'renewal_failed')).toMatchObject({ changed: false, status: 'canceled' });
    expect(applyMembershipBillingEvent('active', 'bogus').ok).toBe(false);
  });
});

describe('dunningStep', () => {
  it('schedules retries then suspends', () => {
    expect(dunningStep(1)).toEqual({ retryInDays: 3, terminal: null });
    expect(dunningStep(2)).toEqual({ retryInDays: 5, terminal: null });
    expect(dunningStep(3)).toEqual({ retryInDays: 7, terminal: null });
    expect(dunningStep(4)).toEqual({ retryInDays: null, terminal: 'suspend' });
  });
});

describe('renewalIdempotencyKey', () => {
  it('is deterministic per period + attempt', () => {
    expect(renewalIdempotencyKey('m1', '2026-06-01T00:00:00Z', 1)).toBe('renew:m1:2026-06-01T00:00:00Z:1');
    expect(renewalIdempotencyKey('m1', '2026-06-01T00:00:00Z', 1)).toBe(renewalIdempotencyKey('m1', '2026-06-01T00:00:00Z', 1));
    expect(renewalIdempotencyKey('m1', '2026-06-01T00:00:00Z', 2)).not.toBe(renewalIdempotencyKey('m1', '2026-06-01T00:00:00Z', 1));
  });
});

describe('prorate', () => {
  it('credits unused old and charges remaining new at the midpoint', () => {
    const r = prorate(8000, 12000, new Date('2026-06-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'), new Date('2026-06-16T00:00:00Z'));
    expect(r.daysTotal).toBe(30);
    expect(r.daysRemaining).toBe(15);
    expect(r.unusedOldCents).toBe(4000);
    expect(r.remainingNewCents).toBe(6000);
    expect(r.netChargeCents).toBe(2000); // upgrade → member owes the difference for the remaining half
  });
  it('returns a credit when downgrading', () => {
    const r = prorate(12000, 8000, new Date('2026-06-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'), new Date('2026-06-16T00:00:00Z'));
    expect(r.netChargeCents).toBe(-2000);
  });
});

describe('renewalAllocation', () => {
  it('splits 60/40 on_billing and books to house on_redemption', () => {
    expect(renewalAllocation(10000, 60, 'on_billing')).toEqual({ techCents: 6000, ownerCents: 4000 });
    expect(renewalAllocation(10000, 60, 'on_redemption')).toEqual({ techCents: 0, ownerCents: 10000 });
  });
});

describe('cardpointeRenewalToEvent', () => {
  it('maps respstat to events', () => {
    expect(cardpointeRenewalToEvent({ retref: 'R1', respstat: 'A' })).toMatchObject({ ok: true, event: 'renewal_succeeded' });
    expect(cardpointeRenewalToEvent({ retref: 'R1', respstat: 'C' })).toMatchObject({ ok: true, event: 'renewal_failed' });
    expect(cardpointeRenewalToEvent({ retref: 'R1', respstat: 'B' })).toMatchObject({ ok: false, reason: 'retry_pending' });
    expect(cardpointeRenewalToEvent({ respstat: 'A' })).toMatchObject({ ok: false, reason: 'missing_retref' });
  });
});
