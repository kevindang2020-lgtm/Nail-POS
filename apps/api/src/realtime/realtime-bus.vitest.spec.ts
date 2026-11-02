import { describe, it, expect } from 'vitest';
import { InProcessEmitter } from './realtime.gateway';
import { RedisRealtimeEmitter, type RealtimePubSub } from './realtime-bus';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';

// In-memory stand-in for Redis pub/sub. publish() synchronously invokes EVERY handler subscribed to the channel across
// all "nodes" sharing this bus — exactly Redis PUBLISH/SUBSCRIBE fan-out (the publisher's own subscriber included).
class FakeBus {
  private handlers = new Map<string, Array<(m: string) => void>>();
  publishCount = 0;
  client(): RealtimePubSub {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
    return {
      publish(channel, message) { self.publishCount++; for (const h of self.handlers.get(channel) || []) h(String(message)); },
      subscribe(channel, handler) { const a = self.handlers.get(channel) || []; a.push(handler); self.handlers.set(channel, a); },
    };
  }
}

const A = { tenantId: 'tenant-A', branchId: 'branch-1' };
const B = { tenantId: 'tenant-B', branchId: 'branch-1' };

async function twoNodes() {
  const bus = new FakeBus();
  const localA = new InProcessEmitter();
  const localB = new InProcessEmitter();
  const nodeA = new RedisRealtimeEmitter(localA, bus.client(), 'aps:test');
  const nodeB = new RedisRealtimeEmitter(localB, bus.client(), 'aps:test');
  await nodeA.init();
  await nodeB.init();
  return { bus, nodeA, nodeB };
}

describe('realtime Redis fan-out (multi-instance)', () => {
  it('an event emitted on node A reaches an SSE subscriber parked on node B', async () => {
    const { nodeA, nodeB } = await twoNodes();
    const bGot: string[] = [];
    nodeB.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => bGot.push(e.event)); // client connected to node B
    nodeA.toTenant(A, EVENTS.ticketPaid, { ticketId: 't1' });                                // payment handled on node A
    expect(bGot).toEqual([EVENTS.ticketPaid]);
  });

  it('the emitting node delivers to its own clients exactly once (no double-delivery)', async () => {
    const { nodeA } = await twoNodes();
    const aGot: string[] = [];
    nodeA.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => aGot.push(e.event));
    nodeA.toTenant(A, EVENTS.queueUpdated, {});
    expect(aGot).toEqual([EVENTS.queueUpdated]); // once, via the channel round-trip — not twice
  });

  it('tenant isolation holds across nodes: a B-room subscriber never sees A-room events', async () => {
    const { nodeA, nodeB } = await twoNodes();
    const aGot: string[] = [];
    const bGot: string[] = [];
    nodeA.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => aGot.push(e.event));
    nodeB.subscribe(rooms.tenantBranch(B.tenantId, B.branchId), (e) => bGot.push(e.event));
    nodeA.toTenant(A, EVENTS.ticketPaid, {});
    nodeB.toTenant(B, EVENTS.serviceDone, {});
    expect(aGot).toEqual([EVENTS.ticketPaid]);
    expect(bGot).toEqual([EVENTS.serviceDone]);
  });

  it('ticket + customer-display rooms also fan out across nodes', async () => {
    const { nodeA, nodeB } = await twoNodes();
    const tGot: string[] = [];
    const dGot: string[] = [];
    nodeB.subscribe(rooms.ticket('tk1'), (e) => tGot.push(e.event));
    nodeB.subscribe(rooms.customerDisplay('disp1'), (e) => dGot.push(e.event));
    nodeA.toTicket('tk1', EVENTS.checkoutTotalRecalculated, {});
    nodeA.toCustomerDisplay('disp1', EVENTS.customerDisplayTipSelected, {});
    expect(tGot).toEqual([EVENTS.checkoutTotalRecalculated]);
    expect(dGot).toEqual([EVENTS.customerDisplayTipSelected]);
  });

  it('one PUBLISH per emit — fan-out is via the channel, not a local short-circuit', async () => {
    const { bus, nodeA } = await twoNodes();
    nodeA.toTenant(A, EVENTS.paymentApproved, {});
    expect(bus.publishCount).toBe(1);
  });

  it('falls back to local delivery when publish fails (Redis hiccup) so this node still updates', async () => {
    const localA = new InProcessEmitter();
    const failing: RealtimePubSub = { publish() { throw new Error('redis down'); }, subscribe() { /* none */ } };
    const nodeA = new RedisRealtimeEmitter(localA, failing, 'aps:test');
    await nodeA.init();
    const aGot: string[] = [];
    nodeA.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => aGot.push(e.event));
    nodeA.toTenant(A, EVENTS.reportsUpdated, {});
    expect(aGot).toEqual([EVENTS.reportsUpdated]); // delivered locally despite the publish failure
  });
});

// Phase 11 (found while checking agent C's note): a WORKER booted with REALTIME_BUS=redis while Redis was unreachable
// CRASHED at start — `void emitter.init()` left the subscribe's rejection unhandled (MaxRetriesPerRequestError), and the
// comment beside it claimed failures fell back to local delivery. init() now swallows the failure (local delivery, a
// warning, retry on the next publish) and never rejects.
describe('RedisRealtimeEmitter with an unreachable Redis', () => {
  it('init() resolves (never rejects) when subscribe fails, and local delivery still works', async () => {
    const local = new InProcessEmitter();
    const dead = { publish: async () => { throw new Error('ECONNREFUSED'); }, subscribe: async () => { throw new Error('MaxRetriesPerRequestError'); } } as any;
    const node = new RedisRealtimeEmitter(local, dead, 'aps:test');
    await expect(node.init()).resolves.toBeUndefined();
    const got: any[] = []; local.subscribe(rooms.tenantBranch('t1', 'b1'), (e) => got.push(e));
    node.toTenant({ tenantId: 't1', branchId: 'b1' } as any, EVENTS.QUEUE_UPDATED as any, { ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toHaveLength(1);
  });
});
