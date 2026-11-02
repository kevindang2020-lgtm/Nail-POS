// device-identity.vitest.spec.ts — Secure Tap to Pay mandate §4 / §7 / §9 / §10 / §16 / §18 / §61–§62 / §68 / §70–§72
// (Oct 23 2026): every payment phone has its own key, proves it on every sensitive request, can be paired once, is bound to
// its branches, and is dead at the backend the moment it is revoked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, randomBytes, type KeyObject } from 'node:crypto';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';
import { InMemoryDevicePairingStore } from './device-pairing';
import { DeviceProofGuard } from './device-proof.guard';
import { bodyHash, canonicalDeviceRequest, checkProof, keyFingerprint, parseDevicePublicKey, verifyDeviceSignature, deviceKeyPolicy, DEVICE_PROOF_WINDOW_MS } from './device-proof';
import type { Ctx } from '@aipowersalon/permissions';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

// ── a phone: a P-256 key pair (what WebCrypto / the Secure Enclave would make) and a signer of requests ─────────────────
function phone() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { spki, privateKey };
}
function signReq(privateKey: KeyObject, deviceId: string, method: string, path: string, body: unknown, over: { ts?: number; nonce?: string } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(over.ts ?? Date.now()); const nonce = over.nonce ?? randomBytes(18).toString('base64url');
  const signed = canonicalDeviceRequest({ method, path, deviceId, ts, nonce, bodySha256: bodyHash(raw) });
  const sig = cryptoSign('sha256', Buffer.from(signed), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { raw, headers: { 'x-aps-device-id': deviceId, 'x-aps-device-ts': ts, 'x-aps-device-nonce': nonce, 'x-aps-device-sig': sig } as Record<string, string> };
}

const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const T = 'luxe001'; const B = 'br_cherryhill'; const B2 = 'br_haddonfield'; const TK = 'tk_2042';
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'mobile_checkout.split_payment', 'mobile_checkout.tap_to_pay', 'pos.devices.manage'];
const ctx = (over: Record<string, unknown> = {}): Ctx => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: perms, ...over } as Ctx);
const cctx = ctx() as unknown as CheckoutContext;

class FakeProvider implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  isConfigured() { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { return { provider: this.provider, sessionToken: 'sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: true, processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
  async lookupTransaction(): Promise<TapToPayLookup> { return { kind: 'not_found' }; }
}
async function world(provider: TapToPaySessionPort = new FakeProvider()) {
  for (const [k, v] of Object.entries(TTP_ENV)) process.env[k] = v;
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const devices = new InMemoryMobilePayDeviceStore();
  const pairing = new InMemoryDevicePairingStore();
  const onboarding = new InMemoryTtpOnboardingStore();
  const locks = new CheckoutLockService(new InMemoryCheckoutLockRepository());
  const merchants = new Map<string, any>();   // branch → what PaymentGatewayResolver.resolve answers (default: the salon's, active)
  const gateways: any = { resolve: vi.fn(async (_t: string, b?: string | null) => { const m = b ? merchants.get(b) : undefined; if (m instanceof Error) throw m; return m ?? { status: 'active', configured: true, merchantAccountId: null }; }) };
  const audit = { record: vi.fn() };
  let fresh = true;
  const stepUp = { isFresh: vi.fn(async () => fresh) };
  const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, new InMemoryMobilePaymentAttemptRepository(), onboarding, devices, provider, undefined,
    { recorder: new MobileCaptureRecorder(repo, null), realtime, audit, pairing, stepUp });
  await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), T, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  const guard = new DeviceProofGuard(devices);
  /** run the guard the way Nest would, then return the ctx the controller would build */
  const through = async (c: Ctx, method: string, path: string, body: unknown, headers: Record<string, string>, raw: string) => {
    const req: any = { method, originalUrl: path, headers, body, rawBody: Buffer.from(raw), ctx: c };
    await guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any);
    return { ...c, verifiedDeviceId: req.verifiedDeviceId ?? null } as Ctx;
  };
  const setFresh = (v: boolean) => { fresh = v; };
  return { repo, svc, devices, pairing, audit, through, setFresh, stepUp, merchants, gateways };
}
/** register a phone through the guard with its own key (proof of possession) and approve it */
async function registered(w: Awaited<ReturnType<typeof world>>, deviceId: string, user = ctx(), approve = true) {
  const p = phone();
  const body = { deviceId, platform: 'ios', tapToPayCapable: true, publicKey: p.spki };
  const s = signReq(p.privateKey, deviceId, 'POST', '/api/v1/mobile-checkout/device/register', body);
  const vctx = await w.through(user, 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw);
  const rec = await w.svc.registerDevice(vctx, body);
  if (approve) await w.svc.setMyDeviceStatus(ctx(), deviceId, 'active');
  return { ...p, rec };
}
afterEach(() => { delete process.env.MOBILE_PAY_DEVICE_KEYS; });

describe('device-proof primitives (§4, no custom cryptography)', () => {
  it('a P-256 signature over the canonical request verifies; another key, a changed body, path or a stale timestamp does not', () => {
    const a = phone(), b = phone();
    const s = signReq(a.privateKey, 'D1', 'POST', '/api/v1/mobile-checkout/x', { amountCents: 100 });
    const proof = { deviceId: 'D1', ts: s.headers['x-aps-device-ts'], nonce: s.headers['x-aps-device-nonce'], sig: s.headers['x-aps-device-sig'] };
    expect(checkProof({ method: 'POST', path: '/api/v1/mobile-checkout/x', headers: {}, rawBody: s.raw }, proof, a.spki)).toEqual({ ok: true });
    expect(checkProof({ method: 'POST', path: '/api/v1/mobile-checkout/x', headers: {}, rawBody: s.raw }, proof, b.spki).ok).toBe(false);
    expect(checkProof({ method: 'POST', path: '/api/v1/mobile-checkout/x', headers: {}, rawBody: JSON.stringify({ amountCents: 999 }) }, proof, a.spki).ok).toBe(false);
    expect(checkProof({ method: 'POST', path: '/api/v1/mobile-checkout/y', headers: {}, rawBody: s.raw }, proof, a.spki).ok).toBe(false);
    expect(checkProof({ method: 'POST', path: '/api/v1/mobile-checkout/x', headers: {}, rawBody: s.raw, now: Date.now() + DEVICE_PROOF_WINDOW_MS + 1000 }, proof, a.spki).ok).toBe(false);
  });
  it('only ECDSA P-256 keys are accepted; the fingerprint is stable', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => parseDevicePublicKey(rsa)).toThrow();
    const p = phone();
    expect(keyFingerprint(p.spki)).toBe(keyFingerprint(p.spki));
    expect(verifyDeviceSignature(p.spki, 'x', 'not-a-signature')).toBe(false);
  });
  it('policy: production requires a device key unless explicitly optional', () => {
    expect(deviceKeyPolicy({ NODE_ENV: 'production' } as any)).toBe('required');
    expect(deviceKeyPolicy({ NODE_ENV: 'development' } as any)).toBe('optional');
    expect(deviceKeyPolicy({ NODE_ENV: 'production', MOBILE_PAY_DEVICE_KEYS: 'optional' } as any)).toBe('optional');
  });
});

describe('Secure Tap to Pay — device identity, proof and revocation', () => {
  it('§4: a key is registered only with proof of possession; a different key for the same device id is refused (a new phone is a new device, §18)', async () => {
    const w = await world();
    const p = phone();
    await expect(w.svc.registerDevice(ctx(), { deviceId: 'iphone-A', platform: 'ios', publicKey: p.spki })).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });   // unsigned
    const { rec } = await registered(w, 'iphone-A');
    expect(rec.keyFingerprint).toBe(keyFingerprint(rec.publicKey!));
    const other = phone();
    const body = { deviceId: 'iphone-A', platform: 'ios', publicKey: other.spki };
    const s = signReq(other.privateKey, 'iphone-A', 'POST', '/api/v1/mobile-checkout/device/register', body);
    // the guard checks the REGISTERED key, so a request signed by another key is refused before the service is reached
    await expect(w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw)).rejects.toMatchObject({ status: 403 });
  });

  it('§62: three phones of one salon have their own ids, keys and audit trails; one key cannot be copied to another device id', async () => {
    const w = await world();
    const a = await registered(w, 'front-desk'), b = await registered(w, 'manager'), c = await registered(w, 'mobile-checkout');
    expect(new Set([a.rec.keyFingerprint, b.rec.keyFingerprint, c.rec.keyFingerprint]).size).toBe(3);
    const body = { deviceId: 'copy-of-manager', platform: 'ios', publicKey: b.spki };
    const s = signReq(b.privateKey, 'copy-of-manager', 'POST', '/api/v1/mobile-checkout/device/register', body);
    const v = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw);
    await expect(w.svc.registerDevice(v, body)).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    const registeredDevices = w.audit.record.mock.calls.filter(([, ev]: any) => ev.action === 'mobile_pay_device_registered').map(([, ev]: any) => ev.resourceId);
    expect(registeredDevices).toEqual(['front-desk', 'manager', 'mobile-checkout']);
  });

  it('§71: a keyed phone\'s money operations need ITS signature — a valid user token without it (or from another phone) is refused', async () => {
    const w = await world();
    const a = await registered(w, 'iphone-A');
    const b = await registered(w, 'iphone-B');
    // unsigned → mismatch
    await expect(w.svc.acquireLock(ctx(), TK, 'iphone-A', 's')).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    // signed by phone B but naming phone A → the guard verifies B's header against B; the service sees verified B ≠ A
    const body = { sessionId: 's', idempotencyKey: 'C2', amountCents: 100, deviceId: 'iphone-A' };
    const s = signReq(b.privateKey, 'iphone-B', 'POST', '/api/v1/mobile-checkout/tickets/tk/cash-tender', body);
    const v = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/tickets/tk/cash-tender', body, s.headers, s.raw);
    await expect(w.svc.acquireLock(v, TK, 'iphone-A', 's')).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    // phone A signing for itself: claim works
    const sa = signReq(a.privateKey, 'iphone-A', 'POST', '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's', deviceId: 'iphone-A' });
    const va = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's', deviceId: 'iphone-A' }, sa.headers, sa.raw);
    await expect(w.svc.acquireLock(va, TK, 'iphone-A', 's')).resolves.toMatchObject({ acquired: true });
    // holding the claim, an UNSIGNED cash tender naming phone A is still refused
    await expect(w.svc.recordCashTender(ctx(), TK, { sessionId: 's', idempotencyKey: 'C3', amountCents: 100, deviceId: 'iphone-A' })).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
  });

  it('§70: a signed request is accepted once — the same nonce again is DEVICE_REQUEST_REPLAYED; a forged signature is DEVICE_KEY_MISMATCH', async () => {
    const w = await world();
    const a = await registered(w, 'iphone-A');
    const s = signReq(a.privateKey, 'iphone-A', 'GET', '/api/v1/mobile-checkout/queue', undefined);
    await w.through(ctx(), 'GET', '/api/v1/mobile-checkout/queue', undefined, s.headers, '');
    await expect(w.through(ctx(), 'GET', '/api/v1/mobile-checkout/queue', undefined, s.headers, '')).rejects.toMatchObject({ status: 409 });
    const forged = { ...s.headers, 'x-aps-device-nonce': randomBytes(18).toString('base64url') };   // the signature no longer matches
    await expect(w.through(ctx(), 'GET', '/api/v1/mobile-checkout/queue', undefined, forged, '')).rejects.toMatchObject({ status: 403 });
  });

  it('§16 / §61 / §72: revoking a phone is real at the backend — every route refuses it at once (no realtime needed), its sessions are revoked, and it never comes back (§18)', async () => {
    const w = await world();
    const a = await registered(w, 'iphone-A');
    await w.svc.setMyDeviceStatus(ctx(), 'iphone-A', 'revoked', 'lost phone');
    expect(w.devices.sessionsRevoked).toContain(`${T}::iphone-A`);
    for (const [method, path] of [['GET', '/api/v1/mobile-checkout/queue'], ['POST', '/api/v1/mobile-checkout/tickets/tk/lock'], ['POST', '/api/v1/mobile-checkout/payments/p1/refund']] as const) {
      const s = signReq(a.privateKey, 'iphone-A', method, path, method === 'GET' ? undefined : {});
      await expect(w.through(ctx(), method, path, method === 'GET' ? undefined : {}, s.headers, s.raw)).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ code: 'DEVICE_REVOKED' }) });
    }
    await expect(w.svc.setMyDeviceStatus(ctx(), 'iphone-A', 'active')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('policy "required": a phone that never registered a key cannot take money (DEVICE_KEY_REQUIRED)', async () => {
    const w = await world();
    await w.svc.registerDevice(ctx(), { deviceId: 'legacy', platform: 'ios', tapToPayCapable: true });
    await w.svc.setMyDeviceStatus(ctx(), 'legacy', 'active');
    process.env.MOBILE_PAY_DEVICE_KEYS = 'required';
    await expect(w.svc.recordCashTender(ctx(), TK, { sessionId: 's', idempotencyKey: 'C1', amountCents: 100, deviceId: 'legacy' })).rejects.toMatchObject({ code: 'lock_not_held' });   // lock first …
    await w.svc.acquireLock(ctx(), TK, 'legacy', 's');
    await expect(w.svc.recordCashTender(ctx(), TK, { sessionId: 's', idempotencyKey: 'C1', amountCents: 100, deviceId: 'legacy' })).rejects.toMatchObject({ code: 'DEVICE_KEY_REQUIRED' });   // … then the key rule
  });
});

describe('Secure Tap to Pay §7 / §70 — single-use POS pairing', () => {
  it('a pairing code registers ONE new phone, active at once in the pairing\'s branch; reuse and expiry fail', async () => {
    const w = await world();
    const pr = await w.svc.createDevicePairing(ctx(), { label: 'Front desk iPhone' });
    expect(pr.qrPayload).toContain(pr.pairingCode);
    const p = phone();
    const body = { deviceId: 'front-desk', platform: 'ios', tapToPayCapable: true, publicKey: p.spki, pairingCode: pr.pairingCode };
    const s = signReq(p.privateKey, 'front-desk', 'POST', '/api/v1/mobile-checkout/device/register', body);
    const v = await w.through(ctx({ userId: 'u_mgr', role: 'MANAGER' }), 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw);
    const rec = await w.svc.registerDevice(v, body);
    expect(rec).toMatchObject({ status: 'active', branchId: B, pairedVia: 'pos_qr', boundUserId: 'u_mgr' });
    // replay on another new phone
    const q = phone();
    const body2 = { deviceId: 'another', platform: 'ios', publicKey: q.spki, pairingCode: pr.pairingCode };
    const s2 = signReq(q.privateKey, 'another', 'POST', '/api/v1/mobile-checkout/device/register', body2);
    const v2 = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body2, s2.headers, s2.raw);
    await expect(w.svc.registerDevice(v2, body2)).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    // expired
    const later = await w.svc.createDevicePairing(ctx());
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6 * 60_000);
    try {
      const r = phone();
      const body3 = { deviceId: 'late', platform: 'ios', publicKey: r.spki, pairingCode: later.pairingCode };
      const s3 = signReq(r.privateKey, 'late', 'POST', '/api/v1/mobile-checkout/device/register', body3);
      const v3 = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body3, s3.headers, s3.raw);
      await expect(w.svc.registerDevice(v3, body3)).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    } finally { vi.useRealTimers(); }
  });
  it('a code from another location (or another salon) is refused', async () => {
    const w = await world();
    const pr = await w.svc.createDevicePairing(ctx({ branchId: B2 }));
    const p = phone();
    const body = { deviceId: 'x', platform: 'ios', publicKey: p.spki, pairingCode: pr.pairingCode };
    const s = signReq(p.privateKey, 'x', 'POST', '/api/v1/mobile-checkout/device/register', body);
    const v = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw);
    await expect(w.svc.registerDevice(v, body)).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    // §59: the same (valid, unused) code presented by a signed-in employee of ANOTHER salon matches nothing in that salon
    const pr2 = await w.svc.createDevicePairing(ctx());
    const body2 = { deviceId: 'y', platform: 'ios', publicKey: p.spki, pairingCode: pr2.pairingCode };
    const s2 = signReq(p.privateKey, 'y', 'POST', '/api/v1/mobile-checkout/device/register', body2);
    const other = ctx({ tenantId: 'other-salon' });
    const v2 = await w.through(other, 'POST', '/api/v1/mobile-checkout/device/register', body2, s2.headers, s2.raw);
    await expect(w.svc.registerDevice(v2, body2)).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    // and the code still works once, in its own salon and location
    const s3 = signReq(p.privateKey, 'y', 'POST', '/api/v1/mobile-checkout/device/register', body2);
    const v4 = await w.through(ctx(), 'POST', '/api/v1/mobile-checkout/device/register', body2, s3.headers, s3.raw);
    await expect(w.svc.registerDevice(v4, body2)).resolves.toMatchObject({ status: 'active', pairedVia: 'pos_qr' });
  });
});

describe('Secure Tap to Pay §9 / §10 / §68 — branch binding and store switch', () => {
  it('a phone takes payments only in its authorized branches; the owner can widen them; a store switch needs the device\'s branch AND a fresh step-up', async () => {
    const w = await world();
    const a = await registered(w, 'iphone-A');
    const sign = (c: Ctx, path: string, body: any) => { const s = signReq(a.privateKey, 'iphone-A', 'POST', path, body); return w.through(c, 'POST', path, body, s.headers, s.raw); };
    const inB2 = await sign(ctx({ branchId: B2 }), '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's' });
    await expect(w.svc.recordCashTender(inB2, TK, { sessionId: 's', idempotencyKey: 'C1', amountCents: 100, deviceId: 'iphone-A' })).rejects.toMatchObject({ code: expect.stringMatching(/DEVICE_BRANCH_NOT_AUTHORIZED|lock_not_held/) });
    expect(await w.svc.branchSwitchBlock({ tenantId: T, branchId: B, userId: 'u_owner', deviceId: 'iphone-A', targetBranchId: B2, sessionId: 'sess' })).toMatchObject({ code: 'DEVICE_BRANCH_NOT_AUTHORIZED', status: 403 });
    const rec = await w.svc.setDeviceBranches(ctx(), 'iphone-A', [B, B2]);
    expect(rec.allowedBranchIds).toEqual([B, B2]);
    w.setFresh(false);
    expect(await w.svc.branchSwitchBlock({ tenantId: T, branchId: B, userId: 'u_owner', deviceId: 'iphone-A', targetBranchId: B2, sessionId: 'sess' })).toMatchObject({ code: 'STEP_UP_REQUIRED', status: 403 });
    w.setFresh(true);
    expect(await w.svc.branchSwitchBlock({ tenantId: T, branchId: B, userId: 'u_owner', deviceId: 'iphone-A', targetBranchId: B2, sessionId: 'sess' })).toBeNull();
    expect(w.audit.record.mock.calls.some(([, ev]: any) => ev.action === 'mobile_pay_device_branches_changed')).toBe(true);
  });
  it('§10 CHECK MERCHANT CONFIGURATION (Oct 26): after the step-up, a target location with no active merchant is refused MERCHANT_NOT_CONFIGURED before the switch; a read failure fails closed (throws); the order is device → step-up → merchant', async () => {
    const w = await world();
    await registered(w, 'iphone-A');
    await w.svc.setDeviceBranches(ctx(), 'iphone-A', [B, B2]);
    const q = { tenantId: T, branchId: B, userId: 'u_owner', deviceId: 'iphone-A', targetBranchId: B2, sessionId: 'sess' };
    w.merchants.set(B2, { status: 'disabled', configured: false, merchantAccountId: 'm-b2' });
    w.setFresh(false);
    expect(await w.svc.branchSwitchBlock(q)).toMatchObject({ code: 'STEP_UP_REQUIRED' });   // step-up is asked first
    w.setFresh(true);
    expect(await w.svc.branchSwitchBlock(q)).toMatchObject({ code: 'MERCHANT_NOT_CONFIGURED', kind: 'merchant', status: 409 });
    expect(w.gateways.resolve).toHaveBeenLastCalledWith(T, B2);
    w.merchants.set(B2, new Error('db down'));
    await expect(w.svc.branchSwitchBlock(q)).rejects.toThrow('db down');
    w.merchants.set(B2, { status: 'active', configured: true, merchantAccountId: 'm-b2' });
    expect(await w.svc.branchSwitchBlock(q)).toBeNull();
    // a phone that is not authorized for the target never reaches the merchant check
    w.gateways.resolve.mockClear();
    expect(await w.svc.branchSwitchBlock({ ...q, targetBranchId: 'br_elsewhere' })).toMatchObject({ code: 'DEVICE_BRANCH_NOT_AUTHORIZED' });
    expect(w.gateways.resolve).not.toHaveBeenCalled();
  });
  it('device management is owner-only', async () => {
    const w = await world();
    await registered(w, 'iphone-A');
    const receptionist = ctx({ userId: 'u_rec', role: 'RECEPTIONIST', permissions: ['pos.checkout.view'] });
    await expect(w.svc.setDeviceBranches(receptionist, 'iphone-A', [B2])).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
    await expect(w.svc.createDevicePairing(receptionist)).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
    await expect(w.svc.setMyDeviceStatus(receptionist, 'iphone-A', 'revoked')).rejects.toMatchObject({ code: 'PAYMENT_PERMISSION_DENIED' });
  });
});

// M6-5 — the live three-phone pilot (apps/api/scripts/lib/pilot-secure-tap-to-pay.mjs) found these over real HTTP
describe('M6-5 live-pilot findings', () => {
  const signer = (w: Awaited<ReturnType<typeof world>>, id: string, pk: KeyObject) => (c: Ctx, path: string, body: any) => {
    const s = signReq(pk, id, 'POST', path, body); return w.through(c, 'POST', path, body, s.headers, s.raw);
  };
  async function paired(w: Awaited<ReturnType<typeof world>>, id: string, shared: boolean, user: Ctx) {
    const p = phone();
    const pr = await w.svc.createDevicePairing(ctx(), { shared });
    const body = { deviceId: id, platform: 'ios', tapToPayCapable: true, publicKey: p.spki, pairingCode: pr.pairingCode };
    const s = signReq(p.privateKey, id, 'POST', '/api/v1/mobile-checkout/device/register', body);
    const rec = await w.svc.registerDevice(await w.through(user, 'POST', '/api/v1/mobile-checkout/device/register', body, s.headers, s.raw), body);
    return { ...p, rec };
  }
  const max = ctx({ userId: 'u_max', role: 'MANAGER' }), bea = ctx({ userId: 'u_bea', role: 'MANAGER' });

  it('a SHARED phone lets the next employee of the shift claim a ticket; a PERSONAL phone still refuses anyone but its user', async () => {
    const w = await world();
    const front = await paired(w, 'front-desk', true, max);
    expect(front.rec).toMatchObject({ shared: true, status: 'active', boundUserId: 'u_max' });
    const asBea = await signer(w, 'front-desk', front.privateKey)(bea, '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's', deviceId: 'front-desk' });
    await expect(w.svc.acquireLock(asBea, TK, 'front-desk', 's')).resolves.toMatchObject({ acquired: true });   // was DEVICE_NOT_AUTHORIZED
    const mine = await paired(w, 'bea-phone', false, bea);
    const asMax = await signer(w, 'bea-phone', mine.privateKey)(max, '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's2', deviceId: 'bea-phone' });
    await expect(w.svc.acquireLock(asMax, TK, 'bea-phone', 's2')).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
  });

  it('a capture result or a cancel for a keyed phone\'s intent must be signed by that phone (a session alone cannot report "declined" or cancel it)', async () => {
    const w = await world();
    const a = await registered(w, 'iphone-A');
    const sign = signer(w, 'iphone-A', a.privateKey);
    await w.svc.acquireLock(await sign(ctx(), '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's' }), TK, 'iphone-A', 's');
    const att = await w.svc.createAttempt(await sign(ctx(), '/api/v1/mobile-checkout/tickets/tk/payment-attempts', { k: 1 }), TK, { sessionId: 's', idempotencyKey: 'K1', deviceId: 'iphone-A' });
    await w.svc.runReadinessStep(ctx(), att.idempotencyKey, 'iphone-A');
    await expect(w.svc.applyCaptureResult(ctx(), 'K1', { outcome: 'declined' }, 'iphone-A')).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    await expect(w.svc.cancelAttempt(ctx(), 'K1')).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    const b = await registered(w, 'iphone-B');   // another keyed phone of the salon, signing for itself
    await expect(w.svc.applyCaptureResult(await signer(w, 'iphone-B', b.privateKey)(ctx(), '/api/v1/mobile-checkout/payment-attempts/K1/capture-result', { o: 1 }), 'K1', { outcome: 'declined' }, 'iphone-A')).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    expect((await w.svc.getAttempt(ctx(), 'K1')).status).toBe('ready');
    await expect(w.svc.applyCaptureResult(await sign(ctx(), '/api/v1/mobile-checkout/payment-attempts/K1/capture-result', { o: 2 }), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, 'iphone-A')).resolves.toMatchObject({ to: 'confirmed' });
  });

  it('a provider answer that is neither approved nor declined is UNKNOWN (verified later), never a decline; a new intent is then PAYMENT_STATUS_UNKNOWN, not "already paid"', async () => {
    class PendingProvider extends FakeProvider { async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: false, outcome: 'unknown', processorRef: 'PEND-' + i.idempotencyKey }; } }
    const w = await world(new PendingProvider());
    const a = await registered(w, 'iphone-A');
    const sign = signer(w, 'iphone-A', a.privateKey);
    await w.svc.acquireLock(await sign(ctx(), '/api/v1/mobile-checkout/tickets/tk/lock', { sessionId: 's' }), TK, 'iphone-A', 's');
    await w.svc.createAttempt(await sign(ctx(), '/api/v1/mobile-checkout/tickets/tk/payment-attempts', { k: 1 }), TK, { sessionId: 's', idempotencyKey: 'K1', deviceId: 'iphone-A' });
    await w.svc.runReadinessStep(ctx(), 'K1', 'iphone-A');
    const r = await w.svc.applyCaptureResult(await sign(ctx(), '/api/v1/mobile-checkout/payment-attempts/K1/capture-result', { o: 1 }), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, 'iphone-A');
    expect(r).toMatchObject({ to: 'unknown', outcome: 'unknown' });
    expect((await w.svc.getAttempt(ctx(), 'K1')).status).toBe('unknown');
    await expect(w.svc.createAttempt(await sign(ctx(), '/api/v1/mobile-checkout/tickets/tk/payment-attempts', { k: 2 }), TK, { sessionId: 's', idempotencyKey: 'K2', deviceId: 'iphone-A' })).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNKNOWN' });
  });
});
void cctx;
