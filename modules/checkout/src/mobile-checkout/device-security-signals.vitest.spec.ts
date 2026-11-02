// device-security-signals.vitest.spec.ts — Secure Tap to Pay §51 (Oct 26 2026): payment-device counters (registrations,
// approvals, revocations, claim conflicts, app versions) and security events for a revoked phone still calling, a failed
// device signature, a replayed request and an unsupported app version — through the guard and the service, deduplicated.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, randomBytes, type KeyObject } from 'node:crypto';
import { integrationBusinessCounts, resetIntegrationBusinessCountsForTests } from '@aipowersalon/observability';
import { DeviceSecuritySignals, DEVICE_SIGNAL_DEDUPE_MS } from './device-security-signals';
import { DeviceProofGuard } from './device-proof.guard';
import { bodyHash, canonicalDeviceRequest, keyFingerprint } from './device-proof';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';

const T = 'T1';
const key = () => { const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); return { spki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey }; };
function signed(privateKey: KeyObject, deviceId: string, path: string, body: unknown, nonce = randomBytes(18).toString('base64url')) {
  const raw = JSON.stringify(body); const ts = String(Date.now());
  const sig = cryptoSign('sha256', Buffer.from(canonicalDeviceRequest({ method: 'POST', path, deviceId, ts, nonce, bodySha256: bodyHash(raw) })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { raw, headers: { 'x-aps-device-id': deviceId, 'x-aps-device-ts': ts, 'x-aps-device-nonce': nonce, 'x-aps-device-sig': sig } as Record<string, string> };
}
const run = (guard: DeviceProofGuard, path: string, body: unknown, headers: Record<string, string>, raw: string) => {
  const req: any = { method: 'POST', originalUrl: path, headers, body, rawBody: Buffer.from(raw), ctx: { tenantId: T, userId: 'u1' }, ip: '203.0.113.9' };
  return guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any).then(() => 'ok', (e: any) => e?.response?.code ?? String(e));
};

beforeEach(() => resetIntegrationBusinessCountsForTests());

describe('DeviceSecuritySignals', () => {
  it('counts every attempt but writes ONE security event per (kind, salon, phone) per 10 minutes; another phone / kind is its own event', async () => {
    let t = 1_000_000; const events = { record: vi.fn(async () => true) };
    const s = new DeviceSecuritySignals(events, () => t);
    expect(s.signal('revoked_device_attempt', { tenantId: T, deviceId: 'd1', userId: 'u1' })).toBe(true);
    for (let i = 0; i < 50; i++) s.signal('revoked_device_attempt', { tenantId: T, deviceId: 'd1' });
    s.signal('revoked_device_attempt', { tenantId: T, deviceId: 'd2' });
    s.signal('key_mismatch', { tenantId: T, deviceId: 'd1' });
    expect(events.record).toHaveBeenCalledTimes(3);
    t += DEVICE_SIGNAL_DEDUPE_MS;
    s.signal('revoked_device_attempt', { tenantId: T, deviceId: 'd1' });
    expect(events.record).toHaveBeenCalledTimes(4);
    expect(integrationBusinessCounts().paymentDevices).toEqual({ revoked_device_attempt: 53, key_mismatch: 1 });
    expect(events.record).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'FRAUD_PATTERN_DETECTED', severity: 'HIGH', tenantId: T, resourceType: 'payment_device', resourceId: 'd1', actorId: 'u1' }));
  });
  it('an unsupported app version is a LOW event; a failing recorder never throws into the request', async () => {
    const events = { record: vi.fn(async () => { throw new Error('db down'); }) };
    const s = new DeviceSecuritySignals(events);
    expect(() => s.signal('app_version_refused', { tenantId: T, deviceId: 'd1' })).not.toThrow();
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ severity: 'LOW', reason: expect.stringMatching(/^app_version_refused/) }));
  });
});

describe('DeviceProofGuard raises the signals (§51 + §61 / §70 / §71)', () => {
  it('revoked phone → revoked_device_attempt; unsigned / mis-signed → key_mismatch; replay → request_replayed', async () => {
    const devices = new InMemoryMobilePayDeviceStore(); const events = { record: vi.fn(async () => true) };
    const guard = new DeviceProofGuard(devices, new DeviceSecuritySignals(events));
    const a = key(), other = key();
    await devices.upsertOnRegister(T, { deviceId: 'ph-a', registeredBy: 'u1', publicKey: a.spki, keyFingerprint: keyFingerprint(a.spki) });
    await devices.upsertOnRegister(T, { deviceId: 'ph-r', registeredBy: 'u1' });
    await devices.setStatus(T, 'ph-r', 'revoked', 'u-owner', 'lost');
    const P = '/mobile-checkout/tickets/tk/lock'; const body = { sessionId: 's' };
    expect(await run(guard, P, body, { 'x-aps-device-id': 'ph-r' }, JSON.stringify(body))).toBe('DEVICE_REVOKED');
    expect(await run(guard, P, body, { 'x-aps-device-id': 'ph-a' }, JSON.stringify(body))).toBe('DEVICE_KEY_MISMATCH');
    const bad = signed(other.privateKey, 'ph-a', P, body);
    expect(await run(guard, P, body, bad.headers, bad.raw)).toBe('DEVICE_KEY_MISMATCH');
    const good = signed(a.privateKey, 'ph-a', P, body);
    expect(await run(guard, P, body, good.headers, good.raw)).toBe('ok');
    expect(await run(guard, P, body, good.headers, good.raw)).toBe('DEVICE_REQUEST_REPLAYED');
    expect(integrationBusinessCounts().paymentDevices).toEqual({ revoked_device_attempt: 1, key_mismatch: 2, request_replayed: 1 });
    const kinds = events.record.mock.calls.map(([e]: any) => String(e.reason).split(':')[0]);
    expect(kinds).toEqual(['revoked_device_attempt', 'key_mismatch', 'request_replayed']);   // the second key_mismatch for ph-a is deduplicated
    expect(events.record.mock.calls[0][0]).toMatchObject({ ip: '203.0.113.9', resourceId: 'ph-r' });
  });
});

describe('the service counts the lifecycle and the claim conflicts (§51)', () => {
  it('registered (once per new phone), approved / suspended / revoked, renamed, app versions, claim_conflict, revoked phone claiming', async () => {
    const devices = new InMemoryMobilePayDeviceStore(); const events = { record: vi.fn(async () => true) };
    const locks = new CheckoutLockService(new InMemoryCheckoutLockRepository());
    const checkout: any = { detail: async () => ({ ticketId: 'tk', status: 'ready_checkout', lines: [], totals: {} }) };
    const svc = new MobileCheckoutService({} as any, {} as any, checkout, locks, new InMemoryMobilePaymentAttemptRepository(), undefined, devices, undefined, undefined, { signals: new DeviceSecuritySignals(events) });
    const owner: any = { tenantId: T, branchId: 'B1', userId: 'u-owner', role: 'OWNER', permissions: ['pos.devices.manage', 'mobile_checkout.login'] };
    const mgr: any = { ...owner, userId: 'u1', role: 'MANAGER', permissions: ['mobile_checkout.login'] };
    await svc.registerDevice(mgr, { deviceId: 'ph-1', platform: 'ios', appVersion: '1.2.3' } as any);
    await svc.registerDevice(mgr, { deviceId: 'ph-1', platform: 'ios', appVersion: '1.2.4' } as any);   // a re-register is not a new registration
    await svc.heartbeat(mgr, 'ph-1', '1.3.0');
    await svc.setMyDeviceStatus(owner, 'ph-1', 'active');
    await svc.renameDevice(owner, 'ph-1', 'Front Desk');
    await svc.setMyDeviceStatus(owner, 'ph-1', 'disabled', 'lunch');
    await svc.setMyDeviceStatus(owner, 'ph-1', 'active');
    // two people claim the same ticket: the second is a claim conflict
    await svc.registerDevice({ ...mgr, userId: 'u2' }, { deviceId: 'ph-2', platform: 'ios' } as any);
    await svc.setMyDeviceStatus(owner, 'ph-2', 'active');
    await svc.acquireLock(mgr, 'tk', 'ph-1', 's1');
    await expect(svc.acquireLock({ ...mgr, userId: 'u2' }, 'tk', 'ph-2', 's2')).rejects.toMatchObject({ name: 'LockHeldElsewhereError' });
    await svc.setMyDeviceStatus(owner, 'ph-2', 'revoked', 'lost');
    await expect(svc.acquireLock({ ...mgr, userId: 'u2' }, 'tk2', 'ph-2', 's3')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(integrationBusinessCounts().paymentDevices).toEqual({ registered: 2, approved: 3, renamed: 1, suspended: 1, claim_conflict: 1, revoked: 1, revoked_device_attempt: 1 });
    expect(integrationBusinessCounts().paymentAppVersions).toEqual({ '1.2': 2, '1.3': 1 });
    expect(events.record).toHaveBeenCalledTimes(1);   // a claim conflict / a lifecycle move is never a security event; the revoked phone is
  });
});

// Oct 27 2026 — §51 "unusual registration" rule + the claim-conflict audit row the panels count.
import { unusualRegistration, unusualRegistrationLimits, UNUSUAL_REGISTRATION_DEFAULTS } from './device-security-signals';

describe('§51 unusual registration rule', () => {
  it('fires above the per-employee or per-salon limit (new phone included), names which; quiet at the limit', () => {
    expect(unusualRegistration({ tenantLast24h: 4, userLast24h: 2 })).toBeNull();                              // at the limits
    expect(unusualRegistration({ tenantLast24h: 3, userLast24h: 3 })).toMatch(/one employee registered 3 new payment phones in 24 h \(limit 2\)/);
    expect(unusualRegistration({ tenantLast24h: 5, userLast24h: 1 })).toMatch(/5 new payment phones were registered for this salon in 24 h \(limit 4\)/);
    expect(UNUSUAL_REGISTRATION_DEFAULTS).toEqual({ tenantPerDay: 4, userPerDay: 2 });
  });
  it('limits come from TTP_UNUSUAL_REG_TENANT_PER_DAY / _USER_PER_DAY; nonsense falls back to the defaults', () => {
    expect(unusualRegistrationLimits({ TTP_UNUSUAL_REG_TENANT_PER_DAY: '10', TTP_UNUSUAL_REG_USER_PER_DAY: '1' })).toEqual({ tenantPerDay: 10, userPerDay: 1 });
    expect(unusualRegistrationLimits({ TTP_UNUSUAL_REG_TENANT_PER_DAY: 'x', TTP_UNUSUAL_REG_USER_PER_DAY: '0' })).toEqual({ tenantPerDay: 4, userPerDay: 2 });
  });
  it('the service raises ONE MEDIUM security event per salon (deduplicated), counts it, and never blocks the registration', async () => {
    const devices = new InMemoryMobilePayDeviceStore() as any; const events = { record: vi.fn(async () => true) };
    let created = 0;
    const realUpsert = devices.upsertOnRegister.bind(devices);
    devices.upsertOnRegister = async (t: string, i: any) => { const before = await devices.get(t, i.deviceId); const r = await realUpsert(t, i); if (!before) created++; return r; };
    devices.registrationCounts = async () => ({ tenantLast24h: created, userLast24h: created });
    const svc = new MobileCheckoutService({} as any, {} as any, {} as any, new CheckoutLockService(new InMemoryCheckoutLockRepository()), new InMemoryMobilePaymentAttemptRepository(), undefined, devices, undefined, undefined, { signals: new DeviceSecuritySignals(events) });
    const mgr: any = { tenantId: T, branchId: 'B1', userId: 'u1', role: 'MANAGER', permissions: ['mobile_checkout.login'] };
    for (const d of ['p1', 'p2']) await svc.registerDevice(mgr, { deviceId: d, platform: 'ios' } as any);
    expect(events.record).not.toHaveBeenCalled();                                                   // 2 by one employee = at the limit
    for (const d of ['p3', 'p4', 'p5']) expect((await svc.registerDevice(mgr, { deviceId: d, platform: 'ios' } as any)).status).toBe('pending');   // never blocked
    expect(events.record).toHaveBeenCalledTimes(1);                                                 // p3, p4, p5 → one alert per salon per 10 min
    expect(events.record.mock.calls[0][0]).toMatchObject({ type: 'FRAUD_PATTERN_DETECTED', severity: 'MEDIUM', tenantId: T, resourceType: 'payment_device', resourceId: null });
    expect(String((events.record.mock.calls[0][0] as any).reason)).toMatch(/^unusual_registration: .*one employee registered 3 new payment phones/);
    expect(integrationBusinessCounts().paymentDevices).toMatchObject({ registered: 5, unusual_registration: 3 });
  });
  it('a claim conflict is also AUDITED (checkout_payment_claim_conflict) so the owner / platform panels count it durably', async () => {
    const devices = new InMemoryMobilePayDeviceStore(); const audit = { record: vi.fn() };
    const checkout: any = { detail: async () => ({ ticketId: 'tk', status: 'ready_checkout', lines: [], totals: {} }) };
    const svc = new MobileCheckoutService({} as any, {} as any, checkout, new CheckoutLockService(new InMemoryCheckoutLockRepository()), new InMemoryMobilePaymentAttemptRepository(), undefined, devices, undefined, undefined, { audit } as any);
    const mgr: any = { tenantId: T, branchId: 'B1', userId: 'u1', role: 'MANAGER', permissions: ['mobile_checkout.login'] };
    await svc.acquireLock(mgr, 'tk', undefined as any, 's1');
    await expect(svc.acquireLock({ ...mgr, userId: 'u2' }, 'tk', undefined as any, 's2')).rejects.toMatchObject({ name: 'LockHeldElsewhereError' });
    expect(audit.record.mock.calls.map(([, e]: any) => e.action)).toContain('checkout_payment_claim_conflict');
  });
});
