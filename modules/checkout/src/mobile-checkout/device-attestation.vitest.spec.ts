// device-attestation.vitest.spec.ts — Secure Tap to Pay §5 (Oct 26 2026): the server half of attestation. The phone's
// evidence must be signed by its own registered key; the verifier's verdict is stored; without a verifier nothing is stored
// (never a pass); a failed verdict raises a security event and — only under TTP_ATTESTATION_POLICY=enforce — marks the
// phone compromised and ends its sessions.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, randomBytes, type KeyObject } from 'node:crypto';
import { resetIntegrationBusinessCountsForTests, integrationBusinessCounts } from '@aipowersalon/observability';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { DeviceProofGuard } from './device-proof.guard';
import { bodyHash, canonicalDeviceRequest, keyFingerprint } from './device-proof';
import { DeviceSecuritySignals } from './device-security-signals';
import { attestationPolicy, type AttestationVerifierPort } from './device-attestation';

const T = 'T1'; const PATH = '/api/v1/mobile-checkout/device/attest';
const mgr: any = { tenantId: T, branchId: 'B1', userId: 'u1', role: 'MANAGER', permissions: ['mobile_checkout.login'] };
const key = () => { const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); return { spki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey }; };
const body = (deviceId: string) => ({ deviceId, format: 'apple-appattest', evidence: 'o2NmbXRvYXBwbGUtYXBwYXR0ZXN0', keyId: 'kid-1' });

async function world(verifier?: AttestationVerifierPort) {
  resetIntegrationBusinessCountsForTests();
  const devices = new InMemoryMobilePayDeviceStore(); const events = { record: vi.fn(async () => true) }; const audit = { record: vi.fn() };
  const signals = new DeviceSecuritySignals(events);
  const svc = new MobileCheckoutService({} as any, {} as any, {} as any, {} as any, new InMemoryMobilePaymentAttemptRepository(), undefined, devices, undefined, undefined, { signals, audit, attestation: verifier });
  const guard = new DeviceProofGuard(devices, signals);
  const p = key();
  await devices.upsertOnRegister(T, { deviceId: 'ph-1', registeredBy: 'u1', publicKey: p.spki, keyFingerprint: keyFingerprint(p.spki) });
  await devices.setStatus(T, 'ph-1', 'active', 'u-owner');
  /** the request as the guard sees it; returns the ctx the controller would build (verifiedDeviceId only when verified) */
  const through = async (b: any, signWith: KeyObject | null = p.privateKey) => {
    const raw = JSON.stringify(b); const headers: Record<string, string> = {};
    if (signWith) {
      const ts = String(Date.now()); const nonce = randomBytes(18).toString('base64url');
      const sig = cryptoSign('sha256', Buffer.from(canonicalDeviceRequest({ method: 'POST', path: PATH, deviceId: b.deviceId, ts, nonce, bodySha256: bodyHash(raw) })), { key: signWith, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      Object.assign(headers, { 'x-aps-device-id': b.deviceId, 'x-aps-device-ts': ts, 'x-aps-device-nonce': nonce, 'x-aps-device-sig': sig });
    }
    const req: any = { method: 'POST', originalUrl: PATH, headers, body: b, rawBody: Buffer.from(raw), ctx: mgr };
    await guard.canActivate({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as any);
    return { ...mgr, verifiedDeviceId: req.verifiedDeviceId ?? null };
  };
  return { svc, devices, events, audit, through };
}
const fixed = (verdict: 'passed' | 'failed' | 'unverifiable'): AttestationVerifierPort => ({ provider: 'test-verifier', verify: vi.fn(async () => ({ verdict, reason: verdict === 'failed' ? 'counter mismatch' : null })) });

afterEach(() => { delete process.env.TTP_ATTESTATION_POLICY; });

describe('§5 attestation intake', () => {
  it('no verifier configured (the default) → unverifiable, NOTHING stored (never a pass), audited', async () => {
    const w = await world();
    const r = await w.svc.attestDevice(await w.through(body('ph-1')), 'ph-1', body('ph-1'));
    expect(r).toMatchObject({ verdict: 'unverifiable', attestationStatus: 'none', reason: 'ATTESTATION_VERIFIER_NOT_CONFIGURED', policy: 'off' });
    expect((await w.devices.get(T, 'ph-1'))?.attestationStatus).toBe('none');
    expect(w.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'mobile_pay_device_attested', metadata: expect.objectContaining({ verdict: 'unverifiable', provider: 'none' }) }));
    expect(integrationBusinessCounts().paymentDevices).toMatchObject({ attestation_unverifiable: 1 });
  });
  it('a verifier\'s pass is stored', async () => {
    const v = fixed('passed'); const w = await world(v);
    const r = await w.svc.attestDevice(await w.through(body('ph-1')), 'ph-1', body('ph-1'));
    expect(r).toMatchObject({ verdict: 'passed', attestationStatus: 'passed', deviceStatus: 'active' });
    expect(v.verify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, deviceId: 'ph-1', format: 'apple-appattest', keyId: 'kid-1', keyFingerprint: expect.any(String) }));
  });
  it('policy off (default): a FAIL is stored + a HIGH security event; the phone keeps working', async () => {
    const w = await world(fixed('failed'));
    const r = await w.svc.attestDevice(await w.through(body('ph-1')), 'ph-1', body('ph-1'));
    expect(r).toMatchObject({ verdict: 'failed', attestationStatus: 'failed', deviceStatus: 'active', policy: 'off' });
    expect((await w.devices.get(T, 'ph-1'))?.status).toBe('active');
    expect(w.events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'FRAUD_PATTERN_DETECTED', severity: 'HIGH', resourceId: 'ph-1', reason: expect.stringMatching(/^attestation_failed/) }));
    expect(integrationBusinessCounts().paymentDevices).toMatchObject({ attestation_failed: 1 });
  });
  it('policy enforce: a FAIL marks the phone COMPROMISED and ends its sessions; the next signed request is DEVICE_REVOKED', async () => {
    process.env.TTP_ATTESTATION_POLICY = 'enforce';
    const w = await world(fixed('failed'));
    const r = await w.svc.attestDevice(await w.through(body('ph-1')), 'ph-1', body('ph-1'));
    expect(r).toMatchObject({ verdict: 'failed', deviceStatus: 'compromised', policy: 'enforce' });
    expect((await w.devices.get(T, 'ph-1'))?.status).toBe('compromised');
    expect(w.devices.sessionsRevoked).toContain(`${T}::ph-1`);
    await expect(w.through(body('ph-1'))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEVICE_REVOKED' }) });
  });
  it('only the phone that holds the key attests for itself: unsigned / another key / another device → refused, nothing stored', async () => {
    const v = fixed('passed'); const w = await world(v);
    await expect(w.svc.attestDevice(await w.through(body('ph-1'), null), 'ph-1', body('ph-1'))).rejects.toMatchObject({ code: 'DEVICE_KEY_MISMATCH' });
    await expect(w.through(body('ph-1'), key().privateKey)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEVICE_KEY_MISMATCH' }) });
    await expect(w.svc.attestDevice(await w.through(body('ph-1')), 'ph-other', body('ph-other'))).rejects.toMatchObject({ code: 'DEVICE_NOT_REGISTERED' });
    expect(v.verify).not.toHaveBeenCalled();
    expect((await w.devices.get(T, 'ph-1'))?.attestationStatus).toBe('none');
  });
  it('bad input is refused before the verifier; a verifier that throws is "unverifiable", never a pass', async () => {
    const w = await world({ provider: 'flaky', verify: async () => { throw new Error('apple root cert missing'); } });
    const c = await w.through(body('ph-1'));
    await expect(w.svc.attestDevice(c, 'ph-1', { format: 'made-up', evidence: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(w.svc.attestDevice(c, 'ph-1', { format: 'apple-appattest', evidence: '' })).rejects.toMatchObject({ code: 'invalid' });
    const r = await w.svc.attestDevice(c, 'ph-1', body('ph-1'));
    expect(r).toMatchObject({ verdict: 'unverifiable', attestationStatus: 'none' });
    expect(r.reason).toMatch(/^VERIFIER_ERROR/);
  });
  it('the policy reads TTP_ATTESTATION_POLICY; anything but "enforce" is off', () => {
    expect(attestationPolicy({})).toBe('off');
    expect(attestationPolicy({ TTP_ATTESTATION_POLICY: 'ENFORCE' })).toBe('enforce');
    expect(attestationPolicy({ TTP_ATTESTATION_POLICY: 'yes' })).toBe('off');
  });
});
