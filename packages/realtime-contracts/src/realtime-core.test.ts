// realtime-core.test — the registry's own invariants (the API's realtime specs cover the gateway that uses it).
import { describe, it, expect } from 'vitest';
import { EVENTS, EVENT_VERSIONS, eventVersion, screensToRefetch, makeEnvelope, isEnvelope, payloadViolations, ensureEnvelope, rooms } from './realtime-core';

describe('@aipowersalon/realtime-contracts — the one registry', () => {
  it('every event name is versioned (Constitution 9 §27) and versions name only registered events', () => {
    const names = Object.values(EVENTS) as string[];
    for (const n of names) expect(eventVersion(n), n).toBeGreaterThanOrEqual(1);
    for (const v of Object.keys(EVENT_VERSIONS)) expect(names, v).toContain(v);
  });
  it('a routed event is a registered event; queue_updated refetches at least one screen', () => {
    expect(screensToRefetch(EVENTS.queueUpdated).length).toBeGreaterThan(0);
    expect(screensToRefetch('not_an_event')).toEqual([]);
  });
  it('envelopes are minimal (§12) and forbidden keys are STRIPPED at the seal, never thrown', () => {
    const env = makeEnvelope({ eventType: EVENTS.queueUpdated, tenantId: 't1', branchId: 'b1', data: { ticketId: 'x' } });
    expect(isEnvelope(env)).toBe(true);
    expect(payloadViolations({ phone: '555', ok: 1 })).toEqual(['phone']);
    const { envelope, piiStripped } = ensureEnvelope(EVENTS.ticketPaid, { phone: '555', total: 10 }, { tenantId: 't1' });
    expect(piiStripped).toBe(1);
    expect(JSON.stringify(envelope)).not.toContain('555');
  });
  it('room keys are stable strings', () => {
    expect(rooms.tenantBranch('t', 'b')).toContain('t');
    expect(rooms.platform()).toBeTruthy();
  });
});
