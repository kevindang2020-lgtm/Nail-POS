// payment-device-room.vitest.spec — Secure Tap to Pay M6-6 (§16 / §38 / §77): a payment phone has its OWN realtime room.
// The POS stream joins it only when the AUTHENTICATED SESSION was opened on that registered phone (server lookup, never a
// client value); another phone, another salon or a plain POS terminal never sees its events.
import { describe, it, expect } from 'vitest';
import { firstValueFrom, take, toArray, timeout, catchError, of } from 'rxjs';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { RealtimeStreamFactory } from './realtime-stream';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';

const ctx = { tenantId: 'tenant-A', branchId: 'branch-1', userId: 'u-1', role: 'MANAGER', permissions: [] };
const lookup = (map: Record<string, string>) => ({ deviceRoomFor: async (t: string | null | undefined, sid: string | null | undefined) => (t === 'tenant-A' && sid ? map[sid] ?? null : null) });
const frames = (ctrl: RealtimeController, r: any, n: number) => firstValueFrom(ctrl.stream(r).pipe(take(n), toArray(), timeout(300), catchError(() => of([] as any[]))));

describe('M6-6 per-device realtime room', () => {
  it('the room key is tenant-scoped', () => expect(rooms.paymentDevice('tenant-A', 'ph-1')).toBe('tenant:tenant-A:payment_device:ph-1'));

  it('a session opened on phone ph-1 receives ph-1\'s events (and the branch\'s); not ph-2\'s', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new RealtimeController(new RealtimeStreamFactory(bus)).withPaymentDevices(lookup({ 'sess-1': 'ph-1' }));
    setTimeout(() => {
      bus.toPaymentDevice('tenant-A', 'ph-2', EVENTS.checkoutSentToMobile, { ticketId: 't-other', deviceId: 'ph-2' });
      bus.toPaymentDevice('tenant-A', 'ph-1', EVENTS.checkoutSentToMobile, { ticketId: 't-1', deviceId: 'ph-1', userId: 'u-1' });
      bus.toTenant(ctx, EVENTS.queueUpdated);
    }, 20);
    const out: any[] = await frames(ctrl, { ctx, sessionId: 'sess-1', headers: {} }, 3);
    const events = out.map((f) => f.data?.event);
    expect(events).toContain('checkout_sent_to_mobile');
    expect(events).toContain('queue_updated');
    expect(JSON.stringify(out)).not.toContain('t-other');
    expect(bus.subscriberCount(rooms.paymentDevice('tenant-A', 'ph-1'))).toBe(0);   // unsubscribed when the stream ended
  });

  it('a POS terminal session (no payment phone) never joins a device room; a client-sent device id changes nothing', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new RealtimeController(new RealtimeStreamFactory(bus)).withPaymentDevices(lookup({ 'sess-1': 'ph-1' }));
    setTimeout(() => { bus.toPaymentDevice('tenant-A', 'ph-1', EVENTS.mobilePayDeviceUpdated, { deviceId: 'ph-1', status: 'revoked' }); bus.toTenant(ctx, EVENTS.queueUpdated); }, 20);
    const out: any[] = await frames(ctrl, { ctx, sessionId: 'pos-sess', headers: { 'x-aps-device-id': 'ph-1' }, query: { deviceId: 'ph-1' } }, 2);
    expect(out.map((f) => f.data?.event)).toEqual(['connected', 'queue_updated']);   // the branch event, and NOT the phone's
    expect(JSON.stringify(out)).not.toContain('mobile_pay_device_updated');
  });

  it('a failed device lookup leaves the stream on the branch room only (fewer rooms, never more)', async () => {
    const bus = new InProcessEmitter();
    const ctrl = new RealtimeController(new RealtimeStreamFactory(bus)).withPaymentDevices({ deviceRoomFor: async () => { throw new Error('db down'); } });
    setTimeout(() => { bus.toTenant(ctx, EVENTS.queueUpdated); }, 20);
    const out: any[] = await frames(ctrl, { ctx, sessionId: 'sess-1', headers: {} }, 2);
    expect(out.map((f) => f.data?.event)).toEqual(['connected', 'queue_updated']);
  });
});
