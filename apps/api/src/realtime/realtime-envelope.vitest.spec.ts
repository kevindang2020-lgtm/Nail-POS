// realtime-envelope.vitest.spec.ts — §12 envelope, §19 ordering, §20 idempotency, §31 coalescing (Jul 27, 2026).
import { describe, it, expect, vi } from 'vitest';
import { makeEnvelope, payloadViolations, EVENTS } from '@aipowersalon/realtime-contracts';
import { EventTracker, RefetchCoalescer } from './realtime-transport-core';

describe('§12 minimal envelope', () => {
  it('carries WHAT/WHERE/WHEN/WHICH and unique eventIds', () => {
    const now = () => new Date('2026-07-27T15:00:00Z');
    const a = makeEnvelope({ eventType: EVENTS.queueUpdated, tenantId: 'T1', branchId: 'B1', resourceType: 'queue_item', resourceId: 'q9', version: 3, now });
    const b = makeEnvelope({ eventType: EVENTS.queueUpdated, tenantId: 'T1', branchId: 'B1', resourceType: 'queue_item', resourceId: 'q9', version: 4, now });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.updatedAt).toBe('2026-07-27T15:00:00.000Z');
    expect(a.tenantId).toBe('T1');
    expect(a.resourceId).toBe('q9');
  });

  it('flags PII keys anywhere in a payload — phones, emails, notes, card data never ride an event', () => {
    expect(payloadViolations({ ticketId: 't1', version: 2 })).toEqual([]);
    expect(payloadViolations({ customer: { phone: '+18565551234' } })).toEqual(['customer.phone']);
    expect(payloadViolations({ Email: 'x@y.com', nested: { card: { pan: '4111' } } }).sort()).toEqual(['Email', 'nested.card', 'nested.card.pan']);
  });
});

describe('§20 idempotency + §19 ordering', () => {
  it('the same eventId applies once; version 10 arriving after 11 is dropped', () => {
    const t = new EventTracker();
    const e11 = { eventId: 'e-11', resourceType: 'ticket', resourceId: 'tk1', version: 11 };
    const e10 = { eventId: 'e-10', resourceType: 'ticket', resourceId: 'tk1', version: 10 };
    expect(t.shouldApply(e11)).toBe(true);
    expect(t.shouldApply(e11)).toBe(false);                    // duplicate delivery (§51)
    expect(t.shouldApply(e10)).toBe(false);                    // stale version (§52) — cannot overwrite newer state
    expect(t.shouldApply({ eventId: 'e-12', resourceType: 'ticket', resourceId: 'tk1', version: 12 })).toBe(true);
  });

  it('events without versions still dedupe by eventId, and unversioned resources always apply', () => {
    const t = new EventTracker();
    expect(t.shouldApply({ eventId: 'x1' })).toBe(true);
    expect(t.shouldApply({ eventId: 'x1' })).toBe(false);
    expect(t.shouldApply({})).toBe(true);                      // nothing to key on — never block a refetch signal
  });

  it('memory is bounded: the LRU cap evicts the oldest, a day-long POS session cannot grow unbounded', () => {
    const t = new EventTracker(3);
    for (const id of ['a', 'b', 'c', 'd']) t.shouldApply({ eventId: id });
    expect(t.shouldApply({ eventId: 'a' })).toBe(true);        // evicted → treated as new (safe: worst case one extra refetch)
    expect(t.shouldApply({ eventId: 'd' })).toBe(false);       // still tracked
  });
});

describe('§31 burst coalescing', () => {
  it('15 queue events in one window produce exactly one refetch per screen', () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const c = new RefetchCoalescer((s) => runs.push(s), 250);
    for (let i = 0; i < 15; i++) c.request('queue');
    c.request('tech-queue');
    vi.advanceTimersByTime(260);
    expect(runs.sort()).toEqual(['queue', 'tech-queue']);
    c.request('queue');                                        // a later event schedules a fresh refetch
    vi.advanceTimersByTime(260);
    expect(runs.filter((r) => r === 'queue').length).toBe(2);
    vi.useRealTimers();
  });
});
