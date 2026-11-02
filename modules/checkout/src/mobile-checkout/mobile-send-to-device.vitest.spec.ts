// mobile-send-to-device.vitest.spec — Secure Tap to Pay M6-6 (§14 / §77 / §150): "Send checkout to device" on a SHARED salon
// phone reaches the employee signed in on it NOW (not whoever registered it); a personal phone reaches its bound user; the
// nudge goes to the phone's OWN realtime room as well as the branch.
import { describe, it, expect, vi } from 'vitest';
import { InMemoryCheckoutRepository } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';
import type { Ctx } from '@aipowersalon/permissions';

const T = 'luxe001'; const B = 'br_cherryhill'; const TK = 'tk_2042';
const desk = (over: Partial<Ctx> = {}): Ctx => ({ tenantId: T, branchId: B, userId: 'u_desk', role: 'FRONT_DESK', permissions: ['pos.checkout.view', 'pos.checkout.take_payment'], ...over });

function world() {
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn(), toPaymentDevice: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const devices = new InMemoryMobilePayDeviceStore();
  const push = { dispatchToUser: vi.fn(async () => undefined) };
  const audit = { record: vi.fn() };
  const svc = new MobileCheckoutService({} as any, {} as any, checkout, new CheckoutLockService(new InMemoryCheckoutLockRepository()), new InMemoryMobilePaymentAttemptRepository(), new InMemoryTtpOnboardingStore(), devices, undefined, undefined, { realtime, push, audit });
  return { svc, devices, push, realtime, audit };
}

describe('M6-6 send checkout to a phone', () => {
  it('SHARED front-desk phone registered by the owner, Sophia signed in now → the push goes to Sophia, not the owner', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'front-desk', registeredBy: 'u_owner', tapToPayCapable: true, pairing: { branchId: B, approvedBy: 'u_owner', shared: true } });
    w.devices.signedIn.set(`${T}::front-desk`, 'u_sophia');
    const r = await w.svc.sendToDevice(desk(), TK, 'front-desk');
    expect(r).toEqual({ sent: true });
    expect(w.push.dispatchToUser).toHaveBeenCalledTimes(1);
    expect(w.push.dispatchToUser.mock.calls[0][1]).toBe('u_sophia');
    // the phone's own room got the nudge, naming who it is for
    expect(w.realtime.toPaymentDevice).toHaveBeenCalledWith(T, 'front-desk', 'checkout_sent_to_mobile', expect.objectContaining({ ticketId: TK, userId: 'u_sophia', shared: true }));
    expect(JSON.stringify(w.audit.record.mock.calls)).toContain('u_sophia');
    // Manager B signs in on the same phone: the next send reaches Manager B
    w.devices.signedIn.set(`${T}::front-desk`, 'u_manager_b');
    await w.svc.sendToDevice(desk(), TK, 'front-desk');
    expect(w.push.dispatchToUser.mock.calls[1][1]).toBe('u_manager_b');
  });

  it('SHARED phone with nobody signed in: no push to the registering owner; the phone\'s room still gets the nudge', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'front-desk', registeredBy: 'u_owner', tapToPayCapable: true, pairing: { branchId: B, approvedBy: 'u_owner', shared: true } });
    expect(await w.svc.sendToDevice(desk(), TK, 'front-desk')).toEqual({ sent: false, reason: 'no_signed_in_employee' });
    expect(w.push.dispatchToUser).not.toHaveBeenCalled();
    expect(w.realtime.toPaymentDevice).toHaveBeenCalledTimes(1);
  });

  it('a PERSONAL phone reaches its bound user', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'kevin-iphone', registeredBy: 'u_kevin', tapToPayCapable: true, pairing: { branchId: B, approvedBy: 'u_owner' } });
    w.devices.signedIn.set(`${T}::kevin-iphone`, 'u_kevin');
    await w.svc.sendToDevice(desk(), TK, 'kevin-iphone');
    expect(w.push.dispatchToUser.mock.calls[0][1]).toBe('u_kevin');
  });

  it('refusals: no payment permission → PAYMENT_PERMISSION_DENIED; another location\'s phone → DEVICE_NOT_AUTHORIZED', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'uptown', registeredBy: 'u_owner', tapToPayCapable: true, pairing: { branchId: 'br_uptown', approvedBy: 'u_owner', shared: true } });
    await expect(w.svc.sendToDevice(desk({ permissions: ['pos.checkout.view'] }), TK, 'uptown')).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
    await expect(w.svc.sendToDevice(desk(), TK, 'uptown')).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
  });

  it('revoking a phone nudges the phone\'s own room (best effort — the backend refusal does not depend on it)', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'lost', registeredBy: 'u_owner', tapToPayCapable: true, pairing: { branchId: B, approvedBy: 'u_owner' } });
    await w.svc.setMyDeviceStatus({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: ['pos.devices.manage'] }, 'lost', 'revoked', 'stolen');
    expect(w.realtime.toPaymentDevice).toHaveBeenCalledWith(T, 'lost', 'mobile_pay_device_updated', { deviceId: 'lost', status: 'revoked' });
  });
});

describe('M6-6 §15 / §62 owner device dashboard — deviceActivity', () => {
  const owner = (): Ctx => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: ['pos.devices.manage'] });
  it('owner-only; another salon\'s phone is not_found; sessions carry a short ref + state, never a token', async () => {
    const w = world();
    await w.devices.upsertOnRegister(T, { deviceId: 'front-desk', registeredBy: 'u_owner', tapToPayCapable: true, pairing: { branchId: B, approvedBy: 'u_owner', shared: true } });
    w.devices.activityRows.set(`${T}::front-desk`, {
      sessions: [
        { id: 'aaaaaaaa-1111-4000-8000-000000000001', userId: 'u_b', branchId: B, createdAt: '2026-10-23T15:00:00.000Z', lastActiveAt: null, expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, status: 'active' },
        { id: 'bbbbbbbb-2222-4000-8000-000000000002', userId: 'u_a', branchId: B, createdAt: '2026-10-23T09:00:00.000Z', lastActiveAt: null, expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: '2026-10-23T14:59:00.000Z', status: 'revoked' },
        { id: 'cccccccc-3333-4000-8000-000000000003', userId: 'u_a', branchId: B, createdAt: '2026-10-20T09:00:00.000Z', lastActiveAt: null, expiresAt: '2026-10-20T21:00:00.000Z', revokedAt: null, status: 'active' },
      ],
      audit: [{ at: '2026-10-23T15:05:00.000Z', action: 'checkout_payment_claimed', actorUserId: 'u_b', actorName: 'B', summary: null, reason: null, resourceType: 'mobile_checkout', resourceId: 'tk_2042', status: 'success', ticketId: null }],
    });
    const r = await w.svc.deviceActivity(owner(), 'front-desk');
    expect(r).toMatchObject({ deviceId: 'front-desk', status: 'active', shared: true });
    expect(r.sessions.map((s) => [s.ref, s.state])).toEqual([['aaaaaaaa', 'active'], ['bbbbbbbb', 'revoked'], ['cccccccc', 'expired']]);
    expect(JSON.stringify(r)).not.toContain('aaaaaaaa-1111');
    expect(r.audit[0]).toMatchObject({ action: 'checkout_payment_claimed', ticketId: 'tk_2042' });
    await expect(w.svc.deviceActivity({ ...owner(), permissions: ['pos.checkout.view'] }, 'front-desk')).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
    await expect(w.svc.deviceActivity({ ...owner(), tenantId: 'other-salon' }, 'front-desk')).rejects.toMatchObject({ code: 'not_found' });
  });
});
