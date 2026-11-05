import { describe, it, expect } from 'vitest';
import { composeMemberComm, renewalReminderReference, MEMBER_COMM_TYPE } from './membership-comms-core';

describe('composeMemberComm', () => {
  const ctx = { customerName: 'Jordan Lee', planName: 'VIP Nail Club', nextBillingAt: '2026-07-27T00:00:00Z' };

  it('greets by first name and names the plan for welcome', () => {
    const c = composeMemberComm('welcome', ctx);
    expect(c.type).toBe(MEMBER_COMM_TYPE);
    expect(c.title).toContain('VIP Nail Club');
    expect(c.body).toContain('Jordan');
  });

  it('includes the renewal date in a reminder', () => {
    const c = composeMemberComm('renewal_reminder', ctx);
    expect(c.body).toContain('July 27');
  });

  it('produces a clear payment-failure message', () => {
    const c = composeMemberComm('payment_failed', ctx);
    expect(c.title.toLowerCase()).toContain('payment');
    expect(c.body.toLowerCase()).toContain('payment method');
  });

  it('falls back gracefully with no name or plan', () => {
    const c = composeMemberComm('welcome', { customerName: null, planName: null });
    expect(c.body).toContain('there');
    expect(c.title).toContain('membership');
  });
});

describe('renewalReminderReference', () => {
  it('is stable per membership + billing date (idempotency key)', () => {
    expect(renewalReminderReference('m1', '2026-07-27T12:00:00Z')).toBe('membership-renewal:m1:2026-07-27');
    expect(renewalReminderReference('m1', '2026-07-27T12:00:00Z')).toBe(renewalReminderReference('m1', '2026-07-27T00:00:00Z'));
  });
});
