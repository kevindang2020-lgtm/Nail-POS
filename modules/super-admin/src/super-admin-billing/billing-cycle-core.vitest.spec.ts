import { describe, it, expect } from 'vitest';
import { decideRenewal, renewalAmountCents, advancePeriodEnd, type CycleSubscription } from './billing-cycle-core';

const base = (over: Partial<CycleSubscription> = {}): CycleSubscription => ({
  status: 'active', currentPeriodEndMs: 1_000, cancelAtMs: null, monthlyPriceCents: 4900, billingInterval: 'monthly', ...over,
});
const NOW = 10_000; // well past the base period end

describe('decideRenewal — policy branches', () => {
  it('active → invoice, no trial convert', () => {
    const d = decideRenewal(base({ status: 'active' }), NOW);
    expect(d.action).toBe('invoice'); expect(d.convertTrialToActive).toBe(false);
  });
  it('trialing → invoice AND convert to active', () => {
    const d = decideRenewal(base({ status: 'trialing' }), NOW);
    expect(d.action).toBe('invoice'); expect(d.convertTrialToActive).toBe(true);
  });
  it('pending_cancellation → cancel, never invoice', () => {
    expect(decideRenewal(base({ status: 'pending_cancellation' }), NOW).action).toBe('cancel');
  });
  it('active with cancel_at reached → cancel (scheduled cancellation wins over renewal)', () => {
    const d = decideRenewal(base({ status: 'active', cancelAtMs: 5_000 }), NOW);
    expect(d.action).toBe('cancel');
  });
  it('trialing with cancel_at reached → cancel (do not convert/charge)', () => {
    const d = decideRenewal(base({ status: 'trialing', cancelAtMs: 5_000 }), NOW);
    expect(d.action).toBe('cancel'); expect(d.convertTrialToActive).toBe(false);
  });
  it('past_due → skip (dunning owns it, never stack a second invoice)', () => {
    expect(decideRenewal(base({ status: 'past_due' }), NOW).action).toBe('skip');
  });
  it('paused → skip', () => { expect(decideRenewal(base({ status: 'paused' }), NOW).action).toBe('skip'); });
  it('expired / cancelled / unknown → skip', () => {
    for (const s of ['expired', 'cancelled', 'weird']) expect(decideRenewal(base({ status: s }), NOW).action).toBe('skip');
  });
  it('not yet due → skip even if active', () => {
    expect(decideRenewal(base({ status: 'active', currentPeriodEndMs: NOW + 1 }), NOW).action).toBe('skip');
  });
  it('cancel_at in the FUTURE does not cancel an active renewal', () => {
    expect(decideRenewal(base({ status: 'active', cancelAtMs: NOW + 10_000 }), NOW).action).toBe('invoice');
  });
});

describe('renewalAmountCents', () => {
  it('monthly → monthly price', () => { expect(renewalAmountCents({ monthlyPriceCents: 4900, billingInterval: 'monthly' })).toBe(4900); });
  it('annual → annual plan price when provided', () => { expect(renewalAmountCents({ monthlyPriceCents: 4900, billingInterval: 'annual' }, 49000)).toBe(49000); });
  it('annual → falls back to monthly×12 when no plan price', () => { expect(renewalAmountCents({ monthlyPriceCents: 4900, billingInterval: 'year' })).toBe(58800); });
  it('never negative', () => { expect(renewalAmountCents({ monthlyPriceCents: -5, billingInterval: 'monthly' })).toBe(0); });
});

describe('advancePeriodEnd', () => {
  it('monthly advances one month', () => {
    const from = Date.UTC(2026, 0, 15); // Jan 15
    expect(new Date(advancePeriodEnd(from, 'monthly')).getUTCMonth()).toBe(1); // Feb
  });
  it('clamps day-of-month (Jan 31 → Feb 28 in 2026)', () => {
    const from = Date.UTC(2026, 0, 31);
    const d = new Date(advancePeriodEnd(from, 'month'));
    expect(d.getUTCMonth()).toBe(1); expect(d.getUTCDate()).toBe(28);
  });
  it('annual advances one year', () => {
    const from = Date.UTC(2026, 5, 10);
    expect(new Date(advancePeriodEnd(from, 'annual')).getUTCFullYear()).toBe(2027);
  });
});
