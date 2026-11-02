import { describe, it, expect, vi } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
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
// ttp-refund-in-pos.vitest.spec.ts — Kevin's decision (Oct 28 2026): Tap to Pay refunds and voids are built into the POS.
// A Tap to Pay card payment is refunded / voided on the CommerceHub rail of the caller's location — never the location's card
// gateway — with the same rules as any card: claim first, an explicit decline releases, anything else is UNKNOWN (held,
// never retried). No rail → TAP_TO_PAY_REFUND_AT_PROCESSOR, as before.
import { CommerceHubTapToPayRefunds } from './ttp-refund-processor';

const mgrCtx = () => ({ ...cctx, permissions: [...perms, 'pos.checkout.refund', 'pos.checkout.void', 'pos.checkout.approve_refund'] } as unknown as CheckoutContext);

function rail(over: { refund?: (i: any) => Promise<any>; voidTransaction?: (i: any) => Promise<any> } = {}) {
  const calls: any[] = [];
  const proc: any = {
    name: 'commercehub',
    refund: vi.fn(async (i: any) => { calls.push(['refund', i]); return over.refund ? over.refund(i) : { ok: true, retref: 'RF-1', respstat: 'APPROVED', respText: 'APPROVED' }; }),
    voidTransaction: vi.fn(async (i: any) => { calls.push(['void', i]); return over.voidTransaction ? over.voidTransaction(i) : { ok: true, retref: 'VD-1', respstat: 'APPROVED', respText: 'APPROVED' }; }),
    authorizeAndCapture: vi.fn(),
  };
  const asked: any[] = [];
  return { port: { processorFor: async (c: any) => { asked.push(c); return proc; } }, proc, calls, asked };
}

async function tapPaid(key = 'KR') {
  const w = await world();
  await w.svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: key, deviceId: DEVICE, amountCents: 1000 });
  await w.svc.runReadinessStep(ctx(), key, DEVICE);
  await w.svc.applyCaptureResult(ctx(), key, { outcome: 'approved', processorRef: 'R-' + key }, DEVICE);
  const pay = (await w.repo.payments(cctx)).find((x) => x.paymentSurface === 'tap_to_pay_iphone' && (x.status === 'approved' || x.status === 'partial'))!;
  return { ...w, pay };
}

describe('Tap to Pay refunds and voids in the POS', () => {
  it('a refund goes to the CommerceHub rail of THIS tenant + location, against the CommerceHub transaction id, and is recorded', async () => {
    const { checkout, repo, pay } = await tapPaid();
    const r = rail(); checkout.useTapToPayRefunds(r.port);
    const out: any = await checkout.refund(mgrCtx(), pay.paymentId, { reason: 'chipped nail', amountCents: 400 });
    expect(out).toMatchObject({ status: 'refunded' });
    expect(r.calls).toEqual([['refund', expect.objectContaining({ retref: pay.processorTransactionId, amountCents: 400 })]]);
    expect(r.asked[0]).toMatchObject({ tenantId: T, branchId: B });
    expect(await repo.refundedTotalCents(cctx, pay.paymentId)).toBe(400);
  });

  it('an explicit decline releases the reservation (the cashier may try again); an UNKNOWN answer holds it — the next refund is refused, never sent', async () => {
    const { checkout, pay } = await tapPaid('KD');
    const declined = rail({ refund: async () => ({ ok: false, declined: true, respstat: '104', respText: 'DECLINED' }) });
    checkout.useTapToPayRefunds(declined.port);
    await expect(checkout.refund(mgrCtx(), pay.paymentId, { reason: 'r', amountCents: 300 })).rejects.toMatchObject({ apiCode: 'REFUND_DECLINED' });
    const lost = rail({ refund: async () => { throw new Error('socket hang up'); } });
    checkout.useTapToPayRefunds(lost.port);
    await expect(checkout.refund(mgrCtx(), pay.paymentId, { reason: 'r', amountCents: 300 })).rejects.toThrow(/REFUND_STATUS_UNKNOWN/);
    const after = rail(); checkout.useTapToPayRefunds(after.port);
    await expect(checkout.refund(mgrCtx(), pay.paymentId, { reason: 'r', amountCents: 300 })).rejects.toThrow(/REFUND_PENDING_VERIFICATION/);
    expect(after.calls).toEqual([]);   // never a second refund while the first may have landed
  });

  it('a void goes to the CommerceHub rail and reverses the payment', async () => {
    const { checkout, repo, pay } = await tapPaid('KV');
    const r = rail(); checkout.useTapToPayRefunds(r.port);
    expect(await checkout.void(mgrCtx(), pay.paymentId, { reason: 'wrong ticket' })).toMatchObject({ status: 'voided' });
    expect(r.calls).toEqual([['void', { retref: pay.processorTransactionId }]]);
    expect(await repo.paidTotalCents(cctx, TK)).toBe(0);
  });

  it('a void whose answer is lost (thrown, or neither approved nor declined) is VOID_STATUS_UNKNOWN — nothing recorded, the payment still stands', async () => {
    const { checkout, repo, pay } = await tapPaid('KU');
    checkout.useTapToPayRefunds(rail({ voidTransaction: async () => { throw new Error('timeout'); } }).port);
    await expect(checkout.void(mgrCtx(), pay.paymentId, { reason: 'r' })).rejects.toMatchObject({ code: 'VOID_STATUS_UNKNOWN' });
    checkout.useTapToPayRefunds(rail({ voidTransaction: async () => ({ ok: false, respstat: 'PENDING', respText: 'PENDING' }) }).port);
    await expect(checkout.void(mgrCtx(), pay.paymentId, { reason: 'r' })).rejects.toMatchObject({ code: 'VOID_STATUS_UNKNOWN' });
    checkout.useTapToPayRefunds(rail({ voidTransaction: async () => ({ ok: false, declined: true, respstat: '104', respText: 'DECLINED' }) }).port);
    await expect(checkout.void(mgrCtx(), pay.paymentId, { reason: 'r' })).rejects.toMatchObject({ apiCode: 'VOID_DECLINED' });
    expect(await repo.paidTotalCents(cctx, TK)).toBe(1000);
  });

  it('no rail for this location (no Tap to Pay merchant / no CommerceHub credentials) → TAP_TO_PAY_REFUND_AT_PROCESSOR, never the card gateway', async () => {
    const { checkout, repo, pay } = await tapPaid('KN');
    checkout.useTapToPayRefunds({ processorFor: async () => null });
    await expect(checkout.refund(mgrCtx(), pay.paymentId, { reason: 'r', amountCents: 100 })).rejects.toMatchObject({ code: 'TAP_TO_PAY_REFUND_AT_PROCESSOR' });
    await expect(checkout.void(mgrCtx(), pay.paymentId, { reason: 'r' })).rejects.toMatchObject({ code: 'TAP_TO_PAY_REFUND_AT_PROCESSOR' });
    expect(await repo.paidTotalCents(cctx, TK)).toBe(1000);
  });

  it('CommerceHubTapToPayRefunds builds the client with the LOCATION\'s Tap to Pay merchant, and answers null without one', async () => {
    const env: any = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_BASE_URL: 'https://cert.api.fiservapps.com/ch' };
    const bodies: any[] = [];
    const fetchImpl = async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: 'RF9' } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'APPROVED' } } }) }; };
    const withMid = new CommerceHubTapToPayRefunds({ resolveTapToPayMerchant: async () => ({ merchantId: 'MID-CH', terminalId: 'TERM-CH', scope: 'branch', merchantAccountId: 'a1', merchantIdMasked: '••CH' }) } as any, env, fetchImpl);
    const proc = await withMid.processorFor({ tenantId: T, branchId: B });
    const res = await proc!.refund({ retref: 'TX1', amountCents: 250 } as any);
    expect(res).toMatchObject({ ok: true, retref: 'RF9' });
    expect(bodies[0].merchantDetails).toEqual({ merchantId: 'MID-CH', terminalId: 'TERM-CH' });
    expect(await new CommerceHubTapToPayRefunds({ resolveTapToPayMerchant: async () => null } as any, env, fetchImpl).processorFor({ tenantId: T, branchId: B })).toBeNull();
    expect(await new CommerceHubTapToPayRefunds({ resolveTapToPayMerchant: async () => ({ merchantId: 'M' }) } as any, {}, fetchImpl).processorFor({ tenantId: T })).toBeNull();   // no CommerceHub credentials
  });
});
