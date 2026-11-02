// constitution-9-named-tests.vitest.spec — Constitution 9 Phase 23: the tests §220–245 name, run against the real
// stream factory (the exact code path every SSE endpoint uses). Environment-bound cases (§236 gateway kill,
// §237 Redis restart, §240 mobile background, §243 multi-day soak) are NOT simulated here; the §254 DoD names them.
import { describe, it, expect } from 'vitest';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeStreamFactory } from './realtime-stream';
import { RealtimeController } from './realtime.controller';
import { OwnerRealtimeController } from '../domain-streams/owner-realtime.controller';
import { TechRealtimeController } from '../domain-streams/tech-realtime.controller';
import { CustomerRealtimeController } from '../domain-streams/customer-realtime.controller';
import { SuperAdminRealtimeController } from '../super-admin-system-status/super-admin-realtime.controller';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';
import { assertSupportScope, supportSessionVersionPart } from './support-session-realtime';
import { InMemoryPresenceStore, PresenceService } from './presence';

const A = { tenantId: 't-A', branchId: 'b-A1', userId: 'u-A', role: 'MANAGER', permissions: ['pos.login'] };
const B = { tenantId: 't-B', branchId: 'b-B1', userId: 'u-B', role: 'MANAGER', permissions: ['pos.login'] };
const settle = () => new Promise((r) => setTimeout(r, 8));
/** Open a stream for ctx, collect event names until closed. */
function listen(ctrlStream: (req: any) => any, ctx: any, extra: Record<string, unknown> = {}) {
  const seen: string[] = []; const payloads: unknown[] = [];
  const sub = ctrlStream({ ctx, headers: {}, ...extra }).subscribe((f: any) => { seen.push(f.data.event); payloads.push(f.data.payload); });
  return { seen, payloads, close: () => sub.unsubscribe() };
}

describe('§220 tenant isolation — Tenant A user cannot receive Tenant B across every domain', () => {
  it('tenant, branch, queue, appointments, technicians, checkout: nothing of B reaches A', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    const a = listen((r) => pos.stream(r), A); await settle();
    bus.toTenant(B, EVENTS.queueUpdated); bus.toTenant(B, EVENTS.appointmentCreated); bus.toTenant(B, EVENTS.ticketPaid);
    bus.toTechnician('tech-of-B', EVENTS.ticketAssigned); bus.toOwner('t-B', EVENTS.ownerAlertCreated); bus.toTicket('ticket-of-B', EVENTS.serviceStarted);
    bus.toTenant(A, EVENTS.queueUpdated);
    a.close();
    expect(a.seen).toEqual(['connected', 'queue_updated']);       // exactly one, and it is A's own
  });
});

describe('§221 branch isolation', () => {
  it('a manager on Branch A1 does not receive Branch A2 of the SAME tenant', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    const a1 = listen((r) => pos.stream(r), A); await settle();
    bus.toTenant({ tenantId: 't-A', branchId: 'b-A2' }, EVENTS.queueUpdated);
    bus.toTenant({ tenantId: 't-A', branchId: 'b-A1' }, EVENTS.ticketPaid);
    a1.close();
    expect(a1.seen).toEqual(['connected', 'ticket_paid']);
  });
});

describe('§222 customer isolation', () => {
  it('Customer A never receives Customer B\'s room; the customer room is resolved from the SESSION, not the request', async () => {
    const bus = new InProcessEmitter();
    const repo = { resolveCustomerId: async (c: any) => (c.userId === 'u-custA' ? 'cust-A' : 'cust-B'), customerBranchId: async () => 'b-A1' } as any;
    const ctrl = new CustomerRealtimeController(new RealtimeStreamFactory(bus), repo);
    const a = listen((r) => ctrl.stream(r), { tenantId: 't-A', branchId: '', userId: 'u-custA', role: 'CUSTOMER', permissions: [] }, { query: { customerId: 'cust-B' } });
    await settle();
    bus.toCustomer('cust-B', EVENTS.customerFollowUpReceived);
    bus.toCustomer('cust-A', EVENTS.customerFollowUpReceived);
    a.close();
    expect(a.seen).toEqual(['connected', 'customer_follow_up_received']);
    expect(bus.subscriberCount(rooms.customer('cust-B'))).toBe(0);
  });
});

describe('§223 technician isolation', () => {
  it('a technician receives only their own room + their branch, and NEVER a payload (event-only frames)', async () => {
    const bus = new InProcessEmitter();
    const repo = { resolveTechnicianId: async (c: any) => (c.userId === 'u-techA' ? 'tech-A' : 'tech-B') } as any;
    const ctrl = new TechRealtimeController(new RealtimeStreamFactory(bus), repo);
    const t = listen((r) => ctrl.stream(r), { tenantId: 't-A', branchId: 'b-A1', userId: 'u-techA', role: 'TECHNICIAN', permissions: [] }); await settle();
    bus.toTechnician('tech-B', EVENTS.ticketAssigned, { customerName: 'Priya Patel', phone: '555-0199' });
    bus.toTechnician('tech-A', EVENTS.ticketAssigned, { customerName: 'Priya Patel', phone: '555-0199' });
    bus.toTenant({ tenantId: 't-A', branchId: 'b-A1' }, EVENTS.queueUpdated, { customerName: 'Priya Patel' });
    t.close();
    expect(t.seen).toEqual(['connected', 'ticket_assigned', 'queue_updated']);
    expect(JSON.stringify(t.payloads)).not.toMatch(/Priya|555-0199/);   // §22/§223: private data never rides the tech stream
  });
});

describe('§224 platform isolation', () => {
  it('a tenant stream is never subscribed to the platform room; platform aggregates do not reach a tenant or a customer', async () => {
    const bus = new InProcessEmitter(); const f = new RealtimeStreamFactory(bus);
    const pos = new RealtimeController(f); const owner = new OwnerRealtimeController(f);
    const a = listen((r) => pos.stream(r), A); const o = listen((r) => owner.stream(r), { ...A, role: 'OWNER' }); await settle();
    bus.toPlatform(EVENTS.platformOpsSnapshot, { activeTenants: 9 });
    a.close(); o.close();
    expect(a.seen).toEqual(['connected']); expect(o.seen).toEqual(['connected']);
    expect(bus.subscriberCount(rooms.platform())).toBe(0);
  });
  it('the Super Admin stream is behind SuperAdminGuard — a tenant or customer principal is refused at the guard, before any room exists', async () => {
    const { SuperAdminGuard } = await import('@aipowersalon/permissions/guards');
    const guard = new SuperAdminGuard();
    const ctxFor = (role: string) => ({ switchToHttp: () => ({ getRequest: () => ({ ctx: { ...A, role } }) }) }) as any;
    let tenantOk = true; try { tenantOk = guard.canActivate(ctxFor('MANAGER')) as boolean; } catch { tenantOk = false; }
    let custOk = true; try { custOk = guard.canActivate(ctxFor('CUSTOMER')) as boolean; } catch { custOk = false; }
    expect(tenantOk).toBe(false); expect(custOk).toBe(false);
    expect(guard.canActivate(ctxFor('SUPER_ADMIN'))).toBe(true);
    expect(new SuperAdminRealtimeController(new RealtimeStreamFactory(new InProcessEmitter()))).toBeTruthy();
  });
});

describe('§225 support mode — the two named tests, at the transport', () => {
  // The scope and expiry rules live in support-session-realtime.ts and are exercised exhaustively there.
  // These two are the constitution's own wording, run against the real emitter so §225 is covered HERE too —
  // this file is the index of what §220–245 actually name, and a gap in it reads as "not built".
  const NOW = new Date('2026-09-20T12:00:00Z');
  const session = { sessionId: 's1', tenantId: 'A', expiresAt: '2026-09-20T14:00:00Z', endedAt: null };

  it('"Support session Tenant A cannot subscribe Tenant B"', () => {
    expect(assertSupportScope(session, 'A', NOW).tenantId).toBe('A');
    expect(() => assertSupportScope(session, 'B', NOW)).toThrow(/different tenant/);
  });

  it('"Expired support session loses streams" — the version changes, so the poll terminates it', () => {
    const open = supportSessionVersionPart(session, NOW);
    expect(supportSessionVersionPart(session, new Date('2026-09-20T14:00:01Z'))).not.toBe(open);
  });
});

describe('§229 out-of-order versions on the client contract', () => {
  it('version 9 then version 8 for the same resource: 8 is dropped, state remains 9 (EventTracker)', async () => {
    const { EventTracker } = await import('./realtime-transport-core');
    const t = new EventTracker();
    expect(t.shouldApply({ eventId: 'e9', resourceType: 'appointment', resourceId: 'ap-1', version: 9 })).toBe(true);
    expect(t.shouldApply({ eventId: 'e8', resourceType: 'appointment', resourceId: 'ap-1', version: 8 })).toBe(false);
    expect(t.shouldApply({ eventId: 'e10', resourceType: 'appointment', resourceId: 'ap-1', version: 10 })).toBe(true);
  });
});

describe('§239 security — faked scope in the request is ignored; channels cannot be enumerated', () => {
  it('query/body tenantId, branchId, role and room names are never consulted: the room comes from the server context', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    const a = listen((r) => pos.stream(r), A, { query: { tenantId: 't-B', branchId: 'b-B1', role: 'SUPER_ADMIN', room: rooms.tenantBranch('t-B', 'b-B1'), channel: 'platform:live-ops' }, body: { tenantId: 't-B' } });
    await settle();
    bus.toTenant(B, EVENTS.queueUpdated); bus.toPlatform(EVENTS.platformOpsSnapshot, {});
    bus.toTenant(A, EVENTS.queueUpdated);
    a.close();
    expect(a.seen).toEqual(['connected', 'queue_updated']);
    expect(bus.subscriberCount(rooms.tenantBranch('t-B', 'b-B1'))).toBe(0);
  });
});

describe('§232/§242/§244 reconnect storm, churn, leaks', () => {
  it('2,000 distinct principals open and close streams: every room and every presence entry is released; the gateway answers the next open immediately', async () => {
    const bus = new InProcessEmitter(); const presence = new PresenceService(new InMemoryPresenceStore());
    const pos = new RealtimeController(new RealtimeStreamFactory(bus, undefined, null, presence));
    const t0 = Date.now(); const subs: Array<{ unsubscribe(): void }> = [];
    for (let i = 0; i < 2000; i++) subs.push(pos.stream({ ctx: { tenantId: `t-${i % 50}`, branchId: `b-${i % 7}`, userId: `u-${i}`, role: 'MANAGER', permissions: [] }, headers: {} }).subscribe());
    await settle();
    expect(bus.totalSubscribers()).toBe(2000);
    expect((await presence.platformView()).connections).toBe(2000);
    for (const s of subs) s.unsubscribe();
    await settle();
    expect(bus.totalSubscribers()).toBe(0);                                        // §243 subscription leak: none
    expect((await presence.platformView()).connections).toBe(0);                  // presence released with the socket
    const after = pos.stream({ ctx: A, headers: {} }).subscribe(); await settle();
    expect(bus.totalSubscribers()).toBe(1); after.unsubscribe();
    expect(Date.now() - t0).toBeLessThan(5000);                                    // 2k open+close well under 5s in-process
  });
});

describe('§234/§235 fan-out load and large tenants', () => {
  it('one branch event fans out to 1,000 connected devices on that branch and to none of the other 49 branches', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    const counts = new Map<string, number>();
    const subs = [];
    for (let i = 0; i < 1000; i++) { const b = `b-${i % 50}`; subs.push(pos.stream({ ctx: { tenantId: 't-big', branchId: b, userId: `u-${i}`, role: 'FRONT_DESK', permissions: [] }, headers: {} }).subscribe((f: any) => { if (f.data.event === 'queue_updated') counts.set(b, (counts.get(b) ?? 0) + 1); })); }
    await settle();
    const t0 = performance.now();
    bus.toTenant({ tenantId: 't-big', branchId: 'b-7' }, EVENTS.queueUpdated);
    const ms = performance.now() - t0;
    for (const s of subs) s.unsubscribe();
    expect(counts.get('b-7')).toBe(20);                                             // 1000 devices / 50 branches
    expect([...counts.keys()]).toEqual(['b-7']);                                    // §235: a 50-branch tenant is 50 independent rooms
    expect(ms).toBeLessThan(50);
  });
});

describe('§245 protocol compatibility', () => {
  it('a legacy client that sends a plain numeric Last-Event-ID and ignores seq/stream still gets a correct stream', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    bus.toTenant(A, EVENTS.queueUpdated); bus.toTenant(A, EVENTS.queueUpdated);
    const a = listen((r) => pos.stream(r), A, { headers: { 'last-event-id': '1' } }); await settle(); a.close();
    expect(a.seen).toEqual(['resync_required']);                                    // legacy id understood: it is behind, told to resync
    const b = listen((r) => pos.stream(r), A, { headers: { 'last-event-id': '2' } }); await settle(); b.close();
    expect(b.seen).toEqual(['connected']);
  });
});

describe('§236/§237 gateway restart and backbone reset', () => {
  it('§236 a client reconnecting to a FRESH gateway (empty local memory) is still told to resync when the shared counter has moved on', async () => {
    const { RedisRealtimeEmitter } = await import('./realtime-bus');
    // A shared counter the way Redis holds it; gateway 1 mints seqs, then "dies"; gateway 2 starts with nothing local.
    const counters = new Map<string, number>();
    const shared = { publish() {}, subscribe() {}, nextSeq: (r: string) => { const n = (counters.get(r) ?? 0) + 1; counters.set(r, n); return n; }, currentSeq: (r: string) => counters.get(r) ?? 0 };
    const gw1 = new RedisRealtimeEmitter(new InProcessEmitter(), shared, 'aps:test'); await gw1.init();
    gw1.toTenant(A, EVENTS.queueUpdated); gw1.toTenant(A, EVENTS.queueUpdated); gw1.toTenant(A, EVENTS.queueUpdated);   // room at 3
    const gw2 = new RedisRealtimeEmitter(new InProcessEmitter(), shared, 'aps:test'); await gw2.init();       // fresh process
    expect(gw2.currentSeq(rooms.tenantBranch('t-A', 'b-A1'))).toBe(0);                                          // local memory knows nothing
    const pos = new RealtimeController(new RealtimeStreamFactory(gw2 as any));
    const a = listen((r) => pos.stream(r), A, { headers: { 'last-event-id': 'r0:1' } }); await settle(); a.close();
    expect(a.seen).toEqual(['resync_required']);                                                               // the shared counter says 3
    const b = listen((r) => pos.stream(r), A, { headers: { 'last-event-id': 'r0:3' } }); await settle(); b.close();
    expect(b.seen).toEqual(['connected']);
  });
  it('§237 the counter was reset under the client (Redis restart): a client AHEAD of the server is told to resync, not silently accepted', async () => {
    const bus = new InProcessEmitter(); const pos = new RealtimeController(new RealtimeStreamFactory(bus));
    bus.toTenant(A, EVENTS.queueUpdated);                                                                       // server at 1
    const a = listen((r) => pos.stream(r), A, { headers: { 'last-event-id': 'r0:40' } }); await settle(); a.close();   // client remembers 40
    expect(a.seen).toEqual(['resync_required']);
  });
  it('§237 while the backbone is down, delivery falls back to this node so PostgreSQL-backed state still reaches local clients; publish failures are counted for the health verdict', async () => {
    const { RedisRealtimeEmitter } = await import('./realtime-bus');
    const local = new InProcessEmitter();
    const down = { publish() { throw new Error('ECONNREFUSED'); }, subscribe() {} };
    const gw = new RedisRealtimeEmitter(local, down, 'aps:test');
    const seen: string[] = []; gw.subscribe(rooms.tenantBranch('t-A', 'b-A1'), (e) => seen.push(e.event));
    gw.toTenant(A, EVENTS.ticketPaid); gw.toTenant(A, EVENTS.ticketPaid);
    expect(seen).toEqual(['ticket_paid', 'ticket_paid']);
    expect(local.metrics.backbonePublishFailures).toBe(2);
  });
});
