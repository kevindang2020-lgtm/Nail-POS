// communications-activity.vitest.spec.ts — the Communications activity metrics. The rule under test is the honesty
// one: an absent SOURCE must never render as a zero MEASUREMENT. "Nothing was sent" and "0% delivered" are
// different facts, and so are "answered instantly" and "never answered".
import { describe, it, expect } from 'vitest';
import { deliveryRatePct, avgFirstResponseMinutes, CommunicationsActivityService } from './communications-activity.service';

describe('campaign delivery rate', () => {
  it('computes delivered ÷ attempted as a whole percent', () => {
    expect(deliveryRatePct(200, 194)).toEqual({ value: 97, available: true });
    expect(deliveryRatePct(3, 1)).toEqual({ value: 33, available: true });
  });

  it('zero attempts is UNAVAILABLE, not 0% (an unsent campaign is not a failed one)', () => {
    const r = deliveryRatePct(0, 0);
    expect(r.available).toBe(false);
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/attempted/i);
  });

  it('clamps a nonsensical over-delivery to 100% rather than reporting >100', () => {
    expect(deliveryRatePct(10, 25).value).toBe(100);
  });
});

describe('average first-response time', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 6, 28, 9, m)).toISOString();

  it('measures inbound → first outbound per thread and averages across threads', () => {
    const r = avgFirstResponseMinutes([
      { threadId: 'a', direction: 'inbound', createdAt: at(0) },
      { threadId: 'a', direction: 'outbound', createdAt: at(10) },   // 10 min
      { threadId: 'b', direction: 'inbound', createdAt: at(0) },
      { threadId: 'b', direction: 'outbound', createdAt: at(20) },   // 20 min
    ]);
    expect(r).toEqual({ value: 15, available: true });
  });

  it('ignores a later outbound once the first reply landed, and re-arms after the next inbound', () => {
    const r = avgFirstResponseMinutes([
      { threadId: 'a', direction: 'inbound', createdAt: at(0) },
      { threadId: 'a', direction: 'outbound', createdAt: at(4) },    // 4 min — counted
      { threadId: 'a', direction: 'outbound', createdAt: at(40) },   // follow-up — not a response time
      { threadId: 'a', direction: 'inbound', createdAt: at(50) },
      { threadId: 'a', direction: 'outbound', createdAt: at(56) },   // 6 min — counted
    ]);
    expect(r.value).toBe(5); // (4 + 6) / 2
  });

  it('an unanswered thread contributes NOTHING (it is neither fast nor slow)', () => {
    const r = avgFirstResponseMinutes([
      { threadId: 'a', direction: 'inbound', createdAt: at(0) },
      { threadId: 'a', direction: 'outbound', createdAt: at(6) },
      { threadId: 'b', direction: 'inbound', createdAt: at(0) },     // never answered
    ]);
    expect(r.value).toBe(6);
  });

  it('an outbound-only thread never fabricates a response time', () => {
    expect(avgFirstResponseMinutes([{ threadId: 'a', direction: 'outbound', createdAt: at(0) }]).available).toBe(false);
  });

  it('nothing answered at all → UNAVAILABLE, not 0 minutes', () => {
    const r = avgFirstResponseMinutes([{ threadId: 'a', direction: 'inbound', createdAt: at(0) }]);
    expect(r.available).toBe(false);
    expect(r.value).toBeNull();
  });

  it('unparseable timestamps are skipped rather than producing NaN', () => {
    const r = avgFirstResponseMinutes([
      { threadId: 'a', direction: 'inbound', createdAt: 'not-a-date' },
      { threadId: 'a', direction: 'outbound', createdAt: at(5) },
    ]);
    expect(r.available).toBe(false);
  });
});

describe('activity service without a database (dev/offline)', () => {
  it('reports every metric unavailable with a reason — never zeros', async () => {
    const a = await new CommunicationsActivityService(null).activity('t1');
    for (const k of ['messagesSentToday', 'campaignDeliveryRatePct', 'aiCallsHandled', 'reviewRequestsSent', 'avgResponseMinutes', 'rebookingConversionPct'] as const) {
      expect(a[k].available, k).toBe(false);
      expect(a[k].value, k).toBeNull();
      expect(a[k].reason, k).toBeTruthy();
    }
  });

  it('rebooking conversion is unavailable BY DESIGN and says why', async () => {
    const a = await new CommunicationsActivityService(null).activity('t1');
    expect(a.rebookingConversionPct.reason).toMatch(/attribution/i);
  });

  it('clamps the window to a sane range', async () => {
    expect((await new CommunicationsActivityService(null).activity('t1', 0)).windowDays).toBe(1);
    expect((await new CommunicationsActivityService(null).activity('t1', 9999)).windowDays).toBe(365);
  });
});
