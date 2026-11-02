// mobile-guards.vitest.spec.ts — Owner & Manager Payment App mandate: the guards that sit BEFORE a card is presented.
//   §55/§155 checkout version conflict (never charge a stale amount)   §14/§161–§163 device + user + branch binding
//   §197–§199 kill switches (Tap to Pay off, terminals untouched)      §46/§152 claim takeover rules
//   §211–§213 production refuses a mock provider                        §132 intent expiry
import { describe, it, expect, vi } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { InMemoryTapToPayKillSwitch } from './ttp-kill-switch';
import { tapToPayProductionProblems } from './ttp-config';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';
import { computeCheckoutVersion } from './mobile-checkout-ticket';
import type { Ctx } from '@aipowersalon/permissions';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const creds = (on: boolean) => { for (const k of Object.keys(TTP_ENV)) { if (on) process.env[k] = (TTP_ENV as any)[k]; else delete process.env[k]; } };
const T = 'luxe001'; const B = 'br_cherryhill'; const TK = 'tk_2042'; const DEVICE = 'iphone-kevin-01';
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'pos.checkout.discount', 'checkout.manage_overrides', 'mobile_checkout.split_payment', 'pos.devices.manage'];
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: perms, ...over });
const cctx = ctx() as unknown as CheckoutContext;

class FakeProvider implements TapToPaySessionPort {
  readonly provider = 'fiserv_commercehub';
  minted = 0;
  isConfigured() { return true; }
  async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { this.minted++; return { provider: this.provider, sessionToken: 'sess-' + i.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
  async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { return { verified: true, processorRef: 'TXN-' + i.idempotencyKey, capturedAmountCents: i.amountCents }; }
  async lookupTransaction(): Promise<TapToPayLookup> { return { kind: 'not_found' }; }
}

async function world() {
  creds(true);
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const devices = new InMemoryMobilePayDeviceStore();
  const onboarding = new InMemoryTtpOnboardingStore();
  const provider = new FakeProvider();
  const killSwitch = new InMemoryTapToPayKillSwitch();
  const locks = new CheckoutLockService(new InMemoryCheckoutLockRepository());
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }) };
  const audit = { record: vi.fn() };
  const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, attempts, onboarding, devices, provider, undefined, { recorder: new MobileCaptureRecorder(repo, null), realtime, audit, killSwitch });
  await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), T, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true });
  await svc.setMyDeviceStatus(ctx(), DEVICE, 'active');
  await svc.acquireLock(ctx(), TK, DEVICE, 'S1');
  return { repo, checkout, svc, attempts, devices, provider, killSwitch, locks, realtime, audit };
}

describe('§55 / §155–§156 checkout version conflict — never charge a stale amount', () => {
  it('proceed with a stale version is refused with CHECKOUT_VERSION_CONFLICT and the fresh version', async () => {
    const { svc, checkout } = await world();
    const d = await svc.getTicketDetail(ctx(), TK);
    expect(d.version).toMatch(/^[0-9a-f]{16}$/);
    const ok = await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE, expectedVersion: d.version });
    expect(ok.canProceed).toBe(true);
    // the POS changes the ticket (a discount) after the phone loaded it
    await checkout.applyDiscount(cctx, TK, { discountCents: 500, reason: 'loyal guest' });
    const stale = await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE, expectedVersion: d.version });
    expect(stale).toMatchObject({ canProceed: false, reason: 'CHECKOUT_VERSION_CONFLICT' });
    expect(stale.version).not.toBe(d.version);
    expect(stale.balanceCents).toBeLessThan(d.balanceDueCents);   // the refreshed, server-calculated amount (§54)
  });

  it('an intent created on the old version cannot mint a session after the POS changed the total — the processor is never asked', async () => {
    const { svc, checkout, provider, attempts } = await world();
    const a = await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await checkout.applyDiscount(cctx, TK, { discountCents: 1000, reason: 'price fix' });
    // M6-6 §31 / §66: an intent made against an older version is CHECKOUT_STALE
    await expect(svc.mintDeviceSession(ctx(), 'K1', DEVICE)).rejects.toMatchObject({ code: 'CHECKOUT_STALE' });
    expect(provider.minted).toBe(0);
    expect((await attempts.findByKey(T, 'K1'))!.lastErrorCode).toBe('CHECKOUT_STALE');
    expect(a.amountCents).toBeGreaterThan((await svc.getTicketDetail(ctx(), TK)).balanceDueCents);
    // the app resyncs: cancel, re-open the ticket (a re-claim at the current version) + a new intent for the refreshed amount
    await svc.cancelAttempt(ctx(), 'K1');
    await svc.acquireLock(ctx(), TK, DEVICE, 'S1');
    const fresh = await svc.getTicketDetail(ctx(), TK);
    const b = await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K2', deviceId: DEVICE, expectedVersion: fresh.version });
    expect(b.amountCents).toBe(fresh.balanceDueCents);
    await svc.runReadinessStep(ctx(), 'K2', DEVICE);
    await svc.mintDeviceSession(ctx(), 'K2', DEVICE);
    expect(provider.minted).toBe(1);
  });

  it('createAttempt with a stale expectedVersion is refused', async () => {
    const { svc, checkout } = await world();
    const d = await svc.getTicketDetail(ctx(), TK);
    await checkout.applyDiscount(cctx, TK, { discountCents: 100, reason: 'x' });
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE, expectedVersion: d.version })).rejects.toMatchObject({ code: 'CHECKOUT_VERSION_CONFLICT' });
  });

  it('computeCheckoutVersion is deterministic and changes with any money-relevant field', () => {
    const base: any = { completedServices: [{ serviceLineId: 'l1', priceCents: 1000, qty: 1 }], totals: { subtotalCents: 1000, tipCents: 0, taxCents: 70, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 1070 } };
    const v = computeCheckoutVersion(base);
    expect(computeCheckoutVersion(JSON.parse(JSON.stringify(base)))).toBe(v);
    expect(computeCheckoutVersion({ ...base, totals: { ...base.totals, tipCents: 200, totalDueCents: 1270 } })).not.toBe(v);
    expect(computeCheckoutVersion({ ...base, completedServices: [{ serviceLineId: 'l1', priceCents: 1100, qty: 1 }] })).not.toBe(v);
    expect(computeCheckoutVersion({ ...base, promotion: { code: 'X', amountCents: 100 } })).not.toBe(v);
  });
});

// Secure Tap to Pay M6-6 (§21 / §31 / §66, migration 690): the claim remembers the checkout version it was made against
describe('§31 / §66 claim version — a claim made at version 7 cannot charge version 8 (CHECKOUT_STALE)', () => {
  it('the POS edits the ticket after the phone claimed it: proceed and a new intent are CHECKOUT_STALE; a re-claim clears it', async () => {
    const { svc, checkout, locks, audit } = await world();
    const v7 = await svc.getTicketDetail(ctx(), TK);
    expect((await locks.active(T, TK))!.checkoutVersion).toBe(v7.version);
    await checkout.applyDiscount(cctx, TK, { discountCents: 500, reason: 'front desk edit' });   // → version 8
    // the phone did not send a version (an old app) — the stored claim version still catches it
    const p = await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE });
    expect(p).toMatchObject({ canProceed: false, reason: 'CHECKOUT_STALE' });
    expect(p.idempotencyKey).toBeUndefined();
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K-stale', deviceId: DEVICE })).rejects.toMatchObject({ code: 'CHECKOUT_STALE' });
    expect(audit.record.mock.calls.some((c: any[]) => JSON.stringify(c).includes('mobile_checkout_claim_stale'))).toBe(true);
    // a heartbeat does NOT refresh the version (it is not a look at the amount)
    await svc.refreshLock(ctx(), TK, 'S1');
    expect((await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE })).reason).toBe('CHECKOUT_STALE');
    // re-opening the ticket is a re-claim at the current version → the authoritative (smaller) amount, and it proceeds
    await svc.acquireLock(ctx(), TK, DEVICE, 'S1');
    const v8 = await svc.getTicketDetail(ctx(), TK);
    expect((await locks.active(T, TK))!.checkoutVersion).toBe(v8.version);
    const ok = await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE });
    expect(ok).toMatchObject({ canProceed: true, balanceCents: v8.balanceDueCents });
    expect(v8.balanceDueCents).toBeLessThan(v7.balanceDueCents);
  });
  it('an edit the CLAIM HOLDER makes from the phone (live pilot phase 5: retail / discount) keeps its claim current; the next part proceeds', async () => {
    const { svc, locks } = await world();
    await svc.applyTicketDiscount(ctx(), TK, { discountCents: 300, reason: 'phone discount' });
    const after = await svc.getTicketDetail(ctx(), TK);
    expect((await locks.active(T, TK))!.checkoutVersion).toBe(after.version);
    expect(await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE })).toMatchObject({ canProceed: true, balanceCents: after.balanceDueCents });
  });
  it('… but the same edit by ANOTHER employee (front desk) still makes the phone\'s claim stale', async () => {
    const { svc } = await world();
    await svc.applyTicketDiscount(ctx({ userId: 'u_desk', role: 'MANAGER' }), TK, { discountCents: 300, reason: 'desk discount' });
    expect((await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE })).reason).toBe('CHECKOUT_STALE');
  });
  it('an unchanged ticket is never called stale', async () => {
    const { svc } = await world();
    expect((await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE })).canProceed).toBe(true);
    expect((await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K-ok', deviceId: DEVICE })).status).toBe('created');
  });
});

describe('§14 / §161–§163 device, user and branch binding', () => {
  it('a REVOKED phone cannot claim, intend, mint or capture — DEVICE_REVOKED everywhere', async () => {
    const { svc, locks } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.setMyDeviceStatus(ctx(), DEVICE, 'revoked', 'lost phone');
    await expect(svc.mintDeviceSession(ctx(), 'K1', DEVICE)).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K2', deviceId: DEVICE })).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    await locks.release(T, TK, 'S1');
    await expect(svc.acquireLock(ctx(), TK, DEVICE, 'S2')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    const r = await svc.getReadiness(ctx(), DEVICE);
    expect(r.canTakePayment).toBe(false);
    expect(r.deviceBlockReason).toBe('DEVICE_REVOKED');
    expect((await svc.getCapability(ctx(), DEVICE)).state).toBe('setup_required');
  });

  it('another user on the same phone (or the same token on another phone) is DEVICE_NOT_AUTHORIZED; the owner can reassign with step-up (back to pending)', async () => {
    const { svc, locks } = await world();
    const lisa = ctx({ userId: 'u_lisa', role: 'MANAGER' });
    await expect(svc.registerDevice(lisa, { deviceId: DEVICE, platform: 'ios' })).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
    await expect(svc.createAttempt(lisa, TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE })).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
    await locks.release(T, TK, 'S1');
    await expect(svc.acquireLock(lisa, TK, DEVICE, 'S2')).rejects.toMatchObject({ code: 'DEVICE_NOT_AUTHORIZED' });
    const re = await svc.rebindMyDevice(ctx(), DEVICE, 'u_lisa');
    expect(re).toMatchObject({ boundUserId: 'u_lisa', status: 'pending' });   // never silently active for the new user
    expect((await svc.getReadiness(lisa, DEVICE)).deviceBlockReason).toBe('DEVICE_PENDING_APPROVAL');   // Secure Tap to Pay §57: rebound → waiting for approval
    await svc.setMyDeviceStatus(ctx(), DEVICE, 'active');
    expect((await svc.getReadiness(lisa, DEVICE)).canTakePayment).toBe(true);
    expect((await svc.getReadiness(ctx(), DEVICE)).deviceBlockReason).toBe('DEVICE_NOT_AUTHORIZED');   // the previous user lost it
  });

  it('§162 a branch-bound phone is not approved for another branch', async () => {
    const { svc } = await world();
    const marlton = ctx({ branchId: 'br_marlton' });
    expect((await svc.getReadiness(marlton, DEVICE)).canTakePayment).toBe(false);
    expect((await svc.getReadiness(ctx(), DEVICE)).canTakePayment).toBe(true);
  });

  it('§140 termination revokes every phone bound to the user', async () => {
    const { svc, devices } = await world();
    await svc.registerDevice(ctx(), { deviceId: 'iphone-kevin-02', platform: 'ios', tapToPayCapable: true });
    await svc.setMyDeviceStatus(ctx(), 'iphone-kevin-02', 'active');
    expect(await svc.revokeDevicesForUser({ tenantId: T, branchId: B, actorId: 'sys' }, 'u_owner', 'employment_ended')).toBe(2);
    expect((await devices.get(T, DEVICE))!.status).toBe('revoked');
    expect((await devices.get(T, 'iphone-kevin-02'))!.status).toBe('revoked');
  });
});

describe('§197–§199 kill switches', () => {
  it('the platform switch blocks proceed / intent / mint with TAP_TO_PAY_DISABLED but a result already captured still records (§219: money never lost)', async () => {
    const { svc, killSwitch, provider, repo } = await world();
    await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    killSwitch.platformOff = true;
    expect((await svc.evaluateProceed(ctx(), TK, { sessionId: 'S1', deviceId: DEVICE })).canProceed).toBe(false);
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K2', deviceId: DEVICE })).rejects.toMatchObject({ code: 'TAP_TO_PAY_DISABLED' });
    await expect(svc.mintDeviceSession(ctx(), 'K1', DEVICE)).rejects.toMatchObject({ code: 'TAP_TO_PAY_DISABLED' });
    expect(provider.minted).toBe(0);
    expect((await svc.getCapability(ctx(), DEVICE)).state).toBe('disabled');
    // the tap had already happened before the switch flipped: the processor's capture is recorded, not lost
    const r = await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess-K1' }, DEVICE);
    expect(r.to).toBe('confirmed');
    expect(await repo.paidTotalCents(cctx, TK)).toBeGreaterThan(0);
  });
  it('the provider-specific switch blocks only that provider', async () => {
    const { svc, killSwitch } = await world();
    killSwitch.providersOff.add('fiserv_commercehub');
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K1', deviceId: DEVICE })).rejects.toMatchObject({ code: 'TAP_TO_PAY_DISABLED' });
    killSwitch.providersOff.clear(); killSwitch.providersOff.add('some_other_provider');
    expect((await svc.createAttempt(ctx(), TK, { sessionId: 'S1', idempotencyKey: 'K2', deviceId: DEVICE })).status).toBe('created');
  });
});

describe('§211–§213 production refuses a mock provider', () => {
  it('lists every mock / sandbox switch in production and nothing outside it', () => {
    expect(tapToPayProductionProblems({ NODE_ENV: 'development', PAYMENTS_SANDBOX: '1', TAP_TO_PAY_MOCK: '1' } as any)).toEqual([]);
    const p = tapToPayProductionProblems({ NODE_ENV: 'production', PAYMENTS_SANDBOX: '1', PAYMENTS_ALLOW_ENV_FALLBACK: '1', TAP_TO_PAY_MOCK: 'yes', ...TTP_ENV, COMMERCEHUB_TTP_ENV: 'sandbox' } as any);
    expect(p).toHaveLength(4);
    expect(p.join('\n')).toMatch(/PAYMENTS_SANDBOX/); expect(p.join('\n')).toMatch(/TAP_TO_PAY_MOCK/); expect(p.join('\n')).toMatch(/COMMERCEHUB_TTP_ENV/);
    expect(tapToPayProductionProblems({ NODE_ENV: 'production', ...TTP_ENV, COMMERCEHUB_TTP_ENV: 'production', TAP_TO_PAY_MOCK: '0' } as any)).toEqual([]);
  });
});

describe('§46 / §152 claim takeover', () => {
  it('a second phone gets CHECKOUT_ALREADY_CLAIMED; a manager with the override may take over with a reason, but never while a tap is in flight', async () => {
    const { svc, attempts } = await world();
    const lisa = ctx({ userId: 'u_lisa', role: 'MANAGER' });
    await expect(svc.acquireLock(lisa, TK, undefined, 'S2')).rejects.toThrow();   // LockHeldElsewhereError → 409 CHECKOUT_ALREADY_CLAIMED at the controller
    const claim = await svc.claimView(lisa, TK, 'S2');
    expect(claim).toMatchObject({ source: 'mobile', ownedByCaller: false, userId: 'u_owner', deviceId: DEVICE });
    // a card attempt in flight on the owner's phone: no takeover
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'KX' });
    await attempts.updateStatus(T, 'KX', 'readiness_checking'); await attempts.updateStatus(T, 'KX', 'ready'); await attempts.updateStatus(T, 'KX', 'reader_initializing'); await attempts.updateStatus(T, 'KX', 'awaiting_customer_tap');
    await expect(svc.takeoverLock(lisa, TK, undefined, 'S2', 'owner phone died')).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    await attempts.updateStatus(T, 'KX', 'canceled');
    await expect(svc.takeoverLock(lisa, TK, undefined, 'S2', '')).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.takeoverLock(ctx({ userId: 'u_recep', role: 'FRONT_DESK', permissions: ['pos.checkout.view'] }), TK, undefined, 'S3', 'x')).rejects.toMatchObject({ code: 'forbidden' });
    const r = await svc.takeoverLock(lisa, TK, undefined, 'S2', 'owner phone died');
    expect(r.acquired).toBe(true);
    expect((await svc.claimView(lisa, TK, 'S2'))).toMatchObject({ ownedByCaller: true, userId: 'u_lisa' });
    expect((await svc.claimView(ctx(), TK, 'S1'))).toMatchObject({ ownedByCaller: false });
  });
});

describe('§132 intent expiry', () => {
  it('an unused created / ready intent expires to canceled; an in-flight one is left alone', async () => {
    const { attempts } = await world();
    const past = new Date(Date.now() - 1000).toISOString();
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'E1', expiresAt: past });
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'E2', expiresAt: past });
    await attempts.updateStatus(T, 'E2', 'readiness_checking'); await attempts.updateStatus(T, 'E2', 'ready'); await attempts.updateStatus(T, 'E2', 'reader_initializing'); await attempts.updateStatus(T, 'E2', 'awaiting_customer_tap');
    expect(await attempts.expireStale(new Date(), 100)).toBe(1);
    expect((await attempts.findByKey(T, 'E1'))!.status).toBe('canceled');
    expect((await attempts.findByKey(T, 'E2'))!.status).toBe('awaiting_customer_tap');
  });
});

describe('Secure Tap to Pay §20: a mobile claim belongs to the signed-in session', () => {
  it('the same client claim id presented by ANOTHER login cannot refresh, release, pay or record cash on it', async () => {
    const { svc } = await world();
    const mine = { ...ctx(), sessionId: 'auth-session-A' } as Ctx;
    const thief = { ...ctx(), sessionId: 'auth-session-B' } as Ctx;   // same person / same salon, another login (copied value)
    await svc.releaseLock(ctx(), TK, 'S1');
    await svc.acquireLock(mine, TK, DEVICE, 'screen-1');
    expect((await svc.lockStatus(mine, TK, 'screen-1')).ownedByCaller).toBe(true);
    expect((await svc.lockStatus(thief, TK, 'screen-1')).ownedByCaller).toBe(false);
    await expect(svc.refreshLock(thief, TK, 'screen-1')).rejects.toBeTruthy();
    expect((await svc.releaseLock(thief, TK, 'screen-1')).released).toBe(false);
    await expect(svc.createAttempt(thief, TK, { sessionId: 'screen-1', idempotencyKey: 'KX', deviceId: DEVICE })).rejects.toMatchObject({ code: 'lock_not_held' });
    await expect(svc.recordCashTender(thief, TK, { sessionId: 'screen-1', idempotencyKey: 'CX', amountCents: 100, deviceId: DEVICE })).rejects.toMatchObject({ code: 'lock_not_held' });
    await expect(svc.acquireLock(thief, TK, DEVICE, 'screen-1')).rejects.toMatchObject({ name: 'LockHeldElsewhereError' });   // CHECKOUT_ALREADY_CLAIMED at the controller
    expect((await svc.releaseLock(mine, TK, 'screen-1')).released).toBe(true);
  });
});
