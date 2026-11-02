import { describe, it, expect, beforeEach } from 'vitest';
import { recordPaymentEvent, recordMessagingEvent, integrationBusinessCounts, resetIntegrationBusinessCountsForTests, paymentBusinessEvents, messagingBusinessEvents, recordPaymentDeviceEvent, recordPaymentDeviceAppVersion, paymentAppVersionLabel, paymentDeviceEvents } from './integration-business-metrics';

describe('integration business metrics (§104/§105)', () => {
  beforeEach(() => resetIntegrationBusinessCountsForTests());
  it('counts payment events by a bounded event name', () => {
    recordPaymentEvent('attempt'); recordPaymentEvent('approved'); recordPaymentEvent('unknown');
    expect(integrationBusinessCounts().payments).toEqual({ attempt: 1, approved: 1, unknown: 1 });
    expect(paymentBusinessEvents.snapshot().some((e: any) => e.labels.event === 'unknown' && e.value >= 1)).toBe(true);
  });
  it('drops names outside the vocabulary (no tenant ids / phone numbers as labels)', () => {
    recordPaymentEvent('ten_123' as any); recordMessagingEvent('+18565550101' as any);
    expect(integrationBusinessCounts()).toEqual({ payments: {}, messaging: {}, paymentDevices: {}, paymentAppVersions: {} });
  });
  it('segments_sent counts segments, not messages', () => {
    recordMessagingEvent('segments_sent', 3); recordMessagingEvent('segments_sent', 1); recordMessagingEvent('opt_out');
    expect(integrationBusinessCounts().messaging).toEqual({ segments_sent: 4, opt_out: 1 });
    expect(messagingBusinessEvents.snapshot().some((e: any) => e.labels.event === 'segments_sent')).toBe(true);
  });
});

describe('Secure Tap to Pay §51 payment-device counters (Oct 26 2026)', () => {
  beforeEach(() => resetIntegrationBusinessCountsForTests());
  it('counts registrations, revocations, claim conflicts and refused attempts by a closed vocabulary; drops anything else', () => {
    recordPaymentDeviceEvent('registered'); recordPaymentDeviceEvent('revoked'); recordPaymentDeviceEvent('claim_conflict', 2); recordPaymentDeviceEvent('revoked_device_attempt');
    recordPaymentDeviceEvent('aps-front-123' as any); recordPaymentDeviceEvent('registered', -1);
    expect(integrationBusinessCounts().paymentDevices).toEqual({ registered: 1, revoked: 1, claim_conflict: 2, revoked_device_attempt: 1 });
    expect(paymentDeviceEvents.snapshot().some((e: any) => e.labels.event === 'claim_conflict' && e.value >= 2)).toBe(true);
  });
  it('app-version distribution: major.minor labels, anything else is "other" (never free text as a label)', () => {
    for (const v of ['1.0.0', '1.0.7', 'v2.3.1', '2.3', '1.0.0-beta<script>', 'iPhone15,2', '']) recordPaymentDeviceAppVersion(v);
    expect(integrationBusinessCounts().paymentAppVersions).toEqual({ '1.0': 2, '2.3': 2, other: 3 });
    expect(paymentAppVersionLabel('10.20.30')).toBe('10.20');
  });
});
