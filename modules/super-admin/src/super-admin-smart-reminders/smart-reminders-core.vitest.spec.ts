import { describe, it, expect } from 'vitest';
import { REMINDER_TYPES, channelBucket, statusBucket, pct, deliveryRate, distribution, kpiTrendSemantic, trendDelta, signedOffsetMinutes, withinRange, minuteOfDayLabel, classifyFailure, resolveChannelSequence, planFallback } from './smart-reminders-core';

describe('smart-reminders core', () => {
  it('exposes the 10 reminder-type catalog', () => {
    expect(REMINDER_TYPES.length).toBe(10);
    expect(REMINDER_TYPES.map((t) => t.key)).toContain('missed_appointment_followup');
    expect(REMINDER_TYPES.find((t) => t.key === 'device_offline_alert')?.label).toBe('Device-Offline Alert');
  });

  it('buckets channels', () => {
    expect(channelBucket('SMS')).toBe('sms');
    expect(channelBucket('email')).toBe('email');
    expect(channelBucket('fcm')).toBe('push');
    expect(channelBucket('carrier-pigeon')).toBe('other');
  });

  it('maps attempt status to delivery buckets', () => {
    expect(statusBucket('sent')).toMatchObject({ key: 'delivered', semantic: 'good' });
    expect(statusBucket('failed')).toMatchObject({ key: 'failed', semantic: 'bad' });
    expect(statusBucket('blocked')).toMatchObject({ key: 'blocked', semantic: 'warn' });
  });

  it('computes rates, distribution, trend semantics', () => {
    expect(deliveryRate(97, 100)).toBe(97);
    expect(pct(0, 0)).toBe(0);
    expect(distribution([{ key: 'sms', label: 'SMS', count: 51 }], 100)[0].pct).toBe(51);
    expect(kpiTrendSemantic('failed', 'up')).toBe('bad');
    expect(kpiTrendSemantic('delivered', 'up')).toBe('good');
    expect(trendDelta(120, 100)).toMatchObject({ deltaPct: 20, direction: 'up' });
  });

  it('computes timing offsets, range checks, and quiet-hour labels', () => {
    expect(signedOffsetMinutes('before', 1440)).toBe(-1440);
    expect(signedOffsetMinutes('after', 120)).toBe(120);
    expect(signedOffsetMinutes('immediate', 999)).toBe(0);
    expect(withinRange(120, 0, 1440)).toBe(true);
    expect(withinRange(2000, 0, 1440)).toBe(false);
    expect(minuteOfDayLabel(1320)).toBe('22:00');
    expect(minuteOfDayLabel(null)).toBe(null);
  });

  it('classifies failures and plans fallback (stop-on-success, no duplicates, exhaust)', () => {
    expect(classifyFailure('Invalid phone number')).toBe('permanent');
    expect(classifyFailure('Device token expired')).toBe('permanent');
    expect(classifyFailure('Provider timeout')).toBe('temporary');
    expect(resolveChannelSequence('push', ['sms', 'push', 'email'])).toEqual(['push', 'sms', 'email']);
    // primary first
    expect(planFallback(['push', 'sms'], [])).toMatchObject({ nextChannel: 'push', reason: 'primary' });
    // push failed permanently → fall back to sms (do not retry push)
    expect(planFallback(['push', 'sms'], [{ channel: 'push', outcome: 'permanent' }])).toMatchObject({ nextChannel: 'sms', reason: 'fallback' });
    // sms succeeded → stop, no duplicate email
    expect(planFallback(['push', 'sms', 'email'], [{ channel: 'push', outcome: 'permanent' }, { channel: 'sms', outcome: 'success' }])).toMatchObject({ nextChannel: null, stop: true, reason: 'delivered' });
    // all attempted, none succeeded → exhausted
    expect(planFallback(['push', 'sms'], [{ channel: 'push', outcome: 'permanent' }, { channel: 'sms', outcome: 'temporary' }])).toMatchObject({ nextChannel: null, stop: true, reason: 'exhausted' });
  });
});
