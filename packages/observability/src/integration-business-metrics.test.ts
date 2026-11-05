import { describe, it, expect, beforeEach } from 'vitest';
import { recordPaymentEvent, recordMessagingEvent, integrationBusinessCounts, resetIntegrationBusinessCountsForTests, paymentBusinessEvents, messagingBusinessEvents } from './integration-business-metrics';

describe('integration business metrics (§104/§105)', () => {
  beforeEach(() => resetIntegrationBusinessCountsForTests());
  it('counts payment events by a bounded event name', () => {
    recordPaymentEvent('attempt'); recordPaymentEvent('approved'); recordPaymentEvent('unknown');
    expect(integrationBusinessCounts().payments).toEqual({ attempt: 1, approved: 1, unknown: 1 });
    expect(paymentBusinessEvents.snapshot().some((e: any) => e.labels.event === 'unknown' && e.value >= 1)).toBe(true);
  });
  it('drops names outside the vocabulary (no tenant ids / phone numbers as labels)', () => {
    recordPaymentEvent('ten_123' as any); recordMessagingEvent('+18565550101' as any);
    expect(integrationBusinessCounts()).toEqual({ payments: {}, messaging: {} });
  });
  it('segments_sent counts segments, not messages', () => {
    recordMessagingEvent('segments_sent', 3); recordMessagingEvent('segments_sent', 1); recordMessagingEvent('opt_out');
    expect(integrationBusinessCounts().messaging).toEqual({ segments_sent: 4, opt_out: 1 });
    expect(messagingBusinessEvents.snapshot().some((e: any) => e.labels.event === 'segments_sent')).toBe(true);
  });
});
