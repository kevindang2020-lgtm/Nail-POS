import { describe, it, expect, vi } from 'vitest';
import { MobileCheckoutController } from './mobile-checkout.controller';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService, TAP_TO_PAY_SURFACE } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { integrationBusinessCounts, resetIntegrationBusinessCountsForTests } from '@aipowersalon/observability';
import type { Ctx } from '@aipowersalon/permissions';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const creds = (on: boolean) => { for (const k of Object.keys(TTP_ENV)) { if (on) process.env[k] = (TTP_ENV as any)[k]; else delete process.env[k]; } };

const T = 'luxe001'; const B = 'br_cherryhill'; const TK = 'tk_2042'; const DEVICE = 'iphone-kevin-01';
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'mobile_checkout.split_payment', 'pos.devices.manage'];
const ctx = (over: Partial<Ctx> = {}): Ctx & { sessionId?: string } => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: perms, ...over });
const cctx = ctx() as unknown as CheckoutContext;

/** A test double of the Tap to Pay provider (sandbox-only: TEST DOUBLE, never production). */
class FakeProvider implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  verified = true; lookup: TapToPayLookup = { kind: 'not_found' };
  isConfigured() { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { return { provider: this.provider, sessionToken: 'sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: this.verified, outcome: this.verified ? 'approved' : 'declined', processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
  async lookupTransaction(): Promise<TapToPayLookup> { return this.lookup; }
}

async function world(opts: { recorder?: boolean } = {}) {
  creds(true);
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const post = vi.spyOn(checkout, 'runPostPaymentWork');
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const devices = new InMemoryMobilePayDeviceStore();
  const onboarding = new InMemoryTtpOnboardingStore();
  const provider = new FakeProvider();
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }) };
  const locks: any = { getStatus: async () => ({ locked: true, ownedByCaller: true, heldBy: null }), acquire: async () => ({ acquired: true, action: 'acquired', expiresAt: '' }), release: async () => ({ released: true }), active: async () => null };
  const audit = { record: vi.fn() };
  const recorder = opts.recorder === false ? undefined : new MobileCaptureRecorder(repo, null);
  const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, attempts, onboarding, devices, provider, undefined, { recorder, realtime, audit });   // {} = "a store is reachable" (the in-memory repo holds the money)
  await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), T, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true });
  await svc.setMyDeviceStatus(ctx(), DEVICE, 'active');
  const due = (await repo.totalsFor(cctx, TK, 'card'))!.totalDueCents;
  return { repo, checkout, svc, attempts, provider, realtime, post, audit, due };
}

const paid = (repo: InMemoryCheckoutRepository) => repo.paidTotalCents(cctx, TK);
// secure-tap-payment-integrity.vitest.spec.ts — Secure Tap to Pay mandate §29 / §30 / §37 / §19 (Oct 23 2026): the phone's
// word is never money, one logical payment has one idempotency identity, and every money operation from a phone needs a
// trusted device.
describe('Secure Tap to Pay — payment integrity', () => {
  it('§30: Proceed twice gives the SAME key (one logical payment); only after a definitive decline does a retry get a new key', async () => {
    const { svc, provider } = await world();
    const p1 = await svc.evaluateProceed(ctx(), TK, { sessionId: 's1', deviceId: DEVICE });
    const p2 = await svc.evaluateProceed(ctx(), TK, { sessionId: 's1', deviceId: DEVICE });
    expect(p1.canProceed).toBe(true);
    expect(p1.idempotencyKey).toBeTruthy();
    expect(p2.idempotencyKey).toBe(p1.idempotencyKey);
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: p1.idempotencyKey!, deviceId: DEVICE });
    expect((await svc.evaluateProceed(ctx(), TK, { sessionId: 's1', deviceId: DEVICE })).idempotencyKey).toBe(p1.idempotencyKey);   // still open → same
    await svc.runReadinessStep(ctx(), p1.idempotencyKey!, DEVICE);
    provider.verified = false;
    await svc.applyCaptureResult(ctx(), p1.idempotencyKey!, { outcome: 'approved', processorRef: 'R1' }, DEVICE);   // the provider does not confirm → declined
    const p3 = await svc.evaluateProceed(ctx(), TK, { sessionId: 's1', deviceId: DEVICE });
    expect(p3.idempotencyKey).toBe(p1.idempotencyKey + '-1');
  });

  it('§30 / §58: the same key for a different amount is refused (IDEMPOTENCY_KEY_REUSED), never another ticket\'s intent', async () => {
    const { svc, due } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE, amountCents: due - 100 });
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE, amountCents: due })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE, amountCents: due - 100 })).amountCents).toBe(due - 100);   // the true replay
  });

  it('§19 / §61: a cash tender from a phone needs a trusted device — none, or a revoked one, is refused and nothing is recorded', async () => {
    const { svc, repo } = await world();
    await expect(svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C1', amountCents: 500 })).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
    await svc.setMyDeviceStatus(ctx(), DEVICE, 'revoked', 'lost phone');
    await expect(svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C2', amountCents: 500, deviceId: DEVICE })).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(await paid(repo)).toBe(0);
  });

  it('§29: an approval records the INTENT\'s amount (or the provider\'s), never a number the phone sends', async () => {
    const { svc, repo } = await world();
    const a = await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K9', deviceId: DEVICE, amountCents: 1000 });
    await svc.runReadinessStep(ctx(), 'K9', DEVICE);
    await svc.applyCaptureResult(ctx(), 'K9', { outcome: 'approved', processorRef: 'R9', capturedAmountCents: 999_999 }, DEVICE);
    expect(a.amountCents).toBe(1000);
    expect(await paid(repo)).toBe(1000);
  });

  it('Oct 28 audit: a provider answer with verified false and NO outcome is UNKNOWN (verified later) — never a decline, no money, no new key', async () => {
    const { svc, repo, provider } = await world();
    const p1 = await svc.evaluateProceed(ctx(), TK, { sessionId: 's1', deviceId: DEVICE });
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: p1.idempotencyKey!, deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), p1.idempotencyKey!, DEVICE);
    provider.finalizeTransaction = async (i: FinalizeInput) => ({ verified: false, processorRef: 'TXN-' + i.idempotencyKey });   // no outcome at all
    const r = await svc.applyCaptureResult(ctx(), p1.idempotencyKey!, { outcome: 'approved', processorRef: 'R1' }, DEVICE);
    expect(r).toMatchObject({ to: 'unknown' });
    expect(await paid(repo)).toBe(0);
    // the customer may have been charged: a second payment for the ticket is held, not offered a fresh key
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: p1.idempotencyKey + '-1', deviceId: DEVICE })).rejects.toMatchObject({ code: 'PAYMENT_STATUS_UNKNOWN' });
  });

  it('Oct 28 audit (§41 / §43): a Tap to Pay card payment is never refunded or voided through the branch card gateway — refused by code, no money', async () => {
    const { svc, repo, checkout } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'KR', deviceId: DEVICE, amountCents: 1000 });
    await svc.runReadinessStep(ctx(), 'KR', DEVICE);
    await svc.applyCaptureResult(ctx(), 'KR', { outcome: 'approved', processorRef: 'RR' }, DEVICE);
    const ttp = (await repo.payments(cctx)).find((x) => x.paymentSurface === 'tap_to_pay_iphone' && (x.status === 'approved' || x.status === 'partial'));   // a part-payment of the ticket is 'partial'
    expect(ttp).toBeDefined();
    const mgr = { ...cctx, permissions: [...perms, 'pos.checkout.refund', 'pos.checkout.void'] } as unknown as CheckoutContext;   // a manager who may refund and void
    await expect(checkout.refund(mgr, ttp!.paymentId, { reason: 'chipped nail', amountCents: 500 })).rejects.toMatchObject({ code: 'TAP_TO_PAY_REFUND_AT_PROCESSOR' });
    await expect(checkout.void(mgr, ttp!.paymentId, { reason: 'wrong ticket' })).rejects.toMatchObject({ code: 'TAP_TO_PAY_REFUND_AT_PROCESSOR' });
    expect(await paid(repo)).toBe(1000);   // nothing moved
  });

  it('§29: with no configured provider an "approved" from the phone is refused and moves no money', async () => {
    const { svc, repo, provider } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K8', deviceId: DEVICE, amountCents: 1000 });
    await svc.runReadinessStep(ctx(), 'K8', DEVICE);
    (provider as any).isConfigured = () => false;
    await expect(svc.applyCaptureResult(ctx(), 'K8', { outcome: 'approved', processorRef: 'R8' }, DEVICE)).rejects.toMatchObject({ code: 'TAP_TO_PAY_NOT_AVAILABLE' });
    expect(await paid(repo)).toBe(0);
  });

  it('§37: POST …/reconcile asks the PROVIDER (verify) — a client-sent "confirmed" + reference + amount records nothing', async () => {
    const svc: any = { verifyAttempt: vi.fn(async () => ({ status: 'unknown', decision: { action: 'wait' } })), reconcileAttempt: vi.fn() };
    const c = new MobileCheckoutController(svc);
    const req = { ctx: { tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: perms } };
    await c.reconcile(req, 'K1', { resolution: 'confirmed', processorRef: 'FAKE', capturedAmountCents: 100000 });
    expect(svc.verifyAttempt).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), 'K1');
    expect(svc.reconcileAttempt).not.toHaveBeenCalled();
  });
});
