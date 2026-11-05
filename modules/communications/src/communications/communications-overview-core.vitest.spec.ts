import { describe, it, expect } from 'vitest';
import { CHANNELS, CHANNEL_LABEL, channelBucket, deliveryStatus, isDelivered, isFailed, isSuppressed, providerHealth, pct, deliveryRate, formatCents, distribution, kpiTrendSemantic, trendDelta } from './communications-overview-core';

describe('communications overview core', () => {
  it('buckets the 7 communication types + other', () => {
    expect(channelBucket('sms')).toBe('sms');
    expect(channelBucket('Email')).toBe('email');
    expect(channelBucket('fcm')).toBe('push');
    expect(channelBucket('in-app')).toBe('in_app');
    expect(channelBucket('system')).toBe('system_alert');
    expect(channelBucket('tenant')).toBe('tenant_notice');
    expect(channelBucket('support')).toBe('support');
    expect(channelBucket('whatsapp')).toBe('other');
    expect(CHANNELS.length).toBe(7);
    expect(CHANNEL_LABEL.sms).toBe('SMS');
  });

  it('maps delivery status with semantics', () => {
    expect(deliveryStatus('delivered')).toMatchObject({ key: 'delivered', semantic: 'good' });
    expect(deliveryStatus('failed').semantic).toBe('bad');
    expect(deliveryStatus('suppressed').semantic).toBe('warn');
    expect(deliveryStatus('queued').key).toBe('queued');
    expect(isDelivered('delivered')).toBe(true);
    expect(isFailed('undelivered')).toBe(true);
    expect(isSuppressed('blocked')).toBe(true);
  });

  it('derives provider health from failure rate', () => {
    expect(providerHealth(100, 0)).toMatchObject({ key: 'healthy', semantic: 'good' });
    expect(providerHealth(95, 4)).toMatchObject({ key: 'degraded', semantic: 'warn' });
    expect(providerHealth(50, 50)).toMatchObject({ key: 'down', semantic: 'bad' });
    expect(providerHealth(0, 0).key).toBe('healthy');
  });

  it('computes rates + cents formatting', () => {
    expect(deliveryRate(97, 100)).toBe(97);
    expect(pct(0, 0)).toBe(0);
    expect(formatCents(842000)).toBe('$8,420.00');
    expect(formatCents(null)).toBe('—');
  });

  it('reconciles distributions + trend semantics + deltas', () => {
    const d = distribution([{ key: 'sms', label: 'SMS', count: 472 }, { key: 'email', label: 'Email', count: 298 }], 1000);
    expect(d[0].pct).toBe(47.2);
    expect(kpiTrendSemantic('failed', 'up')).toBe('bad');
    expect(kpiTrendSemantic('delivered', 'up')).toBe('good');
    expect(trendDelta(120, 100)).toMatchObject({ deltaPct: 20, direction: 'up' });
    expect(trendDelta(5, 0)).toMatchObject({ direction: 'up' });
  });
});
