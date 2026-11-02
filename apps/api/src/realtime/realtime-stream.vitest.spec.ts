// realtime-stream.vitest.spec — Constitution 9 §7 one gateway: multi-room streams carry per-room sequences and a
// vector Last-Event-ID, so a reconnect is checked for a gap on EVERY room, and realm frames minimize payload (§22).
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeStreamFactory, encodeSeqVector, decodeSeqVector } from './realtime-stream';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';

const ctx = { tenantId: 't-1', branchId: 'b-1', userId: 'u-tech', role: 'TECHNICIAN', permissions: [] };
const branch = rooms.tenantBranch('t-1', 'b-1'); const mine = rooms.technician('tech-9');
const frames = (f: RealtimeStreamFactory, req: any, n: number, mode: 'full' | 'event-only' = 'full') =>
  firstValueFrom(f.open(req, async () => [branch, mine], { frame: mode }).pipe(take(n), toArray()));

describe('seq vector encoding', () => {
  it('round-trips, and accepts the legacy single-number id from clients that predate multi-room streams', () => {
    expect(encodeSeqVector([42, 7])).toBe('r0:42|r1:7');
    expect([...decodeSeqVector('r0:42|r1:7')]).toEqual([[0, 42], [1, 7]]);
    expect([...decodeSeqVector('17')]).toEqual([[0, 17]]);
    expect(decodeSeqVector('').size).toBe(0);
  });
});

describe('§32 a two-room stream', () => {
  it('numbers each room independently, labels frames by stream slot, and the SSE id carries the whole vector', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    setTimeout(() => { bus.toTenant(ctx, EVENTS.queueUpdated); bus.toTechnician('tech-9', EVENTS.followUpTaskUpdated); bus.toTenant(ctx, EVENTS.ticketPaid); }, 10);
    const out: any[] = await frames(f, { ctx, headers: {} }, 4);
    expect(out[0].data).toMatchObject({ event: 'connected', seqs: { r0: 0, r1: 0 } });
    expect(out[1]).toMatchObject({ id: 'r0:1|r1:0', data: { event: 'queue_updated', seq: 1, stream: 'r0' } });
    expect(out[2]).toMatchObject({ id: 'r0:1|r1:1', data: { event: 'follow_up_task_updated', seq: 1, stream: 'r1' } });
    expect(out[3]).toMatchObject({ id: 'r0:2|r1:1', data: { event: 'ticket_paid', seq: 2, stream: 'r0' } });
  });
  it('§36 a reconnect that is current on the branch room but BEHIND on the technician room is told to resync', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    bus.toTenant(ctx, EVENTS.queueUpdated);                       // branch at 1
    bus.toTechnician('tech-9', EVENTS.followUpTaskUpdated);       // mine at 1
    bus.toTechnician('tech-9', EVENTS.followUpTaskUpdated);       // mine at 2 — missed while down
    const out: any[] = await frames(f, { ctx, headers: { 'last-event-id': 'r0:1|r1:1' } }, 1);
    expect(out[0].data).toMatchObject({ event: 'resync_required', reason: 'sequence_gap', seqs: { r0: 1, r1: 2 } });
    const clean: any[] = await frames(f, { ctx, headers: { 'last-event-id': 'r0:1|r1:2' } }, 1);
    expect(clean[0].data.event).toBe('connected');
  });
  it('§22 event-only frames carry no payload — a technician never receives the branch payload through their stream', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    setTimeout(() => bus.toTenant(ctx, EVENTS.ticketPaid, { ticketId: 'tk-1', total: 120 }), 10);
    const out: any[] = await frames(f, { ctx, headers: {} }, 2, 'event-only');
    expect(out[1].data).not.toHaveProperty('payload');
    expect(out[1].data).toMatchObject({ event: 'ticket_paid', screens: expect.any(Array), stream: 'r0' });
  });
  it('rooms that resolve AFTER the stream is closed subscribe nothing (no leaked subscriber)', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    let resolve!: (r: string[]) => void;
    const sub = f.open({ ctx, headers: {} }, () => new Promise<string[]>((r) => { resolve = r; })).subscribe();
    sub.unsubscribe();
    resolve([branch, mine]); await new Promise((r) => setTimeout(r, 5));
    expect(bus.subscriberCount(branch)).toBe(0); expect(bus.subscriberCount(mine)).toBe(0);
  });
});

describe('graceful gateway shutdown (DoD)', () => {
  it('drain() tells every live client to reconnect with jitter, completes their streams, and answers a late open the same way', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    const got: any[][] = [[], []]; const done = [false, false];
    const subs = [0, 1].map((i) => f.open({ ctx: { ...ctx, userId: `u-${i}` }, headers: {} }, () => [branch]).subscribe({ next: (m: any) => got[i].push(m.data), complete: () => { done[i] = true; } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(f.liveCount).toBe(2);
    expect(f.drain(1500)).toBe(2);
    for (const i of [0, 1]) {
      expect(got[i][got[i].length - 1]).toMatchObject({ event: 'reconnect_requested', reason: 'server_shutdown', jitterMs: 1500 });
      expect(done[i]).toBe(true);
    }
    expect(f.liveCount).toBe(0);
    expect(bus.subscriberCount(branch)).toBe(0);                       // rooms released
    // a client that opens while we are draining is redirected immediately
    const late: any[] = []; let lateDone = false;
    f.open({ ctx, headers: {} }, () => [branch]).subscribe({ next: (m: any) => late.push(m.data), complete: () => { lateDone = true; } });
    expect(late[0]).toMatchObject({ event: 'reconnect_requested' }); expect(lateDone).toBe(true);
    expect(f.drain()).toBe(0);                                         // idempotent
    subs.forEach((s) => s.unsubscribe());
  });
});
