// mobile-recovery-convergence.vitest.spec.ts — Secure Tap to Pay §35 / §36 / §73 (Oct 27 2026): the SOFTWARE half of the
// recovery states, proven end to end with a provider test double (the live CommerceHub inquiry is the external half):
// the durable worker (MobileAttemptRecoveryWorker) drives the REAL MobileCheckoutService.verifyAttempt over the canonical
// checkout, so UNKNOWN → APPROVED / DECLINED / NOT_FOUND (released after the window) / STILL_PENDING (waits), an attempt
// parked for a human (reconciliation_required) still converges when the provider later answers, and the worker and a
// manual Verify running AT THE SAME TIME record the money exactly once (§36 "Verify and worker converge", §73 "no second
// charge"). TEST DOUBLE provider — never production.
import { describe, it, expect, vi } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { MobileAttemptRecoveryWorker, NOT_FOUND_RELEASE_MS, DEFAULT_STALE_MS, UNREACHABLE_REVIEW_FACTOR } from './mobile-attempt-recovery';
import type { Ctx } from '@aipowersalon/permissions';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const T = 'luxe001'; const B = 'br_cherryhill'; const TK = 'tk_2042'; const DEVICE = 'iphone-kevin-01';
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'mobile_checkout.split_payment', 'pos.devices.manage'];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: perms, ...over });
const cctx = ctx() as unknown as CheckoutContext;

class FakeProvider implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  lookups = 0; lookup: TapToPayLookup = { kind: 'unreachable', error: 'ETIMEDOUT' };
  isConfigured() { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { return { provider: this.provider, sessionToken: 'sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: true, processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
  async lookupTransaction(): Promise<TapToPayLookup> { this.lookups++; await new Promise((r) => setTimeout(r, 5)); return this.lookup; }   // a little latency so two verifiers really overlap
}

/** One salon, one ticket, one approved phone, one attempt left UNKNOWN (the result was lost). `clock` moves the service's time. */
async function unknownAttempt(key = 'K1') {
  for (const [k, v] of Object.entries(TTP_ENV)) process.env[k] = v;
  let offset = 0;
  const now = () => new Date(Date.now() + offset);
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const provider = new FakeProvider();
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }) };
  const locks: any = { getStatus: async () => ({ locked: true, ownedByCaller: true, heldBy: null }), acquire: async () => ({ acquired: true, action: 'acquired', expiresAt: '' }), release: async () => ({ released: true }), active: async () => null };
  const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, attempts, new InMemoryTtpOnboardingStore(), new InMemoryMobilePayDeviceStore(), provider, undefined, { recorder: new MobileCaptureRecorder(repo, null), realtime, audit: { record: vi.fn() }, now });
  await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), T, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true } as any);
  await svc.setMyDeviceStatus(ctx(), DEVICE, 'active');
  await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: key, deviceId: DEVICE });
  await svc.runReadinessStep(ctx(), key, DEVICE);
  await svc.applyCaptureResult(ctx(), key, { outcome: 'unknown' }, DEVICE);
  const due = (await repo.totalsFor(cctx, TK, 'card'))!.totalDueCents;
  const alerts = { raise: vi.fn(async () => undefined) };
  // the worker looks at attempts untouched for staleMs; its clock follows the service's
  const worker = new MobileAttemptRecoveryWorker(attempts, svc, alerts, { now });
  const advance = (ms: number) => { offset += ms; };
  const approvedPayments = async () => (await repo.paymentsForTicket(cctx, TK)).filter((p) => p.status === 'approved');
  return { repo, svc, attempts, provider, worker, alerts, advance, due, approvedPayments, status: async () => (await attempts.findByKey(T, key))!.status };
}

describe('§35 recovery states through the durable worker (provider test double)', () => {
  it('UNKNOWN → STILL_PENDING (provider unreachable: waits, nothing decided) → APPROVED (money recorded once)', async () => {
    const w = await unknownAttempt();
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ checked: 1, waiting: 1, confirmed: 0 });
    expect(await w.status()).toBe('unknown');
    expect(await w.approvedPayments()).toHaveLength(0);
    w.provider.lookup = { kind: 'approved', processorRef: 'TXN-late', capturedAmountCents: w.due, cardBrand: 'visa', cardLast4: '4242' };
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ checked: 1, confirmed: 1 });
    expect(await w.status()).toBe('confirmed');
    expect(await w.approvedPayments()).toHaveLength(1);
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ checked: 0 });                                   // resolved → never looked at again
  });
  it('UNKNOWN → DECLINED: the provider says declined → declined, no money, the ticket stays payable', async () => {
    const w = await unknownAttempt();
    w.provider.lookup = { kind: 'declined', processorRef: 'TXN-d' };
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ declined: 1 });
    expect(await w.status()).toBe('declined');
    expect(await w.approvedPayments()).toHaveLength(0);
  });
  it('UNKNOWN → NOT_FOUND: waits inside the release window, released (canceled) after it — the key is free for a new intent', async () => {
    const w = await unknownAttempt();
    w.provider.lookup = { kind: 'not_found' };
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ waiting: 1 });
    expect(await w.status()).toBe('unknown');
    w.advance(NOT_FOUND_RELEASE_MS);
    expect(await w.worker.run()).toMatchObject({ released: 1 });
    expect(await w.status()).toBe('canceled');
    expect(await w.approvedPayments()).toHaveLength(0);
  });
});

describe('§36 / §73 the worker and a manual Verify converge', () => {
  it('worker tick and Verify at the SAME time on an approved attempt → exactly one payment, both end confirmed', async () => {
    const w = await unknownAttempt();
    w.provider.lookup = { kind: 'approved', processorRef: 'TXN-race', capturedAmountCents: w.due };
    w.advance(DEFAULT_STALE_MS + 1_000);
    const [tick, manual] = await Promise.allSettled([w.worker.run(), w.svc.verifyAttempt(ctx(), 'K1')]);
    expect(tick.status).toBe('fulfilled');
    expect(w.provider.lookups).toBe(2);                                                           // both really asked the provider (overlapping)
    // the loser either sees "already confirmed" or is refused by the state machine — never a second payment
    if (manual.status === 'fulfilled') expect(manual.value.status).toBe('confirmed'); else expect((manual.reason as any)?.code).toBe('invalid_state');
    expect(await w.status()).toBe('confirmed');
    expect(await w.approvedPayments()).toHaveLength(1);
    expect(await w.repo.paidTotalCents(cctx, TK)).toBe(w.due);
  });
  it('a long-unanswered attempt is parked for a human ONCE (reconciliation_required + one alert per tick); a later provider answer still converges to one payment', async () => {
    const w = await unknownAttempt();
    w.provider.lookup = { kind: 'no_inquiry' };
    w.advance(DEFAULT_STALE_MS * UNREACHABLE_REVIEW_FACTOR + 1_000);
    expect(await w.worker.run()).toMatchObject({ review: 1 });
    expect(await w.status()).toBe('reconciliation_required');
    expect(w.alerts.raise).toHaveBeenCalledTimes(1);
    expect(w.alerts.raise.mock.calls[0][0]).toMatchObject({ tenantId: T, ticketId: TK, idempotencyKey: 'K1', amountCents: expect.any(Number) });
    // the provider inquiry becomes available (the external half) — the SAME worker resolves the parked attempt
    w.provider.lookup = { kind: 'approved', processorRef: 'TXN-later', capturedAmountCents: w.due };
    w.advance(DEFAULT_STALE_MS + 1_000);
    expect(await w.worker.run()).toMatchObject({ confirmed: 1 });
    expect(await w.status()).toBe('confirmed');
    expect(await w.approvedPayments()).toHaveLength(1);
    await w.svc.verifyAttempt(ctx(), 'K1');                                                         // a late manual Verify is a no-op
    expect(await w.approvedPayments()).toHaveLength(1);
  });
});
