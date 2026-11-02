// realtime-resync.vitest.spec — Constitution 9 §33/§36: the SSE stream carries the room seq as the frame id, and
// a reconnect that arrives BEHIND the room is told RESYNC_REQUIRED as its very first frame. No replay archive is
// kept (§11): the client reloads its snapshot and resumes.
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { RealtimeStreamFactory } from './realtime-stream';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';

const ctx = { tenantId: 'tenant-A', branchId: 'branch-1', userId: 'u-1', role: 'OWNER', permissions: [] };
const req = (lastEventId?: string) => ({ ctx, headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId } });
const frames = (ctrl: RealtimeController, r: any, n: number) => firstValueFrom(ctrl.stream(r).pipe(take(n), toArray()));

describe('§31 frames carry the room sequence', () => {
  it('each SSE message has id = seq and repeats seq in data; the hello carries the room\'s current seq', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    setTimeout(() => { bus.toTenant(ctx, EVENTS.queueUpdated); bus.toTenant(ctx, EVENTS.ticketPaid); }, 5);
    const out: any[] = await frames(ctrl, req(), 3);
    expect(out[0].data).toMatchObject({ event: 'connected', seq: 0 });
    expect(out[1]).toMatchObject({ id: 'r0:1', data: { event: 'queue_updated', seq: 1, stream: 'r0' } });
    expect(out[2]).toMatchObject({ id: 'r0:2', data: { event: 'ticket_paid', seq: 2, stream: 'r0' } });
  });
});

describe('§33/§36 reconnect with a gap', () => {
  it('a client that last saw seq 2 reconnecting to a room now at seq 5 gets resync_required FIRST', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    for (let i = 0; i < 5; i++) bus.toTenant(ctx, EVENTS.queueUpdated);         // the room moved on while the socket was down
    const out: any[] = await frames(ctrl, req('2'), 1);
    expect(out[0].data).toMatchObject({ event: 'resync_required', reason: 'sequence_gap', seq: 5 });
    expect(bus.metrics.resyncsRequired).toBe(1);
    expect(bus.metrics.reconnects).toBe(1);
  });

  it('a client that last saw the CURRENT seq reconnects cleanly — no resync, nothing was missed', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    for (let i = 0; i < 3; i++) bus.toTenant(ctx, EVENTS.queueUpdated);
    const out: any[] = await frames(ctrl, req('3'), 1);
    expect(out[0].data).toMatchObject({ event: 'connected', seq: 3 });
    expect(bus.metrics.resyncsRequired).toBe(0);
  });

  it('a first connection (no Last-Event-ID) is never told to resync — there is nothing to have missed', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    for (let i = 0; i < 9; i++) bus.toTenant(ctx, EVENTS.queueUpdated);
    const out: any[] = await frames(ctrl, req(), 1);
    expect(out[0].data.event).toBe('connected');
    expect(bus.metrics.reconnects).toBe(0);
  });

  it('§13/§19 the room is derived from the SERVER context — a reconnect cannot probe another tenant\'s seq', async () => {
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus));
    bus.toTenant({ tenantId: 'tenant-B', branchId: 'branch-1' }, EVENTS.queueUpdated);   // B is at 1
    const out: any[] = await frames(ctrl, req('0'), 1);                                  // A reconnects claiming 0
    expect(out[0].data).toMatchObject({ event: 'connected', seq: 0 });                  // A's room is at 0: no gap, no leak of B's state
    expect(rooms.tenantBranch('tenant-A', 'branch-1')).not.toBe(rooms.tenantBranch('tenant-B', 'branch-1'));
  });
});
