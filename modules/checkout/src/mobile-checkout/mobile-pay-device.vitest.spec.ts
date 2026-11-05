import { describe, it, expect } from 'vitest';
import { computeDeviceFacts, compareVersions, InMemoryMobilePayDeviceStore, type MobilePayDeviceRecord } from './mobile-pay-device';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import { permissionsFor, type Ctx } from '@aipowersalon/permissions';

const dev = (over: Partial<MobilePayDeviceRecord> = {}): MobilePayDeviceRecord => ({ deviceId: 'D1', platform: 'ios', tapToPayCapable: true, status: 'active', branchId: null, ...over });

describe('computeDeviceFacts', () => {
  it('an unregistered device is not approved (but makes no unsupported/outdated claim)', () => {
    expect(computeDeviceFacts(null)).toEqual({ deviceApproved: false, deviceSupported: true, appVersionOk: true, blockReason: 'DEVICE_NOT_AUTHORIZED' });
  });
  it('approved only when status active and (when branch-bound) branch matches', () => {
    expect(computeDeviceFacts(dev({ status: 'active' })).deviceApproved).toBe(true);
    expect(computeDeviceFacts(dev({ status: 'pending' })).deviceApproved).toBe(false);
    expect(computeDeviceFacts(dev({ status: 'revoked' })).deviceApproved).toBe(false);
    expect(computeDeviceFacts(dev({ status: 'active', branchId: 'B1' }), { requiredBranchId: 'B2' }).deviceApproved).toBe(false);
    expect(computeDeviceFacts(dev({ status: 'active', branchId: 'B1' }), { requiredBranchId: 'B1' }).deviceApproved).toBe(true);
  });
  it('supported reflects the reported Tap to Pay capability', () => {
    expect(computeDeviceFacts(dev({ tapToPayCapable: false })).deviceSupported).toBe(false);
    expect(computeDeviceFacts(dev({ tapToPayCapable: true })).deviceSupported).toBe(true);
  });
  it('appVersionOk compares the reported version against the minimum', () => {
    expect(computeDeviceFacts(dev({ appVersion: '1.4.0' }), { minAppVersion: '1.5.0' }).appVersionOk).toBe(false);
    expect(computeDeviceFacts(dev({ appVersion: '1.5.0' }), { minAppVersion: '1.5.0' }).appVersionOk).toBe(true);
    expect(computeDeviceFacts(dev({ appVersion: '2.0.0' }), { minAppVersion: '1.5.0' }).appVersionOk).toBe(true);
    expect(computeDeviceFacts(dev({ appVersion: undefined }), { minAppVersion: '1.5.0' }).appVersionOk).toBe(false);
    expect(computeDeviceFacts(dev(), {}).appVersionOk).toBe(true); // no minimum configured
  });
  it('compareVersions orders dotted numeric versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.5.1', '1.5.0')).toBe(1);
  });
});

describe('InMemoryMobilePayDeviceStore', () => {
  it('registration lands pending and re-registering never self-approves', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    const r1 = await s.upsertOnRegister('T1', { deviceId: 'D1', platform: 'ios', tapToPayCapable: true });
    expect(r1.status).toBe('pending');
    await s.setStatus('T1', 'D1', 'active');
    const r2 = await s.upsertOnRegister('T1', { deviceId: 'D1', platform: 'ios', appVersion: '1.6.0' }); // re-register
    expect(r2.status).toBe('active');       // stayed approved — re-register cannot downgrade or self-approve
    expect(r2.appVersion).toBe('1.6.0');    // metadata refreshed
  });
  it('is isolated per tenant and lists newest first', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    await s.upsertOnRegister('T1', { deviceId: 'D1' });
    await s.upsertOnRegister('T2', { deviceId: 'D9' });
    expect((await s.list('T1')).map((d) => d.deviceId)).toEqual(['D1']);
    expect(await s.get('T2', 'D1')).toBeNull();
  });
});

// ── Service readiness: the 'device' check state comes from the registry.
const gateways: any = { resolve: async () => ({ status: 'active', configured: true }) };
const buildSvc = (devices: InMemoryMobilePayDeviceStore, onboarding: InMemoryTtpOnboardingStore = new InMemoryTtpOnboardingStore()) => new MobileCheckoutService({} as any, gateways, {} as any, {} as any, {} as any, onboarding, devices);
// BUILD_PLAN Phase 9: a context carries its role's real session permissions (device approval is a permission now)
const ctx = (role = 'MANAGER', permissions: string[] = role === 'SUPER_ADMIN' ? [] : permissionsFor(role as any)): Ctx => ({ tenantId: 'T1', branchId: 'B1', userId: 'u1', role: role as any, permissions });
const deviceState = (r: { checks: { key: string; state: string }[] }) => r.checks.find((c) => c.key === 'device')!.state;
const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const setCreds = (on: boolean) => { for (const k of Object.keys(TTP_ENV)) { if (on) process.env[k] = (TTP_ENV as any)[k]; else delete process.env[k]; } };

describe('MobileCheckoutService — device approval in readiness', () => {
  it('unregistered / pending / revoked device is not ok; approved capable device is ok', async () => {
    const store = new InMemoryMobilePayDeviceStore();
    const svc = buildSvc(store);
    expect(deviceState(await svc.getReadiness(ctx(), 'D1'))).toBe('setup_required'); // unregistered

    await svc.registerDevice(ctx(), { deviceId: 'D1', platform: 'ios', tapToPayCapable: true });
    expect(deviceState(await svc.getReadiness(ctx(), 'D1'))).toBe('setup_required'); // pending

    await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', 'D1', 'active');
    expect(deviceState(await svc.getReadiness(ctx(), 'D1'))).toBe('ok');             // approved + capable

    await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', 'D1', 'revoked');
    expect(deviceState(await svc.getReadiness(ctx(), 'D1'))).toBe('setup_required'); // revoked blocks again
  });

  it("an empty branch / user id ('' — a session without a branch) registers as none, not as the literal '' (developer merge, Oct 6 2026)", async () => {
    const store = new InMemoryMobilePayDeviceStore();
    const svc = buildSvc(store);
    const seen: any[] = []; const orig = store.upsertOnRegister.bind(store);
    store.upsertOnRegister = async (t: string, input: any) => { seen.push(input); return orig(t, input); };
    const rec = await svc.registerDevice({ ...ctx(), branchId: '' as any, userId: '' as any }, { deviceId: 'D9', platform: 'ios', tapToPayCapable: true, branchId: '' });
    expect(rec.branchId).toBeNull();
    expect(seen[0].registeredBy).toBeNull();
    // and a real session branch still fills an empty input branch
    const rec2 = await svc.registerDevice(ctx(), { deviceId: 'D10', platform: 'ios', tapToPayCapable: true, branchId: '' });
    expect(rec2.branchId).toBe('B1');
  });

  it('an approved device that is not Tap-to-Pay capable is unavailable', async () => {
    const store = new InMemoryMobilePayDeviceStore();
    const svc = buildSvc(store);
    await svc.registerDevice(ctx(), { deviceId: 'D2', platform: 'ios', tapToPayCapable: false });
    await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', 'D2', 'active');
    expect(deviceState(await svc.getReadiness(ctx(), 'D2'))).toBe('unavailable');
  });

  it('registering lands pending, and only a SUPER_ADMIN can approve/revoke', async () => {
    const svc = buildSvc(new InMemoryMobilePayDeviceStore());
    const reg = await svc.registerDevice(ctx(), { deviceId: 'D3', platform: 'ios', tapToPayCapable: true });
    expect(reg.status).toBe('pending');
    await expect(svc.setDeviceStatus(ctx('MANAGER'), 'T1', 'D3', 'active')).rejects.toBeInstanceOf(AttemptError);
    await expect(svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', 'NOPE', 'active')).rejects.toBeInstanceOf(AttemptError); // unknown device
  });

  it('overall becomes ready (canTakePayment) ONLY when device approved AND tenant onboarded AND credentials present', async () => {
    const devices = new InMemoryMobilePayDeviceStore();
    const onboarding = new InMemoryTtpOnboardingStore();
    const svc = buildSvc(devices, onboarding);
    try {
      // Nothing set up yet → not ready.
      setCreds(true);
      expect((await svc.getReadiness(ctx(), 'D1')).canTakePayment).toBe(false);

      // Approve the device only → still blocked (tenant not onboarded).
      await svc.registerDevice(ctx(), { deviceId: 'D1', platform: 'ios', tapToPayCapable: true });
      await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', 'D1', 'active');
      expect((await svc.getReadiness(ctx(), 'D1')).canTakePayment).toBe(false);

      // Onboard the tenant too → now every critical leg is real → payment can be taken.
      await svc.setTapToPayOnboarding(ctx('SUPER_ADMIN'), 'T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
      const ready = await svc.getReadiness(ctx(), 'D1');
      expect(ready.canTakePayment).toBe(true);       // every CRITICAL leg is ok
      expect(ready.overall).toMatch(/^ready/);        // 'ready' (or 'ready_with_warning' if optional receipts are off)

      // Pull the credentials → back to blocked (never lit on recorded state alone).
      setCreds(false);
      expect((await svc.getReadiness(ctx(), 'D1')).canTakePayment).toBe(false);
    } finally { setCreds(false); }
  });
});

describe('Owner self-service device approval', () => {
  it('an owner approves/revokes devices in their own salon; non-owners are refused', async () => {
    const store = new InMemoryMobilePayDeviceStore();
    const svc = buildSvc(store);
    await svc.registerDevice(ctx(), { deviceId: 'D1', platform: 'ios', tapToPayCapable: true });
    await expect(svc.setMyDeviceStatus(ctx('MANAGER'), 'D1', 'active')).rejects.toBeInstanceOf(AttemptError); // manager can't
    expect((await svc.setMyDeviceStatus(ctx('OWNER'), 'D1', 'active')).status).toBe('active');
    expect((await svc.listMyDevices(ctx('OWNER'))).map((d) => d.deviceId)).toEqual(['D1']);
    expect((await svc.setMyDeviceStatus(ctx('OWNER'), 'D1', 'revoked')).status).toBe('revoked');
  });
  it('Phase 9: decided by pos.devices.manage (settings.edit), not by the OWNER name — an owner-role session with it DENIED is refused', async () => {
    const store = new InMemoryMobilePayDeviceStore();
    const svc = buildSvc(store);
    await svc.registerDevice(ctx(), { deviceId: 'D1', platform: 'ios', tapToPayCapable: true });
    await expect(svc.setMyDeviceStatus(ctx('OWNER', permissionsFor('OWNER' as any).filter((k) => k !== 'settings.edit')), 'D1', 'active')).rejects.toBeInstanceOf(AttemptError);
  });
  it('an owner cannot touch a device in another salon', async () => {
    const store = new InMemoryMobilePayDeviceStore();
    await store.upsertOnRegister('T2', { deviceId: 'DX' }); // another tenant's device
    const svc = buildSvc(store);
    await expect(svc.setMyDeviceStatus(ctx('OWNER'), 'DX', 'active')).rejects.toBeInstanceOf(AttemptError); // scoped to T1
  });
});

// BUILD_PLAN Phase 13 B: the Tap-to-Pay minimum moved onto the ONE version policy (mobile_app_versions, app 'manager-pay').
// MOBILE_PAY_MIN_APP_VERSION is a deprecated fallback used only while no policy row exists.
import { effectiveMinAppVersion, readMobilePayMinVersion } from './mobile-pay-device';
describe('effectiveMinAppVersion (Phase 13 B)', () => {
  it('the configured policy wins; the env var applies only when no policy row exists; neither → no minimum', () => {
    expect(effectiveMinAppVersion({ found: true, minSupported: '1.2.0' }, { MOBILE_PAY_MIN_APP_VERSION: '9.9.9' })).toBe('1.2.0');
    expect(effectiveMinAppVersion({ found: true, minSupported: null }, { MOBILE_PAY_MIN_APP_VERSION: '9.9.9' })).toBeNull();   // a row that sets no minimum means none
    expect(effectiveMinAppVersion({ found: false, minSupported: null }, { MOBILE_PAY_MIN_APP_VERSION: '1.1.0' })).toBe('1.1.0');
    expect(effectiveMinAppVersion({ found: false, minSupported: null }, {})).toBeNull();
  });
  it('a policy read that fails means no minimum (never refuse every device because a read failed)', async () => {
    expect(await readMobilePayMinVersion({ selectFrom: () => { throw new Error('down'); } } as any, 'ios')).toEqual({ found: false, minSupported: null });
    expect(await readMobilePayMinVersion(null, 'ios')).toEqual({ found: false, minSupported: null });
  });
});

// ── Owner & Manager Payment App mandate §13–§14 / §138–§140 (wave 3 / TTP): trust states + USER binding ────────────────
describe('device trust states and user binding (mandate §13–§14)', () => {
  it('a device bound to another user is NOT approved for this user (a copied token on another phone / another person)', () => {
    const f = computeDeviceFacts(dev({ status: 'active', boundUserId: 'U1' }), { requiredUserId: 'U2' });
    expect(f.deviceApproved).toBe(false);
    expect(f.blockReason).toBe('DEVICE_NOT_AUTHORIZED');
    expect(computeDeviceFacts(dev({ status: 'active', boundUserId: 'U1' }), { requiredUserId: 'U1' }).deviceApproved).toBe(true);
  });
  it('revoked / compromised / disabled devices are refused with the taxonomy reason (§190)', () => {
    expect(computeDeviceFacts(dev({ status: 'revoked' })).blockReason).toBe('DEVICE_REVOKED');
    expect(computeDeviceFacts(dev({ status: 'compromised' })).blockReason).toBe('DEVICE_REVOKED');
    expect(computeDeviceFacts(dev({ status: 'disabled' })).blockReason).toBe('DEVICE_NOT_AUTHORIZED');
    expect(computeDeviceFacts(dev({ status: 'pending' })).blockReason).toBe('DEVICE_NOT_AUTHORIZED');
    expect(computeDeviceFacts(null).blockReason).toBe('DEVICE_NOT_AUTHORIZED');
    expect(computeDeviceFacts(dev({ status: 'active' })).blockReason).toBeUndefined();
  });
  it('store: registration binds the device to the registering user; a second user re-registering it is refused', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    const r1 = await s.upsertOnRegister('T1', { deviceId: 'D1', registeredBy: 'U1' });
    expect(r1.boundUserId).toBe('U1');
    await expect(s.upsertOnRegister('T1', { deviceId: 'D1', registeredBy: 'U2' })).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
    expect((await s.get('T1', 'D1'))!.boundUserId).toBe('U1');   // the binding did not move
  });
  it('store: revoke records who/why/when and revokeForUser (termination) revokes every device bound to that user', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    await s.upsertOnRegister('T1', { deviceId: 'D1', registeredBy: 'U1' });
    await s.upsertOnRegister('T1', { deviceId: 'D2', registeredBy: 'U1' });
    await s.upsertOnRegister('T1', { deviceId: 'D3', registeredBy: 'U9' });
    await s.setStatus('T1', 'D1', 'active'); await s.setStatus('T1', 'D2', 'active'); await s.setStatus('T1', 'D3', 'active');
    const r = await s.setStatus('T1', 'D1', 'revoked', 'OWNER-1', 'lost phone');
    expect(r).toMatchObject({ status: 'revoked', revokeReason: 'lost phone' });
    expect(r!.revokedAt).toBeTruthy();
    const n = await s.revokeForUser('T1', 'U1', 'employment_ended');
    expect(n).toBe(1);   // D1 was already revoked; D2 is revoked now
    expect((await s.get('T1', 'D2'))!.status).toBe('revoked');
    expect((await s.get('T1', 'D3'))!.status).toBe('active');   // another user's phone is untouched
  });
  it('store: a compromised device cannot be re-activated in place (lifecycle) — it must be revoked and re-registered', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    await s.upsertOnRegister('T1', { deviceId: 'D1', registeredBy: 'U1' });
    await s.setStatus('T1', 'D1', 'compromised');
    const r = await s.setStatus('T1', 'D1', 'active');
    expect(r!.status).toBe('compromised');
  });
  it('store: touchPayment stamps lastPaymentAt (device health §145)', async () => {
    const s = new InMemoryMobilePayDeviceStore();
    await s.upsertOnRegister('T1', { deviceId: 'D1', registeredBy: 'U1' });
    await s.touchPayment('T1', 'D1');
    expect((await s.get('T1', 'D1'))!.lastPaymentAt).toBeTruthy();
  });
});
