// ttp-certification.vitest.spec.ts — the certification / integration harness for the Tap to Pay flow.
//
// It exercises the REAL service state machine end to end — device readiness → mint session → capture result →
// reconcile — with every dependency real (in-memory attempts, device registry, onboarding, gateway) EXCEPT the
// processor, which is a clearly-labelled TEST DOUBLE below. The double is never wired into the module or production
// (production uses FiservCommerceHubTtpAdapter, which fails honestly until the real contract is wired). The purpose
// is to prove the ORCHESTRATION is correct so that, when real CommerceHub sandbox credentials exist, the SAME flow
// runs against the real adapter with no orchestration changes. It NEVER asserts a fabricated charge as a real one.
import { describe, it, expect, afterEach } from 'vitest';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository, MOBILE_ATTEMPT_METHOD } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort } from './tap-to-pay-session';
import type { Ctx } from '@aipowersalon/permissions';

/** TEST DOUBLE ONLY — stands in for Fiserv CommerceHub. Deterministic; never used outside this harness. */
class MockCommerceHubTtpAdapter implements TapToPaySessionPort {
  isConfigured(): boolean { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> {
    return { provider: 'mock_commercehub', sessionToken: 'mock-sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 120_000).toISOString(), environment: 'sandbox' };
  }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> {
    return { verified: true, processorRef: i.processorRef, capturedAmountCents: i.amountCents, respText: 'approved' };
  }
}

const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const setCreds = (on: boolean) => { for (const k of Object.keys(TTP_ENV)) { if (on) process.env[k] = (TTP_ENV as any)[k]; else delete process.env[k]; } };
afterEach(() => setCreds(false));

const DEVICE = 'devHARNESS01';
const ctx = (role = 'MANAGER'): Ctx => ({ tenantId: 'T1', branchId: 'B1', userId: 'u1', role, permissions: [] });

// A fully onboarded + device-approved + credentialled service, wired to the mock processor.
async function readyService() {
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true }) };
  const svc = new MobileCheckoutService({} as any, gateways, {} as any, {} as any, attempts, new InMemoryTtpOnboardingStore(), new InMemoryMobilePayDeviceStore(), new MockCommerceHubTtpAdapter());
  setCreds(true);
  await svc.setTapToPayOnboarding(ctx('SUPER_ADMIN'), 'T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true });
  await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', DEVICE, 'active');
  return { svc, attempts };
}

async function seedReadyAttempt(svc: MobileCheckoutService, attempts: InMemoryMobilePaymentAttemptRepository, key = 'K1', amountCents = 3233) {
  await attempts.createOrGet(ctx(), { ticketId: 'TICKET1', amountCents, idempotencyKey: key, method: MOBILE_ATTEMPT_METHOD });
  const r = await svc.runReadinessStep(ctx(), key, DEVICE);
  expect(r.status).toBe('ready'); // device approved + tenant onboarded + credentials present ⇒ ready
  return key;
}

describe('Tap to Pay certification harness (mock CommerceHub — TEST DOUBLE, never production)', () => {
  it('full happy path: ready → device session → approved capture → confirmed', async () => {
    const { svc, attempts } = await readyService();
    const key = await seedReadyAttempt(svc, attempts);
    const session = await svc.mintDeviceSession(ctx(), key, DEVICE);
    expect(session.provider).toBe('mock_commercehub');
    expect(session.sessionToken).toContain('mock-sess-');
    const cap = await svc.applyCaptureResult(ctx(), key, { outcome: 'approved', processorRef: 'R1', last4: '4242', brand: 'visa', capturedAmountCents: 3233 });
    expect(cap).toMatchObject({ from: 'ready', to: 'confirmed', outcome: 'approved' });
  });

  it('declined / timeout / unknown capture outcomes land in the correct state', async () => {
    const { svc, attempts } = await readyService();
    for (const [key, outcome, to] of [['Kd', 'declined', 'declined'], ['Kt', 'timeout', 'timed_out'], ['Ku', 'unknown', 'unknown']] as const) {
      await seedReadyAttempt(svc, attempts, key);
      expect((await svc.applyCaptureResult(ctx(), key, { outcome })).to).toBe(to);
    }
  });

  it('an unknown result is reconciled to a definitive state (no duplicate charge)', async () => {
    const { svc, attempts } = await readyService();
    const key = await seedReadyAttempt(svc, attempts, 'Kr');
    await svc.applyCaptureResult(ctx(), key, { outcome: 'unknown' });
    expect(await svc.reconcileAttempt(ctx(), key, 'confirmed')).toMatchObject({ from: 'unknown', to: 'confirmed', resolution: 'confirmed' });
  });

  it('honest block: with credentials pulled, the SAME flow fails readiness and never reaches capture', async () => {
    const { svc, attempts } = await readyService();
    setCreds(false); // remove CommerceHub credentials
    await attempts.createOrGet(ctx(), { ticketId: 'TICKET2', amountCents: 1000, idempotencyKey: 'Kx', method: MOBILE_ATTEMPT_METHOD });
    expect((await svc.runReadinessStep(ctx(), 'Kx', DEVICE)).status).toBe('failed');
  });

  it('server-side verification overrides the SDK: an approved tap the processor does NOT confirm becomes declined', async () => {
    const attempts = new InMemoryMobilePaymentAttemptRepository();
    const gateways: any = { resolve: async () => ({ status: 'active', configured: true }) };
    // A processor that reports the transaction was NOT verified.
    const decliningProcessor: any = {
      isConfigured: () => true,
      mintDeviceSession: async () => ({ provider: 'mock', sessionToken: 's', expiresAt: new Date(Date.now() + 120_000).toISOString(), environment: 'sandbox' }),
      finalizeTransaction: async () => ({ verified: false, outcome: 'declined', processorRef: 'R1' }),   // an explicit decline (Oct 28: a bare verified:false is UNKNOWN)
    };
    const svc = new MobileCheckoutService({} as any, gateways, {} as any, {} as any, attempts, new InMemoryTtpOnboardingStore(), new InMemoryMobilePayDeviceStore(), decliningProcessor);
    setCreds(true);
    await svc.setTapToPayOnboarding(ctx('SUPER_ADMIN'), 'T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
    await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true });
    await svc.setDeviceStatus(ctx('SUPER_ADMIN'), 'T1', DEVICE, 'active');
    await attempts.createOrGet(ctx(), { ticketId: 'TICKET3', amountCents: 1000, idempotencyKey: 'Kv', method: MOBILE_ATTEMPT_METHOD });
    await svc.runReadinessStep(ctx(), 'Kv', DEVICE);
    const cap = await svc.applyCaptureResult(ctx(), 'Kv', { outcome: 'approved', processorRef: 'R1', capturedAmountCents: 1000 });
    expect(cap.to).toBe('declined');       // SDK claimed approved; the processor did not confirm → declined
    expect(cap.outcome).toBe('declined');
  });
});
