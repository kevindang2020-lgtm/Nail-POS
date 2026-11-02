import { describe, it, expect } from 'vitest';
import { computeDeliveryKpis, summarizeFailures, isRetryable } from './campaign-delivery-core';

describe('campaign-delivery engine', () => {
  it('computes delivery + opt-out rates from rollups', () => {
    expect(computeDeliveryKpis({ attempted: 1000, delivered: 974, optedOut: 8 })).toEqual({ deliveryRate: 97.4, optOutRate: 0.8 });
    expect(computeDeliveryKpis({ attempted: 0, delivered: 0, optedOut: 0 })).toEqual({ deliveryRate: null, optOutRate: null });
  });

  it('classifies permanent failures as non-retryable', () => {
    expect(isRetryable('invalid_phone_email')).toBe(false);
    expect(isRetryable('opted_out')).toBe(false);
    expect(isRetryable('spam_reported')).toBe(false);
    expect(isRetryable('channel_error')).toBe(true);
    expect(isRetryable('rate_limit')).toBe(true);
  });

  it('summarizes failures into reference buckets that reconcile to the total', () => {
    const s = summarizeFailures([
      { failureCategory: 'invalid_phone_email', count: 612 },
      { failureCategory: 'opted_out', count: 284 },
      { failureCategory: 'spam_reported', count: 176 },
      { failureCategory: 'channel_error', count: 98 },
      { failureCategory: 'provider_rejection', count: 50 },
      { failureCategory: 'network_failure', count: 28 },
    ]);
    expect(s.total).toBe(612 + 284 + 176 + 98 + 50 + 28);
    expect(s.byCategory.reduce((a, c) => a + c.count, 0)).toBe(s.total);
    expect(s.byCategory.find((c) => c.label === 'Invalid Phone/Email')!.count).toBe(612);
    expect(s.byCategory.find((c) => c.label === 'Other')!.count).toBe(78); // provider_rejection + network_failure
    expect(s.byCategory[s.byCategory.length - 1].label).toBe('Other'); // Other last
  });
});
