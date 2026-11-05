// mobile-money-wiring.vitest.spec.ts — Owner & Manager Payment App mandate §72 / §84–§87 / §168–§173 / §219: a verified
// Tap to Pay capture becomes MONEY on the canonical checkout (payments row with surface 'tap_to_pay_iphone', ticket paid,
// the POS's post-payment work, the realtime signals) — exactly once. Before this wiring the attempt reached 'confirmed'
// and the POS ticket stayed unpaid. Also: a partial tender leaves the ticket PARTIALLY paid with the balance due (§87),
// a repeated SDK callback records nothing twice (§67), a recording failure after the processor captured leaves the
// attempt UNKNOWN (never failed, never re-charged), and a declined result moves no money.
import { describe, it, expect, vi } from 'vitest';
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
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: this.verified, processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
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
const ticketStatus = async (repo: InMemoryCheckoutRepository) => (await repo.ticket(cctx, TK))!.status;

describe('Tap to Pay capture → canonical checkout money (mandate §72)', () => {
  it('a processor-verified approval records ONE payments row (surface tap_to_pay_iphone, brand + last4 only), pays the ticket, runs the post-payment work and signals the POS', async () => {
    const { repo, svc, attempts, post, realtime, due } = await world();
    const a = await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    expect(a.amountCents).toBe(due);
    expect(a).toMatchObject({ provider: 'fiserv_commercehub', paymentSurface: TAP_TO_PAY_SURFACE, deviceId: DEVICE, currency: 'USD' });
    expect(a.checkoutVersion).toBeTruthy();
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.mintDeviceSession(ctx(), 'K1', DEVICE);
    const r = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1', brand: 'visa', last4: '4242' }, DEVICE);
    expect(r).toMatchObject({ from: 'ready', to: 'confirmed', outcome: 'approved', ticketPaid: true, remainingCents: 0 });
    expect(r.paymentId).toBeTruthy();
    // the money
    expect(await paid(repo)).toBe(due);
    expect(await ticketStatus(repo)).toBe('paid');
    const row = await repo.findPaymentByIdempotencyKey(cctx, 'K1');
    expect(row).toMatchObject({ method: 'card', amountCents: due, status: 'approved', paymentSurface: TAP_TO_PAY_SURFACE, deviceId: DEVICE, cardBrand: 'visa', cardLast4: '4242', processorTransactionId: 'TXN-K1' });
    expect(JSON.stringify(row)).not.toMatch(/4242424242424242|cvv|track/i);
    // the attempt links to its payment and carries safe metadata only
    const att = (await attempts.findByKey(T, 'K1'))!;
    expect(att).toMatchObject({ status: 'confirmed', paymentId: row!.paymentId, processorRef: 'TXN-K1', cardBrand: 'visa', cardLast4: '4242' });
    // the POS's post-payment work (payroll snapshot, loyalty, gift cards…) ran once, after the money
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ tenantId: T, branchId: B }, TK);
    // the realtime signals the POS and the customer display refresh on
    const events = realtime.toTenant.mock.calls.map((c: any[]) => c[1]);
    expect(events).toEqual(expect.arrayContaining([EVENTS.paymentApproved, EVENTS.ticketPaid, EVENTS.reportsUpdated]));
  });

  it('§67/§154: a repeated SDK callback for a confirmed attempt replays the result — no second payments row, no second post-payment run', async () => {
    const { repo, svc, post } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    const first = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    for (let i = 0; i < 20; i++) {
      const again = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
      expect(again).toMatchObject({ from: 'confirmed', to: 'confirmed', outcome: 'approved', paymentId: first.paymentId });
    }
    expect((await repo.paymentsForTicket(cctx, TK)).filter((p) => p.status === 'approved' || p.status === 'partial')).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('§87 partial: $40 cash tender + $60 card — two tenders, balance 0, ticket paid; a declined card leaves the $40 and the $60 balance', async () => {
    const { repo, svc, provider, due } = await world();
    const cash = Math.round(due * 0.4); const card = due - cash;
    const t = await svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C1', amountCents: cash, deviceId: DEVICE });
    expect(t).toMatchObject({ duplicate: false, paidCents: cash, remainingCents: card, ticketPaid: false });
    expect(await ticketStatus(repo)).toBe('payment_in_progress');
    // the same cash key again: recorded once (§115 idempotency)
    expect((await svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C1', amountCents: cash })).duplicate).toBe(true);
    expect(await paid(repo)).toBe(cash);
    // the card part is its OWN intent for exactly the remaining balance (§86)
    const a = await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    expect(a.amountCents).toBe(card);
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    provider.verified = false;   // the processor declines the $60
    const d = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    expect(d).toMatchObject({ to: 'declined', outcome: 'declined' });
    expect(await paid(repo)).toBe(cash);                  // the successful $40 is never erased (§87)
    expect(await ticketStatus(repo)).toBe('payment_in_progress');
    expect((await svc.getBalanceSummary(ctx(), TK))).toMatchObject({ confirmedCents: cash, remainingCents: card, isFullyPaid: false });
    // retry with a new intent: approved → covered → paid
    provider.verified = true;
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K2', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K2', DEVICE);
    const ok = await svc.applyCaptureResult(ctx(), 'K2', { outcome: 'approved', processorRef: 'sess-K2' }, DEVICE);
    expect(ok).toMatchObject({ to: 'confirmed', ticketPaid: true, remainingCents: 0 });
    expect(await paid(repo)).toBe(due);
    expect(await ticketStatus(repo)).toBe('paid');
    const rows = (await repo.paymentsForTicket(cctx, TK)).filter((p) => p.status === 'approved' || p.status === 'partial');
    expect(rows.map((p) => [p.method, p.amountCents, p.status])).toEqual(expect.arrayContaining([['cash', cash, 'partial'], ['card', card, 'approved']]));
    expect(rows).toHaveLength(2);
  });

  it('§74: the processor captured but recording failed → the attempt is UNKNOWN with the reference (never failed, never charged again)', async () => {
    const { svc, attempts, realtime } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    (svc as any).x.recorder = { recordTender: async () => { throw new Error('db down'); } };
    const r = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    expect(r).toMatchObject({ to: 'unknown', outcome: 'unknown' });
    const att = (await attempts.findByKey(T, 'K1'))!;
    expect(att).toMatchObject({ status: 'unknown', processorRef: 'TXN-K1', lastErrorCode: 'PAYMENT_STATUS_UNKNOWN' });
    expect(realtime.toTenant.mock.calls.map((c: any[]) => c[1])).toContain(EVENTS.paymentVerifying);
  });

  it('§129: the provider does not answer the finalize → UNKNOWN, no decline, no blind retry', async () => {
    const { svc, attempts, provider } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    provider.finalizeTransaction = async () => { throw new Error('ECONNRESET'); };
    const r = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    expect(r.to).toBe('unknown');
    expect((await attempts.findByKey(T, 'K1'))!.status).toBe('unknown');
  });

  it('§76 reconcile confirmed after an unknown result records the money ONCE (idempotent with the earlier key)', async () => {
    const { repo, svc, attempts, due } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'unknown' }, DEVICE);
    const r = await svc.reconcileAttempt(ctx(), 'K1', 'confirmed', { processorRef: 'TXN-K1', brand: 'mastercard', last4: '4444' });
    expect(r).toMatchObject({ from: 'unknown', to: 'confirmed' });
    expect(await paid(repo)).toBe(due);
    expect((await attempts.findByKey(T, 'K1'))!.paymentId).toBe(r.paymentId);
    // a second reconcile cannot run (state machine) and the money stays single
    await expect(svc.reconcileAttempt(ctx(), 'K1', 'confirmed', { processorRef: 'TXN-K1' })).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await repo.paymentsForTicket(cctx, TK)).filter((p) => p.status === 'approved')).toHaveLength(1);
  });

  it('§76 reconcile confirmed WITHOUT a processor reference is refused (no money on an unverified claim)', async () => {
    const { repo, svc } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'unknown' }, DEVICE);
    await expect(svc.reconcileAttempt(ctx(), 'K1', 'confirmed')).rejects.toMatchObject({ code: 'invalid' });
    expect(await paid(repo)).toBe(0);
  });

  it('§77/§78 verify asks the provider and acts only on its answer: approved → recorded; not found past the window → released; no inquiry → unchanged', async () => {
    const { repo, svc, attempts, provider, due } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'timeout' }, DEVICE);
    provider.lookup = { kind: 'no_inquiry' };
    expect((await svc.verifyAttempt(ctx(), 'K1')).status).toBe('timed_out');
    provider.lookup = { kind: 'not_found' };
    expect((await svc.verifyAttempt(ctx(), 'K1')).decision.action).toBe('wait');   // inside the release window
    provider.lookup = { kind: 'approved', processorRef: 'TXN-late', capturedAmountCents: due, cardBrand: 'amex', cardLast4: '0005' };
    const v = await svc.verifyAttempt(ctx(), 'K1');
    expect(v.status).toBe('confirmed');
    expect(await paid(repo)).toBe(due);
    expect((await attempts.findByKey(T, 'K1'))!).toMatchObject({ processorRef: 'TXN-late', cardLast4: '0005' });
  });

  it('a DECLINED capture moves no money and the ticket stays payable', async () => {
    const { repo, svc, post } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    const r = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'declined' }, DEVICE);
    expect(r.to).toBe('declined');
    expect(await paid(repo)).toBe(0);
    expect(await ticketStatus(repo)).not.toBe('paid');
    expect(post).not.toHaveBeenCalled();
  });

  it('§216: a cash tender larger than the balance, or on a paid ticket, is refused', async () => {
    const { svc, due } = await world();
    await expect(svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C9', amountCents: due + 1 })).rejects.toMatchObject({ code: 'amount_exceeds_remaining' });
    await svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C1', amountCents: due });
    await expect(svc.recordCashTender(ctx(), TK, { sessionId: 's1', idempotencyKey: 'C2', amountCents: 100 })).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_COMPLETED' });
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE })).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_COMPLETED' });
  });
});

describe('§143–§144 Tap to Pay business counters (the ONE payment counter, bounded names)', () => {
  it('counts one attempt + one approval however many times the SDK repeats the callback; a decline counts as declined', async () => {
    resetIntegrationBusinessCountsForTests();
    const { svc } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });   // same intent again
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    for (let i = 0; i < 5; i++) await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    expect(integrationBusinessCounts().payments).toMatchObject({ attempt: 1, approved: 1 });
    const w2 = await world();
    await w2.svc.createAttempt(ctx(), TK, { sessionId: 's2', idempotencyKey: 'K2', deviceId: DEVICE });
    await w2.svc.runReadinessStep(ctx(), 'K2', DEVICE);
    await w2.svc.applyCaptureResult(ctx(), 'K2', { outcome: 'declined' }, DEVICE);
    expect(integrationBusinessCounts().payments).toMatchObject({ attempt: 2, approved: 1, declined: 1 });
  });
});
