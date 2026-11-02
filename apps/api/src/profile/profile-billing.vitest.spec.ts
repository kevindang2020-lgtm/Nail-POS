import { describe, it, expect } from 'vitest';
import { ProfileService, toBillingSummary, type BillingSummary } from './profile.service';

// Pure billing roll-up (fact rows + plan-price map → summary). Money is integer cents; no fabrication —
// a field is null when its source row is missing. The live scoped queries are covered by PG smoke.

describe('toBillingSummary', () => {
  it('maps an active subscription + configured payment + priced plan', () => {
    const s = toBillingSummary(
      { plan: 'Pro', status: 'active', current_period_end: '2026-09-01T00:00:00Z' },
      { processor: 'cardpointe', merchant_id: 'MID-998877004242', fiserv_configured: true, status: 'active' },
      { Pro: 9900, Starter: 4900 },
    );
    expect(s).toEqual<BillingSummary>({
      plan: 'Pro', status: 'active', active: true,
      currentPeriodEnd: '2026-09-01T00:00:00.000Z', monthlyFeeCents: 9900,
      processor: 'cardpointe', merchantIdLast4: '4242', paymentConfigured: true, paymentStatus: 'active',
    });
  });

  it('returns monthlyFeeCents = null when the plan has no configured price', () => {
    const s = toBillingSummary({ plan: 'Enterprise', status: 'active', current_period_end: null }, null, { Pro: 9900 });
    expect(s.monthlyFeeCents).toBeNull();
    expect(s.currentPeriodEnd).toBeNull();
    expect(s.processor).toBeNull();
    expect(s.paymentConfigured).toBe(false);
  });

  it('active is false for any non-active status; short merchant id is returned as-is', () => {
    const s = toBillingSummary(
      { plan: 'Starter', status: 'trialing', current_period_end: null },
      { processor: 'fiserv', merchant_id: '42', fiserv_configured: false, status: 'pending' },
      { Starter: 4900 },
    );
    expect(s.active).toBe(false);
    expect(s.monthlyFeeCents).toBe(4900);   // price is the plan's list price regardless of status
    expect(s.merchantIdLast4).toBe('42');
    expect(s.paymentStatus).toBe('pending');
  });

  it('empty (no subscription, no payment) → all null / not configured', () => {
    expect(toBillingSummary(null, null, {})).toEqual<BillingSummary>({
      plan: null, status: null, active: false, currentPeriodEnd: null, monthlyFeeCents: null,
      processor: null, merchantIdLast4: null, paymentConfigured: false, paymentStatus: null,
    });
  });
});

describe('ProfileService.getBillingSummary (fail-soft without a live db)', () => {
  it('returns the empty summary with no db or no tenant', async () => {
    const empty = toBillingSummary(null, null, {});
    expect(await new ProfileService(null as any).getBillingSummary({ tenantId: 't1', userId: 'u1' })).toEqual(empty);
    expect(await new ProfileService(null as any).getBillingSummary({})).toEqual(empty);
  });
});
