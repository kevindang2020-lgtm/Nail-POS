// platform-live-ops.vitest.spec — Constitution 9 Phase 20: §59/§60/§146/§206 — the Super Admin stream carries
// aggregates only, published only while someone listens, and never a tenant's raw events or anyone's identity.
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeStreamFactory } from './realtime-stream';
import { PlatformLiveOpsService, PlatformLiveOpsConsumer, RateBuckets } from './platform-live-ops';
import { SuperAdminRealtimeController } from '../super-admin-system-status/super-admin-realtime.controller';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';
import { DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';

const sa = { tenantId: '', branchId: '', userId: 'u-sa', role: 'SUPER_ADMIN', permissions: [] };
const evt = (type: any, tenantId: string) => createDomainEvent({ eventType: type, tenantId, branchId: 'b-1', payload: { customerName: 'Priya Patel', total: 90 }, actor: { kind: 'user', id: 'u-1' } } as any);

describe('§60 counters', () => {
  it('the consumer counts payments/queue joins/bookings per minute and active tenants — and reads nothing from payloads', async () => {
    const c = { t: 1_000_000 }; const rates = new RateBuckets(() => c.t); const consumer = new PlatformLiveOpsConsumer(rates);
    await consumer.handle(evt(DOMAIN_EVENTS.PAYMENT_CAPTURED, 't-1'), null as any);
    await consumer.handle(evt(DOMAIN_EVENTS.PAYMENT_CAPTURED, 't-2'), null as any);
    await consumer.handle(evt(DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED, 't-1'), null as any);
    await consumer.handle(evt(DOMAIN_EVENTS.APPOINTMENT_CREATED, 't-3'), null as any);
    c.t += 60_000;                                                    // the minute completes
    expect(rates.perMinute('payments')).toBe(2); expect(rates.perMinute('queue_joins')).toBe(1); expect(rates.perMinute('bookings')).toBe(1);
    expect(rates.activeTenantCount()).toBe(3);
    c.t += 6 * 60_000; expect(rates.activeTenantCount()).toBe(0);    // 5-minute window
    expect(consumer.replay).toBe('REPLAY_SAFE');                      // transient counters: replay is harmless
  });
});

describe('§59/§146 the platform stream', () => {
  it('publishes ONLY while a Super Admin is listening, and the snapshot carries counts + health, no identities', async () => {
    const bus = new InProcessEmitter(); const ops = new PlatformLiveOpsService(bus);
    expect(await ops.tick()).toBe(false);                             // nobody listening: no work, no emission
    const ctrl = new SuperAdminRealtimeController(new RealtimeStreamFactory(bus));
    const out = firstValueFrom(ctrl.stream({ ctx: sa, headers: {} }).pipe(take(2), toArray()));
    await new Promise((r) => setTimeout(r, 10));                      // let the (sync) room resolution subscribe
    expect(await ops.tick()).toBe(true);
    const frames: any[] = await out;
    expect(frames[1].data.event).toBe(EVENTS.platformOpsSnapshot);
    const snap = frames[1].data.payload.data;                         // sealed envelope (§20) wraps the aggregate
    expect(frames[1].data.payload.tenantId).toBeFalsy();               // a platform emission is scoped to no tenant
    expect(Object.keys(snap).sort()).toEqual(['activeTenants', 'at', 'bookingsPerMinute', 'connectedTenants', 'connections', 'eventsPerMinute', 'health', 'latencyP95Ms', 'paymentsPerMinute', 'queueJoinsPerMinute']);
    expect(JSON.stringify(snap)).not.toMatch(/Priya|customer|tenant-|t-1|email|phone/i);   // §60/§206: aggregates only
  });
  it('§146 a Super Admin is subscribed to the platform room and NOTHING else — a branch event never reaches it', async () => {
    const bus = new InProcessEmitter(); const ctrl = new SuperAdminRealtimeController(new RealtimeStreamFactory(bus));
    const seen: string[] = [];
    const sub = ctrl.stream({ ctx: sa, headers: {} }).subscribe((f: any) => seen.push(f.data.event));
    await new Promise((r) => setTimeout(r, 10));
    bus.toTenant({ tenantId: 't-1', branchId: 'b-1' }, EVENTS.ticketPaid, { total: 120 });
    bus.toOwner('t-1', EVENTS.ownerAlertCreated, {});
    bus.toPlatform(EVENTS.platformOpsSnapshot, { activeTenants: 1 });
    sub.unsubscribe();
    expect(seen).toEqual(['connected', EVENTS.platformOpsSnapshot]);
    expect(bus.subscriberCount(rooms.tenantBranch('t-1', 'b-1'))).toBe(0);
  });
});
