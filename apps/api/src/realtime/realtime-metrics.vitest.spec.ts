// realtime-metrics.vitest.spec.ts — §33 delivery metrics + §34/§35 snapshots (Jul 27, 2026).
import { describe, it, expect } from 'vitest';
import { InProcessEmitter, RealtimeMetrics } from './realtime.gateway';
import { rooms, EVENTS, makeEnvelope } from '@aipowersalon/realtime-contracts';

describe('§33 metrics live where events flow', () => {
  it('delivery latency percentiles come from envelope.updatedAt → delivered', () => {
    const m = new RealtimeMetrics();
    const now = Date.now();
    for (const ms of [10, 20, 30, 40, 1000]) m.markDelivered(1, new Date(now - ms).toISOString());
    const s = m.snapshot();
    expect(s.eventsDelivered).toBe(5);
    expect(s.latencyP50Ms).toBeGreaterThanOrEqual(20);
    expect(s.latencyP50Ms).toBeLessThan(1000);
    expect(s.latencyP99Ms).toBeGreaterThanOrEqual(1000 - 5);
  });

  it('a throwing subscriber counts as a failed delivery without breaking the others', () => {
    const bus = new InProcessEmitter();
    const got: string[] = [];
    bus.subscribe(rooms.tenantBranch('T1', 'B1'), () => { throw new Error('broken client'); });
    bus.subscribe(rooms.tenantBranch('T1', 'B1'), (e) => got.push(e.event));
    bus.toTenant({ tenantId: 'T1', branchId: 'B1' }, EVENTS.queueUpdated, makeEnvelope({ eventType: EVENTS.queueUpdated, tenantId: 'T1', branchId: 'B1' }));
    expect(got).toEqual([EVENTS.queueUpdated]);
    expect(bus.metrics.eventsDropped).toBe(1);
    expect(bus.metrics.eventsDelivered).toBe(1);
  });

  it('§34/§35 room snapshots expose KEYS and counts only — no payloads, no tenant content', () => {
    const bus = new InProcessEmitter();
    const off = bus.subscribe(rooms.tenantBranch('T1', 'B1'), () => {});
    bus.subscribe(rooms.tenantBranch('T2', 'B9'), () => {});
    expect(bus.totalSubscribers()).toBe(2);
    const snap = bus.roomsSnapshot();
    expect(snap.map((r) => r.room).sort()).toEqual(['tenant:T1:branch:B1', 'tenant:T2:branch:B9']);
    expect(Object.keys(snap[0]).sort()).toEqual(['room', 'subscribers']);
    off();
    expect(bus.totalSubscribers()).toBe(1);                    // teardown really removes — §35 counts stay honest
  });
});
