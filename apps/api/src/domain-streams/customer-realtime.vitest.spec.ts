import { describe, it, expect } from 'vitest';
import { InProcessEmitter } from '../realtime/realtime.gateway';
import { rooms, EVENTS } from '@aipowersalon/realtime-contracts';
import { CustomerRealtimeController } from './customer-realtime.controller';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';

// Stub repo: this customer resolves to cust-1 at branch-1.
const repo = { resolveCustomerId: async () => 'cust-1', customerBranchId: async () => 'branch-1' } as any;
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

describe('CustomerRealtimeController (SSE)', () => {
  it('streams a connected hello, forwards tenant+branch events as NAME ONLY (no payload leak)', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new CustomerRealtimeController(new RealtimeStreamFactory(bus), repo);
    const got: any[] = [];
    const sub = ctrl.stream({ ctx: { tenantId: 'T', userId: 'U' } }).subscribe((m: any) => got.push(m.data));
    await tick(); // let the async room subscription attach
    bus.toTenant({ tenantId: 'T', branchId: 'branch-1' }, EVENTS.queueUpdated, { secret: 'another-customers-info' });
    await tick(5);
    sub.unsubscribe();
    expect(got[0]).toMatchObject({ event: 'connected' });   // Constitution 9: the hello also carries seq/seqs (§31)
    expect(got.find((d) => d.event === 'queue_updated')).toBeTruthy();
    expect(JSON.stringify(got)).not.toContain('secret'); // payloads are never forwarded to the customer
  });

  it('also forwards events sent to the customer\'s own room', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new CustomerRealtimeController(new RealtimeStreamFactory(bus), repo);
    const got: any[] = [];
    const sub = ctrl.stream({ ctx: { tenantId: 'T', userId: 'U' } }).subscribe((m: any) => got.push(m.data));
    await tick();
    bus.deliverLocal(rooms.customer('cust-1'), EVENTS.appointmentUpdated, {});
    await tick(5);
    sub.unsubscribe();
    expect(got.find((d) => d.event === 'appointment_updated')).toBeTruthy();
  });

  it('does not receive another branch\'s events (isolation)', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new CustomerRealtimeController(new RealtimeStreamFactory(bus), repo);
    const got: any[] = [];
    const sub = ctrl.stream({ ctx: { tenantId: 'T', userId: 'U' } }).subscribe((m: any) => got.push(m.data));
    await tick();
    bus.toTenant({ tenantId: 'T', branchId: 'SOME-OTHER-branch' }, EVENTS.queueUpdated, {});
    await tick(5);
    sub.unsubscribe();
    expect(got.find((d) => d.event === 'queue_updated')).toBeFalsy();
  });
});

// wave 4 UI sweep: the Customer App's live screens (Live Queue, Visit, appointment detail) opened /customer/stream and got
// 403 "Tenant POS access only" — the controller carried the POS guard, which admits salon staff and never a CUSTOMER, so
// no customer ever received a live update. The stream belongs to the customer realm.
describe('who may open /customer/stream', () => {
  const guards = (Reflect as any).getMetadata('__guards__', CustomerRealtimeController) as any[];
  const admits = (role: string) => { try { return guards.every((G) => new G().canActivate({ switchToHttp: () => ({ getRequest: () => ({ ctx: { role, tenantId: 'T', userId: 'U' } }) }) } as any)); } catch { return false; } };
  it('a signed-in customer — and no salon staff role', () => {
    expect(admits('CUSTOMER')).toBe(true);
    for (const r of ['OWNER', 'MANAGER', 'FRONT_DESK', 'TECHNICIAN']) expect(admits(r)).toBe(false);
  });
});
