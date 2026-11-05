// display-nudge.vitest.spec.ts — 23-inch dual-screen spec §36–§37 and §100. Any tenant event that names ONE ticket is
// mirrored (ids only) into that ticket's room as customer_display_checkout_updated, so a display showing the ticket
// refreshes in under a second whichever path changed it — on BOTH emitters (single-node and the Redis bus). The
// display's own channel (customer_display:device:{id}) is a separate room from every session room.
import { describe, it, expect } from 'vitest';
import { EVENTS, rooms, displayNudgeTicketId } from '@aipowersalon/realtime-contracts';
import { InProcessEmitter } from './realtime.gateway';
import { RedisRealtimeEmitter } from './realtime-bus';

const CTX = { tenantId: 't1', branchId: 'b1' };

function capture(em: { subscribe(room: string, fn: (e: any) => void): () => void }, room: string) {
  const seen: { event: string; payload: any }[] = [];
  em.subscribe(room, (e) => seen.push({ event: e.event, payload: e.payload }));
  return seen;
}

describe('displayNudgeTicketId', () => {
  it('names the ticket for any ticket-scoped event', () => {
    expect(displayNudgeTicketId(EVENTS.ticketServiceLineAdded, { ticketId: 'tk-1' })).toBe('tk-1');
    expect(displayNudgeTicketId(EVENTS.ticketPaid, { ticketId: 'tk-1' })).toBe('tk-1');
    expect(displayNudgeTicketId(EVENTS.checkoutTotalRecalculated, { ticketId: 'tk-1' })).toBe('tk-1');
  });
  it('is null when no single ticket is named, or the event is already a display event (no self-trigger)', () => {
    expect(displayNudgeTicketId(EVENTS.queueUpdated, { queueItemId: 'q' })).toBeNull();
    expect(displayNudgeTicketId(EVENTS.paymentFailed, { ticketId: null })).toBeNull();
    expect(displayNudgeTicketId(EVENTS.reportsUpdated, {})).toBeNull();
    expect(displayNudgeTicketId(EVENTS.customerDisplaySessionStarted, { ticketId: 'tk-1' })).toBeNull();
    expect(displayNudgeTicketId(EVENTS.customerDisplayCheckoutUpdated, { ticketId: 'tk-1' })).toBeNull();
  });
});

describe('the in-process emitter (single node)', () => {
  it('a POS change to a ticket reaches that ticket room as customer_display_checkout_updated', () => {
    const em = new InProcessEmitter();
    const ticketRoom = capture(em, rooms.ticket('tk-1'));
    em.toTenant(CTX, EVENTS.ticketServiceLineAdded, { ticketId: 'tk-1' });
    em.toTenant(CTX, EVENTS.ticketPaid, { ticketId: 'tk-1' });
    expect(ticketRoom.map((e) => e.event)).toEqual([EVENTS.customerDisplayCheckoutUpdated, EVENTS.customerDisplayCheckoutUpdated]);
    expect(ticketRoom[0].payload).toMatchObject({ eventType: EVENTS.customerDisplayCheckoutUpdated, data: { ticketId: 'tk-1' } });   // the sealed envelope (§12)
  });
  it('the mirror carries ids only (no amounts, names or anything else from the original payload)', () => {
    const em = new InProcessEmitter();
    const ticketRoom = capture(em, rooms.ticket('tk-1'));
    em.toTenant(CTX, EVENTS.paymentApproved, { ticketId: 'tk-1', method: 'card', amountCents: 14240 });
    const p = ticketRoom[0].payload;
    expect(p.data).toEqual({ ticketId: 'tk-1' });
    expect(JSON.stringify(p)).not.toContain('14240');
    expect(JSON.stringify(p)).not.toContain('card');
  });
  it('another ticket and an event without a ticket do not reach the room', () => {
    const em = new InProcessEmitter();
    const ticketRoom = capture(em, rooms.ticket('tk-1'));
    em.toTenant(CTX, EVENTS.ticketServiceLineAdded, { ticketId: 'tk-2' });
    em.toTenant(CTX, EVENTS.queueUpdated, { queueItemId: 'q1' });
    expect(ticketRoom).toEqual([]);
  });
  it('the tenant room still gets the original event exactly once', () => {
    const em = new InProcessEmitter();
    const tenantRoom = capture(em, rooms.tenantBranch('t1', 'b1'));
    em.toTenant(CTX, EVENTS.ticketServiceLineAdded, { ticketId: 'tk-1' });
    expect(tenantRoom.map((e) => e.event)).toEqual([EVENTS.ticketServiceLineAdded]);
  });
  it('the device channel is its own room — a session room or another device never hears it', () => {
    const em = new InProcessEmitter();
    const mine = capture(em, rooms.customerDisplayDevice('dev-1'));
    const other = capture(em, rooms.customerDisplayDevice('dev-2'));
    const sessionRoom = capture(em, rooms.customerDisplay('dev-1'));
    em.toCustomerDisplayDevice('dev-1', EVENTS.customerDisplaySessionStarted, { sessionId: 's1' });
    expect(mine.map((e) => e.event)).toEqual([EVENTS.customerDisplaySessionStarted]);
    expect(other).toEqual([]);
    expect(sessionRoom).toEqual([]);
    expect(rooms.customerDisplayDevice('dev-1')).toBe('customer_display:device:dev-1');
  });
});

describe('the Redis-backed emitter (multi node)', () => {
  it('mirrors the same way, through the shared bus', async () => {
    const counters = new Map<string, number>();
    const subs: ((m: string) => void)[] = [];
    const shared = {
      publish: (_ch: string, m: string) => { for (const s of subs) s(m); },
      subscribe: (_ch: string, fn: (m: string) => void) => { subs.push(fn); },
      nextSeq: (r: string) => { const n = (counters.get(r) ?? 0) + 1; counters.set(r, n); return n; },
      currentSeq: (r: string) => counters.get(r) ?? 0,
    };
    const local = new InProcessEmitter();
    const bus = new RedisRealtimeEmitter(local, shared as any, 'aps:test');
    await bus.init();
    const ticketRoom = capture(local, rooms.ticket('tk-9'));
    const deviceRoom = capture(local, rooms.customerDisplayDevice('dev-9'));
    bus.toTenant(CTX, EVENTS.ticketServiceLineRemoved, { ticketId: 'tk-9' });
    bus.toCustomerDisplayDevice('dev-9', EVENTS.customerDisplayCanceled, { sessionId: 's9' });
    expect(ticketRoom.map((e) => e.event)).toEqual([EVENTS.customerDisplayCheckoutUpdated]);
    expect(deviceRoom.map((e) => e.event)).toEqual([EVENTS.customerDisplayCanceled]);
  });
});
