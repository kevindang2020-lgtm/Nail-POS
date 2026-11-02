import { describe, expect, it } from 'vitest';
import { InProcessEmitter } from './realtime.gateway';
import { EVENTS, rooms, screensToRefetch } from '@aipowersalon/realtime-contracts';

const A = { tenantId: 'tenant-A', branchId: 'branch-1' };
const B = { tenantId: 'tenant-B', branchId: 'branch-1' };

describe('realtime in-process bus', () => {
  it('delivers a tenant event to a subscriber on that tenant+branch room', () => {
    const bus = new InProcessEmitter();
    const got: string[] = [];
    bus.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => got.push(e.event));
    bus.toTenant(A, EVENTS.ticketPaid, { ticketId: 't1' });
    expect(got).toEqual([EVENTS.ticketPaid]);
  });

  it('isolates tenants: a subscriber for tenant A never receives tenant B events', () => {
    const bus = new InProcessEmitter();
    const aGot: string[] = [];
    const bGot: string[] = [];
    bus.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => aGot.push(e.event));
    bus.subscribe(rooms.tenantBranch(B.tenantId, B.branchId), (e) => bGot.push(e.event));
    bus.toTenant(B, EVENTS.queueUpdated, {});
    bus.toTenant(A, EVENTS.ticketPaid, {});
    expect(aGot).toEqual([EVENTS.ticketPaid]);   // A got only its own
    expect(bGot).toEqual([EVENTS.queueUpdated]); // B got only its own
  });

  it('unsubscribe stops further delivery and prunes the room', () => {
    const bus = new InProcessEmitter();
    const got: string[] = [];
    const room = rooms.tenantBranch(A.tenantId, A.branchId);
    const off = bus.subscribe(room, (e) => got.push(e.event));
    bus.toTenant(A, EVENTS.serviceDone, {});
    off();
    bus.toTenant(A, EVENTS.ticketPaid, {});
    expect(got).toEqual([EVENTS.serviceDone]); // nothing after unsubscribe
    expect(bus.subscriberCount(room)).toBe(0);
  });

  it('a broken subscriber cannot break the publisher or other subscribers', () => {
    const bus = new InProcessEmitter();
    const got: string[] = [];
    bus.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), () => { throw new Error('boom'); });
    bus.subscribe(rooms.tenantBranch(A.tenantId, A.branchId), (e) => got.push(e.event));
    expect(() => bus.toTenant(A, EVENTS.reportsUpdated, {})).not.toThrow();
    expect(got).toEqual([EVENTS.reportsUpdated]);
  });
});

describe('event → screens-to-refetch map', () => {
  it('ticket_paid refetches reports and dashboard', () => {
    const screens = screensToRefetch(EVENTS.ticketPaid);
    expect(screens).toContain('reports');
    expect(screens).toContain('dashboard');
  });
  it('queue_updated refetches the queue', () => {
    expect(screensToRefetch(EVENTS.queueUpdated)).toContain('queue');
  });
  it('an unknown event maps to no screens', () => {
    expect(screensToRefetch('not_a_real_event')).toEqual([]);
  });
});
