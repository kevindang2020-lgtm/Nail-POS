// realtime-sequence.vitest.spec — Constitution 9 §31–33, §36: per-room monotonic sequence numbers, minted once
// at the origin and identical on every gateway instance, so a client can detect a missed emission.
import { type Emission, EVENTS, rooms } from '@aipowersalon/realtime-contracts';
import { describe, it, expect } from 'vitest';
import { InProcessEmitter } from './realtime.gateway';
import { RedisRealtimeEmitter, type RealtimePubSub } from './realtime-bus';

/** A shared counter, the way Redis INCR is shared: every node's client sees the same numbers. */
class SharedBus {
  private handlers = new Map<string, Array<(m: string) => void>>();
  private counters = new Map<string, number>();
  client(): RealtimePubSub {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the fake's callbacks close over this instance
    const self = this;
    return {
      publish(channel, message) { for (const h of self.handlers.get(channel) || []) h(String(message)); },
      subscribe(channel, handler) { const a = self.handlers.get(channel) || []; a.push(handler); self.handlers.set(channel, a); },
      nextSeq(room) { const n = (self.counters.get(room) ?? 0) + 1; self.counters.set(room, n); return n; },
    };
  }
}
const A = { tenantId: 'tenant-A', branchId: 'branch-1' };
const roomA = rooms.tenantBranch(A.tenantId, A.branchId);

describe('§31–32 per-room monotonic sequence', () => {
  it('a single node numbers each room independently — never one global counter', () => {
    const e = new InProcessEmitter();
    const seen: Emission[] = [];
    e.subscribe(roomA, (x) => seen.push(x));
    e.subscribe(rooms.technician('tech-1'), (x) => seen.push(x));
    e.toTenant(A, EVENTS.queueUpdated); e.toTenant(A, EVENTS.queueUpdated); e.toTechnician('tech-1', EVENTS.followUpTaskUpdated); e.toTenant(A, EVENTS.queueUpdated);
    expect(seen.filter((x) => x.room === roomA).map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(seen.filter((x) => x.room !== roomA).map((x) => x.seq)).toEqual([1]);        // §32: scoped, not global
    expect(e.currentSeq(roomA)).toBe(3);
  });

  it('§9/§31 two gateway instances hand out ONE sequence: an emission on node A and one on node B never collide', async () => {
    const bus = new SharedBus();
    const localA = new InProcessEmitter(), localB = new InProcessEmitter();
    const nodeA = new RedisRealtimeEmitter(localA, bus.client(), 'aps:test');
    const nodeB = new RedisRealtimeEmitter(localB, bus.client(), 'aps:test');
    await nodeA.init(); await nodeB.init();
    const onA: number[] = [], onB: number[] = [];
    nodeA.subscribe(roomA, (x) => onA.push(x.seq!)); nodeB.subscribe(roomA, (x) => onB.push(x.seq!));
    nodeA.toTenant(A, EVENTS.queueUpdated);   // minted on A
    nodeB.toTenant(A, EVENTS.ticketPaid);     // minted on B
    nodeA.toTenant(A, EVENTS.queueUpdated);   // minted on A again
    expect(onA).toEqual([1, 2, 3]);           // every client on every node sees the same, gap-free numbering
    expect(onB).toEqual([1, 2, 3]);
    expect(nodeA.currentSeq(roomA)).toBe(3); expect(nodeB.currentSeq(roomA)).toBe(3);
  });

  it('§10 a node that missed a bus message can SEE the gap: its currentSeq lags the room', async () => {
    const bus = new SharedBus();
    const localA = new InProcessEmitter(), localB = new InProcessEmitter();
    const nodeA = new RedisRealtimeEmitter(localA, bus.client(), 'aps:test');
    const nodeB = new RedisRealtimeEmitter(localB, bus.client(), 'aps:test');
    await nodeA.init();                         // B never subscribes: simulates an instance that was down for one message
    nodeA.toTenant(A, EVENTS.queueUpdated);
    await nodeB.init();
    nodeA.toTenant(A, EVENTS.queueUpdated);
    expect(nodeA.currentSeq(roomA)).toBe(2);
    expect(nodeB.currentSeq(roomA)).toBe(2);   // B delivered only seq 2 — its lastSeen is 2, and a client that saw 1 on B is behind
  });

  it('a bus without nextSeq falls back to the origin node counter (single-instance correctness preserved)', () => {
    const local = new InProcessEmitter();
    const node = new RedisRealtimeEmitter(local, { publish() { throw new Error('down'); }, subscribe() {} }, 'aps:test');
    const seen: number[] = [];
    node.subscribe(roomA, (x) => seen.push(x.seq!));
    node.toTenant(A, EVENTS.queueUpdated); node.toTenant(A, EVENTS.queueUpdated);
    expect(seen).toEqual([1, 2]);              // publish failed → local delivery, still sequenced
  });
});
