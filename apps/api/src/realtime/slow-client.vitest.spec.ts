// slow-client.vitest.spec — Constitution 9 §98/§102/§233: a connection that is not draining gets frames DROPPED
// (never queued without bound), one RESYNC_REQUIRED when it drains, and is cut if it stays stuck.
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { SlowClientGate } from './realtime-transport-core';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { RealtimeStreamFactory } from './realtime-stream';

describe('§102 SlowClientGate policy', () => {
  it('sends under the cap, drops over it, and recovers with exactly one resync once drained', () => {
    const g = new SlowClientGate(1000, 30_000);
    expect(g.admit(0, 0)).toBe('send');
    expect(g.admit(999, 0)).toBe('send');
    expect(g.admit(5000, 0)).toBe('drop');         // over: drop, mark out of sync
    expect(g.admit(5000, 0)).toBe('drop');
    expect(g.dropped).toBe(2);
    expect(g.recovered(5000)).toBe(false);        // still stuck: no resync yet
    expect(g.recovered(10)).toBe(true);           // drained: ONE resync
    expect(g.recovered(10)).toBe(false);          // not again
    expect(g.admit(10, 0)).toBe('send');
  });
  it('§98 disconnects a client that stays over the cap past the grace period', () => {
    const g = new SlowClientGate(1000, 30_000);
    expect(g.admit(5000, 0)).toBe('drop');
    expect(g.admit(5000, 29_999)).toBe('drop');
    expect(g.admit(5000, 30_000)).toBe('disconnect');
  });
  it('a dip under the cap resets the grace clock', () => {
    const g = new SlowClientGate(1000, 30_000);
    g.admit(5000, 0); g.admit(10, 20_000); expect(g.admit(5000, 40_000)).toBe('drop');   // only 0ms over since the dip
  });
});

describe('§102 on the real controller (pending bytes simulated via req.res.writableLength)', () => {
  const ctx = { tenantId: 'tenant-A', branchId: 'branch-1', userId: 'u-1', role: 'OWNER', permissions: [] };
  it('frames are dropped while the socket is backed up; a single resync_required follows the drain; nothing dropped is replayed', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    const res = { writableLength: 0 };
    const req = { ctx, headers: {}, res };
    setTimeout(() => {
      bus.toTenant(ctx, EVENTS.queueUpdated);                 // seq 1 — sent
      res.writableLength = 10 * 1024 * 1024;                  // client stops reading: 10 MB pending
      bus.toTenant(ctx, EVENTS.queueUpdated);                 // seq 2 — dropped
      bus.toTenant(ctx, EVENTS.ticketPaid);                   // seq 3 — dropped
      res.writableLength = 0;                                 // drained
      bus.toTenant(ctx, EVENTS.queueUpdated);                 // seq 4 — resync first, then sent
    }, 5);
    const out: any[] = await firstValueFrom(ctrl.stream(req).pipe(take(4), toArray()));
    expect(out.map((f) => f.data.event)).toEqual(['connected', 'queue_updated', 'resync_required', 'queue_updated']);
    expect(out[1].data.seq).toBe(1);
    expect(out[2].data).toMatchObject({ reason: 'slow_client', seq: 4 });
    expect(out[3].data.seq).toBe(4);                          // 2 and 3 are gone — the client resyncs, it does not get a replay
    expect(bus.metrics.slowClientDrops).toBe(2);
    expect(bus.metrics.slowClientResyncs).toBe(1);
  });
});
