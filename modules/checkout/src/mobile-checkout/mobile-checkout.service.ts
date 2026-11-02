// mobile-checkout.service.ts — the Owner & Manager Payment App backend (the mandate's "Owner/Manager Payment App → Existing
// Checkout API → Existing Payment Domain → TapToPay capability", §3). ONE checkout, ONE payment domain: every read is the
// canonical CheckoutService / repository, every tender becomes money through mobile-capture-recorder (the same
// repository the POS and the customer-display terminal use), refunds / voids / receipts / discounts / retail delegate to
// the canonical engines. This file owns the PaymentIntent lifecycle (payment_attempts, method 'tap_to_pay'), the device
// trust gate (§12–§14), the claim (§41–§47, the checkout lock), version conflicts (§55), the kill switches (§197–§199),
// unknown-result recovery (§74–§78) and the history / report projections (§103–§110). It never talks to a processor SDK:
// the TapToPaySessionPort does, and only when it is really configured (never a fabricated token or success, §211).

import type { MobileDeviceActivity } from '@aipowersalon/api-contracts/tenant';
import type { ProceedResult, MobilePaymentHistoryFilter, MobilePaymentHistoryResult, MobilePaymentHistoryRow, MobilePaymentsReport, MobilePayDeviceView, TapToPayCapabilityView, CheckoutClaimView } from '@aipowersalon/api-contracts/tenant';
export type { ProceedResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { branchTimeZone, type AppDatabase } from '@aipowersalon/database';
import type { Ctx } from '@aipowersalon/permissions';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { DOMAIN_EVENTS, createDomainEvent, type OutboxWriter } from '@aipowersalon/events';
import { CheckoutService } from '../checkout/checkout.service';
import type { CheckoutContext } from '../checkout/checkout.repository';
import type { ServingService } from '@aipowersalon/queue';
import { tapToPayConfigured, FISERV_COMMERCEHUB_TTP_CAPABILITIES } from './ttp-config';
import { tenantTapToPayConfigured, type TtpOnboardingStore, type TtpOnboardingRecord, type TtpOnboardingInput } from './ttp-onboarding';
import { computeDeviceFacts, effectiveMinAppVersion, readMobilePayMinVersion, DeviceBindingError, DeviceKeyMismatchError, MOBILE_PAY_DEVICE_STATUSES, sanitizeDeviceLabel, type MobilePayDeviceStore, type MobilePayDeviceRecord, type MobilePayDeviceStatus, type RegisterDeviceInput } from './mobile-pay-device';
import { NoopTapToPaySessionAdapter, TapToPayNotConfiguredError, TapToPayNotImplementedError, type DeviceSession, type TapToPaySessionPort, type TapToPayLookup, type TapToPayMerchantRef } from './tap-to-pay-session';
import { computeReadiness, type ReadinessFacts, type ReadinessReport, type GatewayStatus } from './mobile-checkout-readiness';
import { mapMobileQueue, type MobileQueueResult, type MobileQueueOpts } from './mobile-checkout-queue';
import { mapMobileTicketDetail, computeCheckoutVersion, type MobileTicketDetail } from './mobile-checkout-ticket';
import { CheckoutLockService, LockHeldElsewhereError, type LockResult, type LockStatus } from '../checkout-lock/checkout-lock.service';
import { isClaimStale } from '../checkout-lock/checkout-lock-core';
import type { UnsettledTender } from '../checkout/unsettled-tenders';
import { computeTip, validateSplitPlan, type TipPreset, type SplitSegmentPlan } from './mobile-tip-split';
import { summariseBalance, resolveAttemptAmount, PartialAmountError, type BalanceSummary } from './mobile-remaining-balance';
import { decideProceed } from './mobile-proceed';
import { assertTransition, isTerminal, blocksNewAttempt, BRANCH_SWITCH_BLOCKING_STATES, InvalidTransitionError, type PaymentAttemptState } from './payment-attempt-state';
import { planCapture, planReconciliation, finalStateOf, type CaptureOutcome, type ReconcileResolution } from './capture-result';
import { type MobilePaymentAttemptPort, type MobileAttemptView, MOBILE_ATTEMPT_METHOD, UNRESOLVED } from './mobile-payment-attempt.repository';
import { computeReport, type AttemptReport, type ReportPeriod } from './mobile-report';
import { type MobileCaptureRecorderPort, type RecordTenderResult } from './mobile-capture-recorder';
import { type TapToPayKillSwitchPort } from './ttp-kill-switch';
import { decideRecovery, type RecoveryDecision } from './mobile-attempt-recovery';
import { createHash, randomUUID } from 'node:crypto';
import { keyFingerprint, deviceKeyPolicy } from './device-proof';
import { newPairingCode, pairingHash, PAIRING_TTL_MS, type DevicePairingStore } from './device-pairing';
import { DeviceSecuritySignals, unusualRegistration, unusualRegistrationLimits } from './device-security-signals';
import { tenantDeviceSecuritySummary } from './payment-device-oversight';
import type { PaymentDeviceSecuritySummary } from '@aipowersalon/api-contracts';
import { NoAttestationVerifier, attestationPolicy, ATTESTATION_FORMATS, ATTESTATION_EVIDENCE_MAX, type AttestationVerifierPort, type AttestationVerdict } from './device-attestation';
import { recordPaymentEvent } from '@aipowersalon/observability';   // TTP §143–§144: the ONE payment business counter (bounded vocabulary)
import { hasPermission, isPlatformPrincipal } from '@aipowersalon/permissions';
import { ERROR_REGISTRY, withCode } from '@aipowersalon/api-contracts';
import { systemContext } from '@aipowersalon/tenant-context';

export interface MobileTicketPayment { paymentId: string; method: string; amountCents: number; tipCents: number; status: string; createdAt: string }

/** The mandate's payment surface for a Tap to Pay on iPhone capture (§66). */
export const TAP_TO_PAY_SURFACE = 'tap_to_pay_iphone' as const;
/** §132: an unused created / ready intent expires after this window. */
export const INTENT_TTL_MS = 15 * 60_000;
/** §184 default: a Tap to Pay charge at or above this needs recent strong authentication (tenant-configurable via
 *  MOBILE_PAY_STEP_UP_CENTS until a per-tenant setting exists — DECIDED, see docs/payments/OWNER_MANAGER_PAY_APP.md). */
export function stepUpThresholdCents(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MOBILE_PAY_STEP_UP_CENTS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50_000;
}
/** §149: a payment phone is "online" when it reported within this window. */
export const DEVICE_ONLINE_WINDOW_MS = 2 * 60_000;

export class AttemptError extends Error {
  constructor(readonly code: string, msg: string) { super(msg); this.name = 'AttemptError'; }
}

/** Audit sink (modules/audit AuditService.record never throws). */
export interface MobileAuditPort { record(ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, ev: { module: string; action: string; resourceType?: string | null; resourceId?: string | null; summary?: string | null; metadata?: Record<string, unknown>; reason?: string | null }): void }
/** §17: has this session stepped up recently? (apps/api StepUpGuard reads the same sessions row.) */
export interface StepUpReadPort { isFresh(sessionId: string | null | undefined, userId: string, maxAgeSeconds: number, tenantId: string): Promise<boolean> }

/** §150 Send-to-device: the ONE push client (modules/communications PushService.dispatchToUser). */
export interface MobilePushPort { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; category?: any }): Promise<unknown> }

/** §208 (Oct 21 2026): the rollout flag `mobile_tap_to_pay` — the one entitlement service's decision for this salon */
export interface FeatureFlagPort { decide(kind: string, tenantId: string, key: string): Promise<{ allowed: boolean; reason?: string; detail?: string }> }
export const MOBILE_TAP_TO_PAY_FLAG = 'mobile_tap_to_pay';
export interface MobileCheckoutExtras {
  recorder?: MobileCaptureRecorderPort;
  /** the rollout flag; absent (unit harnesses) = on */
  featureFlags?: FeatureFlagPort | null;
  push?: MobilePushPort;
  realtime?: RealtimeEmitter;
  audit?: MobileAuditPort;
  killSwitch?: TapToPayKillSwitchPort;
  outbox?: OutboxWriter | null;
  stepUp?: StepUpReadPort;
  /** Secure Tap to Pay §7: single-use POS pairing codes */
  pairing?: DevicePairingStore;
  /** Secure Tap to Pay §51: device counters + security events (absent → counters only) */
  signals?: DeviceSecuritySignals;
  /** Secure Tap to Pay §5: the attestation verifier (absent → none configured: never a pass) */
  attestation?: AttestationVerifierPort;
  now?: () => Date;
}

/** sessionId = the authenticated session; verifiedDeviceId = the device whose registered key signed THIS request (DeviceProofGuard). */
type MobileCtx = Ctx & { sessionId?: string | null; verifiedDeviceId?: string | null };

export class MobileCheckoutService {
  private readonly x: MobileCheckoutExtras;
  constructor(
    private readonly db: AppDatabase,
    private readonly gateways: PaymentGatewayResolver,
    private readonly checkout: CheckoutService,
    private readonly locks: CheckoutLockService,
    private readonly attempts: MobilePaymentAttemptPort,
    private readonly onboarding?: TtpOnboardingStore,   // per-tenant Tap to Pay onboarding state (the readiness flip)
    private readonly devices?: MobilePayDeviceStore,     // per-install device registry (deviceApproved source)
    private readonly ttpSession?: TapToPaySessionPort,   // Tap to Pay session boundary (CommerceHub adapter or Noop)
    private readonly serving?: ServingService,           // ticket composition (retail lines) — canonical serving engine
    extras: MobileCheckoutExtras = {},
  ) { this.x = extras; }

  private now(): Date { return this.x.now ? this.x.now() : new Date(); }
  private signalsFallback?: DeviceSecuritySignals;
  /** §51: the device counters / security events (the module wires the security-event recorder; a harness counts only) */
  private sig(): DeviceSecuritySignals { return this.x.signals ?? (this.signalsFallback ??= new DeviceSecuritySignals(null)); }
  private port(): TapToPaySessionPort { return this.ttpSession ?? new NoopTapToPaySessionAdapter(); }
  /** Tap to Pay per location (migration 704): the CommerceHub merchant THIS location charges through — its own MID, or the
   *  salon default; never another location's, never the platform's in production. undefined = a harness whose resolver
   *  has no Tap to Pay routing (the adapter then uses the env MID); a configured resolver answering "none" refuses with
   *  MERCHANT_NOT_CONFIGURED before anything reaches the processor. */
  private async ttpMerchant(ctx: Ctx): Promise<TapToPayMerchantRef | undefined> {
    const g = this.gateways as unknown as { resolveTapToPayMerchant?: (t: string, b?: string | null) => Promise<{ merchantId: string; terminalId: string | null } | null> };
    if (typeof g?.resolveTapToPayMerchant !== 'function') return undefined;
    const m = await g.resolveTapToPayMerchant(ctx.tenantId, ctx.branchId || null);
    if (!m) throw new AttemptError('MERCHANT_NOT_CONFIGURED', 'This location has no Tap to Pay merchant account yet. Ask the salon owner to add one in the merchant settings.');
    return { merchantId: m.merchantId, terminalId: m.terminalId };
  }
  private audit(ctx: Ctx, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}, reason?: string | null): void {
    try { this.x.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, userId: ctx.userId ?? null, role: ctx.role ?? null }, { module: 'mobile_checkout', action, resourceType: 'mobile_checkout', resourceId, metadata, reason: reason ?? null }); } catch { /* audit never breaks the operation */ }
  }
  // a screen signal (claim / verifying / device / sent-to-phone); the FACTS travel as outbox domain events (outboxEvent below)
  private emit(ctx: Ctx, event: (typeof EVENTS)[keyof typeof EVENTS], payload: Record<string, unknown>): void { try { this.x.realtime?.toTenant(ctx, event, payload); } catch { /* a signal, never the fact */ } }
  /** M6-6: ONE payment phone's own realtime room (rooms.paymentDevice) — send-to-device, its revocation. A signal only. */
  private emitToDevice(tenantId: string, deviceId: string, event: (typeof EVENTS)[keyof typeof EVENTS], payload: Record<string, unknown>): void {
    try { this.x.realtime?.toPaymentDevice?.(tenantId, deviceId, event, payload); } catch (e) { console.warn('[mobile-checkout] device room emit failed (a signal, never the fact):', (e as Error)?.message); }
  }

  /**
   * M6-6 (§16 / §38): the payment phone an authenticated stream belongs to — the device its SESSION was opened on, when that
   * is a registered, non-revoked payment device of this salon. The realtime stream subscribes it to that phone's room; the
   * id comes from the server-held session row, never from the client. Null without a registry or a session.
   */
  async deviceRoomFor(tenantId: string | null | undefined, sessionId: string | null | undefined): Promise<string | null> {
    if (!tenantId || !sessionId || !this.devices?.deviceForSession) return null;
    return this.devices.deviceForSession(tenantId, sessionId);
  }
  /** A domain event on the outbox (§175). Only with a database and a writer; never blocks the operation. */
  private async outboxEvent(ctx: Ctx, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.db || !this.x.outbox) return;
    try {
      await this.x.outbox.write(this.db as any, createDomainEvent({ eventType: eventType as any, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType, aggregateId, actorId: ctx.userId ?? undefined, actorType: ctx.userId ? 'user' : 'system', correlationId: `mobile:${aggregateId}`, payload }));
    } catch { /* the business write stands; the realtime signal still went */ }
  }

  /**
   * Secure Tap to Pay §20 / §14 (Oct 23 2026): a mobile claim belongs to the SIGNED-IN SESSION, not to a string the phone
   * made up. The app's per-screen session id is namespaced by the authenticated session id (server-held, from the cookie /
   * bearer), so the same claim id presented by another login — another employee, a copied value, a second phone — matches
   * nothing: it cannot refresh, release, charge or record cash on someone else's claim. Without an auth session (unit
   * harnesses) the client id is used as is.
   */
  private claimId(ctx: Ctx, clientSessionId: string | undefined | null): string {
    const raw = String(clientSessionId ?? '');
    const auth = (ctx as MobileCtx).sessionId;
    if (!auth || !raw) return raw;
    return 'm:' + createHash('sha256').update(`${auth}|${raw}`).digest('hex').slice(0, 40);
  }

  // ── Readiness / capability (§27–§29, §197–§199) ───────────────────────────────────────────────────────────────────
  async getReadiness(ctx: Ctx, deviceId?: string): Promise<ReadinessReport> {
    // §31–§32: tenant + branch from the TRUSTED session resolve the merchant (a branch's own merchant account when it has one)
    const gateway = await Promise.resolve().then(() => this.gateways.resolve(ctx.tenantId, ctx.branchId || null)).catch(() => null);
    // The Tap to Pay flip: configured ONLY when the CommerceHub credentials are present AND this tenant is recorded
    // as onboarded (Apple entitlement approved + CommerceHub active). Fail-closed — no record ⇒ still setup_required.
    const onboardingRec = this.onboarding ? await this.onboarding.get(ctx.tenantId).catch(() => null) : null;
    // Device approval comes from the real registry (§12–§14): approved iff this device is registered 'active' for this
    // tenant/branch AND bound to this user. No device id / no record ⇒ not approved (blocks) — never a hardcoded pass.
    const deviceRec = (this.devices && deviceId) ? await this.devices.get(ctx.tenantId, deviceId).catch(() => null) : null;
    const minAppVersion = deviceRec ? effectiveMinAppVersion(await readMobilePayMinVersion(this.db, deviceRec.platform)) : null;
    const dev = computeDeviceFacts(deviceRec, { requiredBranchId: ctx.branchId || null, minAppVersion, requiredUserId: ctx.userId || null });
    const killed = await this.tapToPayDisabledReason(ctx.tenantId);
    const facts: ReadinessFacts = {
      backendUp: true,                              // we are responding
      posSyncUp: !!this.db,                         // canonical checkout store is reachable
      gatewayStatus: ((gateway?.status as GatewayStatus) ?? 'not_configured'),
      gatewayConfigured: !!gateway?.configured,
      tapToPayConfigured: tenantTapToPayConfigured(tapToPayConfigured(), onboardingRec), // creds AND recorded onboarding
      tapToPayDisabledReason: killed,
      smsReceiptConfigured: process.env.RECEIPTS_SMS_ENABLED === '1',
      emailReceiptConfigured: process.env.RECEIPTS_EMAIL_ENABLED === '1',
      appVersionOk: dev.appVersionOk,               // from the registered device's reported app version vs the minimum
      deviceApproved: dev.deviceApproved,           // registered + 'active' for this tenant/branch + bound to this user
      deviceSupported: dev.deviceSupported,         // the device reported Tap to Pay capability
      deviceBlockReason: dev.blockReason,
    };
    return computeReadiness(facts, this.now());
  }

  /** §19/§28: what the app may show for Tap to Pay — values from the real integration and the real readiness. */
  async getCapability(ctx: Ctx, deviceId?: string): Promise<TapToPayCapabilityView> {
    const r = await this.getReadiness(ctx, deviceId);
    const check = (k: string) => r.checks.find((c) => c.key === k);
    const ttp = check('tap_to_pay'); const dev = check('device'); const ver = check('app_version');
    const caps = FISERV_COMMERCEHUB_TTP_CAPABILITIES;
    const base = { provider: this.port().provider === 'none' ? caps.provider : this.port().provider, environment: (process.env.COMMERCEHUB_TTP_ENV === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production', capabilities: { tapToPay: caps.tapToPay, cardPresentTerminal: caps.cardPresentTerminal, refunds: caps.refunds, voids: caps.voids, partialRefunds: caps.partialRefunds, splitPayments: caps.splitPayments, tokenization: caps.tokenization, offlinePayments: caps.offlinePayments, statusLookup: caps.statusLookup } };
    if (ttp?.state === 'unavailable') return { ...base, state: 'disabled', reason: ttp.detail };
    if (dev?.state === 'unavailable') return { ...base, state: 'unavailable', reason: dev.detail };
    if (ver?.state === 'unavailable') return { ...base, state: 'unavailable', reason: ver.detail };
    if (r.canTakePayment) return { ...base, state: 'ready' };
    const first = r.checks.find((c) => c.critical && c.state !== 'ok');
    return { ...base, state: 'setup_required', reason: first?.detail ?? first?.label };
  }

  /** The device gate for a money operation (§14, §138, §163): active, bound to this user, this branch; else the §190 code. */
  private async assertDeviceTrusted(ctx: Ctx, deviceId: string | null | undefined): Promise<MobilePayDeviceRecord | null> {
    if (!this.devices) return null;
    if (!deviceId) throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'This phone is not registered to take payments.');   // no device id at all: not a payment phone
    const rec = await this.devices.get(ctx.tenantId, deviceId).catch(() => null);
    const facts = computeDeviceFacts(rec, { requiredBranchId: ctx.branchId || null, requiredUserId: ctx.userId || null });
    if (!facts.deviceApproved) {
      await this.devices.touchError?.(ctx.tenantId, deviceId, facts.blockReason ?? 'DEVICE_NOT_AUTHORIZED').catch(() => undefined);
      const code = facts.blockReason ?? 'DEVICE_NOT_AUTHORIZED';
      if (code === 'DEVICE_REVOKED') this.sig().signal('revoked_device_attempt', { tenantId: ctx.tenantId, deviceId, userId: ctx.userId });   // §51
      throw new AttemptError(code, ERROR_REGISTRY[code as keyof typeof ERROR_REGISTRY]?.message ?? 'This phone is not authorized to take payments for this salon.');
    }
    this.assertDeviceProof(ctx, rec!);
    return rec;
  }

  /**
   * Secure Tap to Pay §4 / §71: a phone with a registered key must have SIGNED this request with it (DeviceProofGuard
   * verified the signature and stamped the device on the request). A valid user token from another phone — or with no
   * signature — is refused for every sensitive operation. Under the 'required' policy (production default) a phone that
   * never registered a key cannot take money at all.
   */
  private assertDeviceProof(ctx: Ctx, rec: MobilePayDeviceRecord): void {
    const verified = (ctx as MobileCtx).verifiedDeviceId ?? null;
    if (rec.publicKey) {
      if (verified !== rec.deviceId) { this.sig().signal('key_mismatch', { tenantId: ctx.tenantId, deviceId: rec.deviceId, userId: ctx.userId, detail: 'money request without the phone\'s signature' }); throw new AttemptError('DEVICE_KEY_MISMATCH', ERROR_REGISTRY.DEVICE_KEY_MISMATCH.message); }
      return;
    }
    if (deviceKeyPolicy() === 'required') throw new AttemptError('DEVICE_KEY_REQUIRED', ERROR_REGISTRY.DEVICE_KEY_REQUIRED.message);
  }
  /**
   * M6-5 (live pilot): a result or a cancel for an intent belongs to the phone that made it. When that phone has a
   * registered key, the request must be signed by it (DeviceProofGuard verified it) — before this a valid session alone,
   * with no device proof, could post "declined" for (or cancel) the phone's ready intent. A device that cannot be read
   * fails closed; an intent from a key-less (legacy) phone keeps the session rules.
   */
  private async assertAttemptDeviceProof(ctx: Ctx, attempt: MobileAttemptView): Promise<void> {
    if (!this.devices || !attempt.deviceId) return;
    const rec = await this.devices.get(ctx.tenantId, attempt.deviceId);
    if (rec?.publicKey && (ctx as MobileCtx).verifiedDeviceId !== rec.deviceId) {
      this.sig().signal('key_mismatch', { tenantId: ctx.tenantId, deviceId: rec.deviceId, userId: ctx.userId, detail: 'a result / cancel for the phone\'s intent without its signature' });
      throw new AttemptError('DEVICE_KEY_MISMATCH', ERROR_REGISTRY.DEVICE_KEY_MISMATCH.message);
    }
  }
  /** §41: a money-out operation from the Payment App — when the request was signed by a payment device, that device must be
   *  trusted (active, this user, this branch); under the 'required' key policy an unsigned phone request is refused. */
  private async assertSigningDeviceTrusted(ctx: Ctx): Promise<void> {
    const signed = (ctx as MobileCtx).verifiedDeviceId;
    if (signed) { await this.assertDeviceTrusted(ctx, signed); return; }
    if (this.devices && deviceKeyPolicy() === 'required') throw new AttemptError('DEVICE_KEY_REQUIRED', ERROR_REGISTRY.DEVICE_KEY_REQUIRED.message);
  }

  /** the kill switch's answer, else the rollout flag's (§208) — null when Tap to Pay may run for this salon */
  private async tapToPayDisabledReason(tenantId: string): Promise<'platform' | 'provider' | 'rollout' | null> {
    // a kill switch that cannot be read fails CLOSED like the rollout flag below (Oct 28 2026 mandate audit — it answered null = on)
    const killed = this.x.killSwitch ? await this.x.killSwitch.disabledReason(this.port().provider).catch(() => 'platform' as const) : null;
    if (killed) return killed;
    if (!this.x.featureFlags) return null;
    // a rollout gate that cannot be read fails CLOSED (check:silent-catch): the flag is a safety valve, so "unknown" is "held"
    const d = await this.x.featureFlags.decide('plan_feature', tenantId, MOBILE_TAP_TO_PAY_FLAG).catch((e: any) => ({ allowed: false, reason: 'FLAG_READ_FAILED', detail: String(e?.message ?? e).slice(0, 200) }));
    return !d.allowed && ['NOT_IN_ROLLOUT', 'FLAG_KILLED', 'FEATURE_DISABLED', 'EMERGENCY_DISABLED', 'KILL_SWITCH_ACTIVE', 'FEATURE_DEPRECATED', 'FLAG_READ_FAILED'].includes(String(d.reason)) ? 'rollout' : null;
  }
  private async assertTapToPayOn(tenantId?: string): Promise<void> {
    const killed = tenantId ? await this.tapToPayDisabledReason(tenantId) : (this.x.killSwitch ? await this.x.killSwitch.disabledReason(this.port().provider).catch(() => 'platform' as const) : null);
    if (killed === 'rollout') throw new AttemptError('TAP_TO_PAY_DISABLED', 'Tap to Pay is not enabled for this salon yet (platform rollout). Use the terminal, cash or another payment option.');
    if (killed) throw new AttemptError('TAP_TO_PAY_DISABLED', killed === 'platform' ? 'Tap to Pay is currently switched off by the platform. Use the terminal, cash or another payment option.' : 'Tap to Pay through this provider is currently switched off. Use the terminal, cash or another payment option.');
  }

  // ── Device registry (§12–§14, §123, §138–§141, §145) ──────────────────────────────────────────────────────────────
  /** The Manager Pay app registers its stable per-install device id on sign-in. Always lands 'pending' — an owner/Super
   *  Admin must approve before it can take payment; the install is BOUND to this user. Returns the record. */
  async registerDevice(ctx: Ctx, input: Omit<RegisterDeviceInput, 'registeredBy' | 'keyFingerprint' | 'pairing'> & { pairingCode?: string | null }): Promise<MobilePayDeviceRecord> {
    if (!this.devices) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!input.deviceId) throw new AttemptError('invalid', 'A deviceId is required.');
    // Secure Tap to Pay §4: a key is registered only with PROOF of possession — the registration request itself was signed
    // by that key (DeviceProofGuard verified it with the key in the body and stamped this device on the request)
    let fingerprint: string | null = null;
    if (input.publicKey) {
      try { fingerprint = keyFingerprint(input.publicKey); }
      catch { throw new AttemptError('invalid', 'The payment device key must be an ECDSA P-256 public key (SPKI, base64).'); }
      if ((ctx as MobileCtx).verifiedDeviceId !== input.deviceId) throw new AttemptError('DEVICE_KEY_MISMATCH', 'Sign the registration with the device key you are registering.');
    }
    // §7: a single-use POS pairing code pre-approves a NEW phone for the pairing's branch (the employee is signed in there)
    let pairing: RegisterDeviceInput['pairing'] = null;
    if (input.pairingCode) {
      if (!input.publicKey) throw new AttemptError('DEVICE_KEY_REQUIRED', 'Pairing needs the phone\'s secure payment key.');
      if (!this.x.pairing) throw withCode(new AttemptError('unavailable', 'Device pairing is not available.'), 'FEATURE_NOT_AVAILABLE');
      if (!hasPermission(ctx, 'mobile_checkout.tap_to_pay')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Your account is not allowed to take card payments on a phone.');
      const existing = await this.devices.get(ctx.tenantId, input.deviceId);
      if (existing) throw new AttemptError('PAIRING_CODE_INVALID', 'This phone is already registered — pairing is for a new phone.');
      const pr = await this.x.pairing.consume(ctx.tenantId, pairingHash(input.pairingCode), { userId: ctx.userId, deviceId: input.deviceId }, this.now());
      if (!pr || (ctx.branchId && pr.branchId !== ctx.branchId)) {
        this.audit(ctx, 'payment_device_pairing_refused', input.deviceId, { reason: pr ? 'branch' : 'invalid_or_used' });
        throw new AttemptError('PAIRING_CODE_INVALID', ERROR_REGISTRY.PAIRING_CODE_INVALID.message);
      }
      pairing = { branchId: pr.branchId, approvedBy: pr.createdBy, shared: pr.shared };
    }
    // Developer merge (Oct 6 2026): an EMPTY branch / user id ('' from a session without a branch, a kiosk principal)
    // reached the UUID columns as '' and the insert failed — '' is "none", so it falls through to the session's branch / null.
    let rec: MobilePayDeviceRecord;
    const { pairingCode: _pc, ...reg } = input; void _pc;
    const prior = pairing ? null : await this.devices.get(ctx.tenantId, input.deviceId).catch(() => null);   // §51: a NEW registration is counted once
    try { rec = await this.devices.upsertOnRegister(ctx.tenantId, { ...reg, branchId: reg.branchId || ctx.branchId || null, registeredBy: ctx.userId || null, keyFingerprint: fingerprint, pairing }); }
    catch (e) {
      if (e instanceof DeviceKeyMismatchError) this.sig().signal('key_mismatch', { tenantId: ctx.tenantId, deviceId: input.deviceId, userId: ctx.userId, detail: 'registration with a key that belongs to another device / a different key' });
      if (e instanceof DeviceBindingError || e instanceof DeviceKeyMismatchError) throw new AttemptError(e.code, e.message);
      throw e;
    }
    if (!prior) { this.sig().count('registered'); await this.checkUnusualRegistration(ctx, rec.deviceId); }
    this.sig().appVersion(rec.appVersion);
    this.audit(ctx, 'mobile_pay_device_registered', rec.deviceId, { status: rec.status, platform: rec.platform, appVersion: rec.appVersion, tapToPayCapable: rec.tapToPayCapable, keyFingerprint: rec.keyFingerprint ? rec.keyFingerprint.slice(0, 16) : null, pairedVia: rec.pairedVia ?? null });
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId: rec.deviceId, status: rec.status });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REGISTERED, 'mobile_pay_device', rec.deviceId, { deviceId: rec.deviceId, status: rec.status, platform: rec.platform });
    return rec;
  }

  /** §51 (Oct 27): after a NEW registration, the "unusual registration" rule (device-security-signals.ts). Never blocks or
   *  throws — the phone is 'pending' until the owner approves it whatever this says. */
  private async checkUnusualRegistration(ctx: Ctx, deviceId: string): Promise<void> {
    try {
      const c = await this.devices?.registrationCounts?.(ctx.tenantId, ctx.userId || null);
      if (!c) return;
      const why = unusualRegistration(c, unusualRegistrationLimits());
      if (why) this.sig().signal('unusual_registration', { tenantId: ctx.tenantId, deviceId: null, userId: ctx.userId || null, detail: `${why}; latest phone ${String(deviceId).slice(0, 12)}` });
    } catch (e) { console.warn('[mobile-checkout] unusual-registration check failed (the registration stands):', (e as Error)?.message); }
  }

  /** §51 (Oct 27): the owner's device-security panel — counts for THIS salon only (pos.devices.manage). */
  async deviceSecuritySummary(ctx: Ctx, windowDays?: number): Promise<PaymentDeviceSecuritySummary> {
    if (!hasPermission(ctx, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can see payment-device security counts.');
    return tenantDeviceSecuritySummary(this.db as never, ctx.tenantId, windowDays);
  }

  /** List a tenant's registered Tap to Pay devices (Super Admin oversight). */
  async listDevices(tenantId: string): Promise<MobilePayDeviceRecord[]> {
    if (!this.devices) return [];
    return this.devices.list(tenantId);
  }

  /** Approve or revoke a device. SUPER_ADMIN only (platform operator); explicit target tenant since SA is tenant-less. */
  async setDeviceStatus(ctx: Ctx, tenantId: string, deviceId: string, status: MobilePayDeviceStatus, reason?: string | null): Promise<MobilePayDeviceRecord> {
    if (!isPlatformPrincipal(ctx)) throw withCode(new AttemptError('forbidden', 'Only a platform Super Admin can approve or revoke a payment device.'), 'PLATFORM_ONLY_ACTION');
    if (!this.devices) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!MOBILE_PAY_DEVICE_STATUSES.includes(status)) throw new AttemptError('invalid', 'Unknown device status.');
    const rec = await this.devices.setStatus(tenantId, deviceId, status, ctx.userId, reason ?? null);
    if (!rec) throw withCode(new AttemptError('not_found', 'That device is not registered for this tenant.'), 'DEVICE_NOT_REGISTERED');
    if (status === 'revoked' || status === 'compromised') await this.devices.revokeDeviceSessions?.(tenantId, deviceId);   // §16: real at the backend
    this.countStatus(status);
    const scope = { tenantId, branchId: rec.branchId ?? '', userId: ctx.userId, role: ctx.role, permissions: [] } as Ctx;
    this.audit(scope, status === 'active' ? 'mobile_pay_device_activated' : 'mobile_pay_device_revoked', deviceId, { status, by: 'super_admin' }, reason);
    this.emit(scope, EVENTS.mobilePayDeviceUpdated, { deviceId, status });
    this.emitToDevice(tenantId, deviceId, EVENTS.mobilePayDeviceUpdated, { deviceId, status });   // §16 best effort: the phone itself
    if (status !== 'active' && status !== 'pending') await this.outboxEvent(scope, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REVOKED, 'mobile_pay_device', deviceId, { deviceId, status, reason: reason ?? null });
    return rec;
  }

  /** The signed-in salon's own registered Tap to Pay devices (any pay user in the tenant) — the §145 health view. */
  async listMyDevices(ctx: Ctx): Promise<MobilePayDeviceView[]> {
    if (!this.devices) return [];
    const rows = await this.devices.list(ctx.tenantId);
    const names = await this.userNames(ctx.tenantId, rows.map((r) => r.boundUserId).filter(Boolean) as string[]);
    const t = this.now().getTime();
    return rows.map((r) => ({
      deviceId: r.deviceId, label: r.label ?? null, branchId: r.branchId ?? null, platform: r.platform, osVersion: r.osVersion ?? null, appVersion: r.appVersion ?? null,
      tapToPayCapable: r.tapToPayCapable, status: r.status, boundUserId: r.boundUserId ?? null, boundUserName: r.boundUserId ? names.get(r.boundUserId) ?? null : null,
      approvedAt: r.approvedAt ?? null, lastSeenAt: r.lastSeenAt ?? null, lastPaymentAt: r.lastPaymentAt ?? null, lastErrorAt: r.lastErrorAt ?? null, lastErrorCode: r.lastErrorCode ?? null,
      revokedAt: r.revokedAt ?? null, revokeReason: r.revokeReason ?? null,
      online: !!r.lastSeenAt && t - Date.parse(r.lastSeenAt) <= DEVICE_ONLINE_WINDOW_MS && r.status === 'active',
      // Payment Terminals mandate (Oct 29 2026): the contract's location / sharing / pairing facts — the panel read them and
      // always saw [] / false because this view dropped them
      allowedBranchIds: r.allowedBranchIds ?? [], shared: !!r.shared, pairedVia: r.pairedVia ?? null, attestationStatus: r.attestationStatus ?? null,
    }));
  }

  /**
   * Owner self-service: approve / revoke / disable / re-enable a device in the OWNER's OWN salon. Scoped hard to
   * ctx.tenantId — an owner can never touch another salon's devices. A trust decision reserved to pos.devices.manage
   * (managers/cashiers may take payment but not authorize new payment hardware). A revoked phone loses payment
   * authority immediately: readiness, proceed, intent, mint and capture all re-read the registry (§138–§139).
   */
  async setMyDeviceStatus(ctx: Ctx, deviceId: string, status: MobilePayDeviceStatus, reason?: string | null): Promise<MobilePayDeviceRecord> {
    // BUILD_PLAN Phase 9 (Kevin's open decision 4, default kept: payment-device approval stays with the OWNER): decided
    // by pos.devices.manage (→ settings.edit, which only the OWNER holds by default) instead of the role's name.
    if (!hasPermission(ctx as any, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can approve or revoke a payment device.');
    if (!this.devices) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!MOBILE_PAY_DEVICE_STATUSES.includes(status)) throw new AttemptError('invalid', 'Unknown device status.');
    const before = await this.devices.get(ctx.tenantId, deviceId);
    if (!before) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    const rec = await this.devices.setStatus(ctx.tenantId, deviceId, status, ctx.userId, reason ?? null);
    if (!rec) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    if (rec.status !== status) throw withCode(new AttemptError('invalid_state', `A ${before.status} payment device cannot become ${status}.${before.status === 'revoked' ? ' A revoked phone registers again as a new device.' : ''}`), 'DEVICE_STATUS_CHANGE_INVALID');
    // §16 / §17: revocation is real at the backend — every sign-in opened on this phone ends now (its refresh family too);
    // the next request from it fails even with realtime down. An in-flight provider transaction is NOT erased: the
    // attempt stays and the recovery worker / Verify reconciles it with the provider.
    const sessions = (status === 'revoked' || status === 'compromised') ? (await this.devices.revokeDeviceSessions?.(ctx.tenantId, deviceId)) ?? 0 : 0;
    // §16 (Oct 28 2026 audit): the phone's checkout claims are released now, not left to lapse on the 90-second TTL — except a
    // ticket with a charge still in flight on this phone (that claim stays until Verify / recovery resolves the charge)
    const claimsReleased = (status === 'revoked' || status === 'compromised') ? await this.releaseRevokedDeviceClaims(ctx.tenantId, rec.branchId ?? before.branchId ?? null, deviceId) : 0;
    this.countStatus(status);
    this.audit(ctx, status === 'active' ? 'mobile_pay_device_activated' : status === 'disabled' ? 'mobile_pay_device_suspended' : 'mobile_pay_device_revoked', deviceId, { status, from: before.status, sessionsRevoked: sessions, claimsReleased }, reason);
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status });
    this.emitToDevice(ctx.tenantId, deviceId, EVENTS.mobilePayDeviceUpdated, { deviceId, status });   // §16 best effort: the phone itself
    if (status !== 'active' && status !== 'pending') await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REVOKED, 'mobile_pay_device', deviceId, { deviceId, status, reason: reason ?? null });
    return rec;
  }

  /** §16: release a revoked phone's live mobile claims in its location, keeping any whose ticket has an attempt still in flight
   *  on this phone. Best effort — the revocation itself already stands; a failure is logged and the TTL still ends the claim. */
  private async releaseRevokedDeviceClaims(tenantId: string, branchId: string | null, deviceId: string): Promise<number> {
    if (!branchId) return 0;
    try {
      const now = this.now();
      const claims = await this.locks.heldBy(tenantId, { branchId, source: 'mobile', deviceId }, now);
      if (!claims.length) return 0;
      const inFlight = new Set((this.attempts.listForDeviceInStates ? await this.attempts.listForDeviceInStates(tenantId, branchId, deviceId, BRANCH_SWITCH_BLOCKING_STATES) : [])
        .filter((a) => a.status !== 'created' || !a.expiresAt || Date.parse(a.expiresAt) > now.getTime()).map((a) => a.ticketId));
      let n = 0;
      for (const c of claims) {
        if (c.ownerDeviceId !== deviceId || inFlight.has(c.ticketId)) continue;
        await this.locks.forceRelease(tenantId, c.ticketId, 'device_revoked'); n++;
      }
      return n;
    } catch (e) { console.warn('[mobile-checkout] releasing a revoked phone\'s claims failed (they lapse on the TTL):', (e as Error)?.message); return 0; }
  }

  /** §51: a lifecycle move, counted (pending is not an event of its own). */
  private countStatus(status: MobilePayDeviceStatus): void {
    const ev = status === 'active' ? 'approved' : status === 'disabled' ? 'suspended' : status === 'revoked' ? 'revoked' : status === 'compromised' ? 'compromised' : null;
    if (ev) this.sig().count(ev);
  }

  /**
   * Secure Tap to Pay §15 / §62 (M6-6): the owner's device dashboard for ONE phone of this salon — the sign-ins opened on it
   * (who, when, still live / ended / expired) and its audit history (registration, approvals, branch changes, claims,
   * payments, refusals — the phone's own events and what was done in a session opened on it). Owner-only (pos.devices.manage);
   * another salon's phone is not_found (no metadata leakage, §59). Never a token, a key or a full session id.
   */
  async deviceActivity(ctx: Ctx, deviceId: string): Promise<MobileDeviceActivity> {
    if (!hasPermission(ctx, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can see a payment device\'s sign-ins and history.');
    if (!this.devices?.activity) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    const dev = await this.devices.get(ctx.tenantId, deviceId);
    if (!dev) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    const rows = await this.devices.activity(ctx.tenantId, deviceId);
    const names = await this.userNames(ctx.tenantId, rows.sessions.map((r) => r.userId));
    const t = this.now().getTime();
    return {
      deviceId, label: dev.label ?? null, status: dev.status, shared: !!dev.shared,
      sessions: rows.sessions.map((r) => ({
        ref: r.id.slice(0, 8), userId: r.userId, userName: names.get(r.userId) ?? null, branchId: r.branchId,
        signedInAt: r.createdAt, lastActiveAt: r.lastActiveAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt,
        state: r.revokedAt || r.status === 'revoked' ? 'revoked' as const : Date.parse(r.expiresAt) <= t ? 'expired' as const : 'active' as const,
      })),
      audit: rows.audit.map((r) => ({ at: r.at, action: r.action, actorUserId: r.actorUserId, actorName: r.actorName, summary: r.summary, reason: r.reason,
        ticketId: r.ticketId ?? (r.resourceType === 'ticket' || (r.resourceType === 'mobile_checkout' && r.resourceId !== deviceId) ? r.resourceId : null), status: r.status })),
    };
  }

  /**
   * Secure Tap to Pay §7: the POS creates a short-lived, single-use pairing code for a NEW phone in the caller's branch
   * (pos.devices.manage + a fresh step-up at the controller). The code is shown once (as a QR); only its hash is kept.
   */
  async createDevicePairing(ctx: Ctx, opts: { label?: string | null; shared?: boolean } = {}): Promise<{ pairingCode: string; qrPayload: string; expiresAt: string; branchId: string; shared: boolean }> {
    if (!hasPermission(ctx, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can add a payment device.');
    if (!this.x.pairing) throw withCode(new AttemptError('unavailable', 'Device pairing is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!ctx.branchId) throw withCode(new AttemptError('invalid', 'Open a location first — a pairing code is for one location.'), 'BRANCH_REQUIRED');
    const code = newPairingCode();
    const rec = await this.x.pairing.create({ tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId, label: opts.label ? String(opts.label).slice(0, 80) : null, codeHash: pairingHash(code), expiresAt: new Date(this.now().getTime() + PAIRING_TTL_MS), shared: !!opts.shared });
    this.audit(ctx, 'payment_device_pairing_created', rec.id, { branchId: rec.branchId, expiresAt: rec.expiresAt, label: rec.label, shared: rec.shared });
    return { pairingCode: code, qrPayload: `aipowersalon-pay://pair?code=${code}`, expiresAt: rec.expiresAt, branchId: rec.branchId, shared: rec.shared };
  }

  /** Secure Tap to Pay §9 / §15: the owner sets the branches a phone may take payments in (step-up at the controller). */
  async setDeviceBranches(ctx: Ctx, deviceId: string, branchIds: string[]): Promise<MobilePayDeviceRecord> {
    if (!hasPermission(ctx, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can change where a payment device works.');
    if (!this.devices?.setAllowedBranches) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    const ids = [...new Set((branchIds ?? []).map(String).filter(Boolean))].slice(0, 100);
    const before = await this.devices.get(ctx.tenantId, deviceId);
    if (!before) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    let rec: MobilePayDeviceRecord | null;
    try { rec = await this.devices.setAllowedBranches(ctx.tenantId, deviceId, ids, ctx.userId); }
    catch { throw new AttemptError('BRANCH_NOT_FOUND', 'One of those locations does not belong to this salon.'); }   // FK / tenant-consistency trigger
    this.audit(ctx, 'mobile_pay_device_branches_changed', deviceId, { before: before.allowedBranchIds ?? [], after: rec?.allowedBranchIds ?? ids });
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status: rec?.status ?? before.status });
    return rec!;
  }

  /**
   * Secure Tap to Pay §15: the owner renames a phone (pos.devices.manage + a fresh step-up at the controller). The name is
   * cleaned (control / bidi / zero-width characters removed, whitespace collapsed, ≤ 80 characters); an empty name is
   * refused. A revoked or compromised phone keeps its name (its history must read the same). Audited with before / after.
   */
  async renameDevice(ctx: Ctx, deviceId: string, rawLabel: unknown): Promise<MobilePayDeviceRecord> {
    if (!hasPermission(ctx, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can rename a payment device.');
    if (!this.devices?.rename) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    const label = sanitizeDeviceLabel(rawLabel);
    if (!label) throw withCode(new AttemptError('invalid', 'Enter a name for this phone.'), 'DEVICE_NAME_REQUIRED');
    const before = await this.devices.get(ctx.tenantId, deviceId);
    if (!before) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    if (before.status === 'revoked' || before.status === 'compromised') throw withCode(new AttemptError('invalid_state', 'A revoked phone keeps its name. A replacement phone registers as a new device.'), 'DEVICE_REVOKED_RENAME');
    const beforeLabel = before.label ?? null;
    const rec = await this.devices.rename(ctx.tenantId, deviceId, label, ctx.userId);
    if (!rec) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    if (beforeLabel !== label) {
      this.audit(ctx, 'mobile_pay_device_renamed', deviceId, { before: beforeLabel, after: label });
      this.sig().count('renamed');
      this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status: rec.status });
    }
    return rec;
  }

  /**
   * Secure Tap to Pay §5: the phone sends its attestation evidence, SIGNED by its registered payment key (DeviceProofGuard
   * verified it — a session alone, or another phone, cannot attest for it). The verifier's verdict is stored (attestation_status)
   * and audited; 'unverifiable' stores nothing. A 'failed' verdict raises a security event, and under the 'enforce' policy
   * marks the phone compromised and ends its sessions. See device-attestation.ts.
   */
  async attestDevice(ctx: Ctx, deviceId: string, input: { format?: unknown; evidence?: unknown; keyId?: unknown }): Promise<{ deviceId: string; verdict: AttestationVerdict; attestationStatus: 'none' | 'passed' | 'failed'; deviceStatus: MobilePayDeviceStatus; policy: 'off' | 'enforce'; reason: string | null }> {
    if (!this.devices?.setAttestation) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!deviceId) throw new AttemptError('invalid', 'A deviceId is required.');
    const format = String(input?.format ?? ''); const evidence = typeof input?.evidence === 'string' ? input.evidence : '';
    if (!(ATTESTATION_FORMATS as readonly string[]).includes(format)) throw new AttemptError('invalid', `Unknown attestation format. Use one of: ${ATTESTATION_FORMATS.join(', ')}.`);
    if (!evidence || evidence.length > ATTESTATION_EVIDENCE_MAX) throw new AttemptError('invalid', 'The attestation evidence is missing or too large.');
    const rec = await this.devices.get(ctx.tenantId, deviceId);
    if (!rec) throw new AttemptError('DEVICE_NOT_REGISTERED', ERROR_REGISTRY.DEVICE_NOT_REGISTERED.message);
    // only the phone that holds the registered key attests for itself
    if (!rec.publicKey || (ctx as MobileCtx).verifiedDeviceId !== rec.deviceId) {
      this.sig().signal('key_mismatch', { tenantId: ctx.tenantId, deviceId, userId: ctx.userId, detail: 'attestation not signed by the phone\'s registered key' });
      throw new AttemptError('DEVICE_KEY_MISMATCH', ERROR_REGISTRY.DEVICE_KEY_MISMATCH.message);
    }
    const verifier = this.x.attestation ?? new NoAttestationVerifier();
    const v = await verifier.verify({ tenantId: ctx.tenantId, deviceId, keyFingerprint: rec.keyFingerprint ?? null, format, evidence, keyId: typeof input?.keyId === 'string' ? input.keyId.slice(0, 200) : null })
      .catch((e: unknown) => ({ verdict: 'unverifiable' as const, reason: `VERIFIER_ERROR: ${String((e as Error)?.message ?? e).slice(0, 120)}` }));
    const policy = attestationPolicy();
    let stored = rec.attestationStatus ?? 'none'; let deviceStatus = rec.status;
    if (v.verdict === 'passed' || v.verdict === 'failed') stored = (await this.devices.setAttestation(ctx.tenantId, deviceId, v.verdict))?.attestationStatus ?? v.verdict;
    if (v.verdict !== 'failed') this.sig().count(v.verdict === 'passed' ? 'attestation_passed' : 'attestation_unverifiable');   // 'failed' is counted by its signal below
    this.audit(ctx, 'mobile_pay_device_attested', deviceId, { verdict: v.verdict, provider: verifier.provider, format, policy, reason: v.reason ?? null });
    if (v.verdict === 'failed') {
      this.sig().signal('attestation_failed', { tenantId: ctx.tenantId, deviceId, userId: ctx.userId, detail: `${verifier.provider}${v.reason ? `: ${v.reason}` : ''}; policy ${policy}` });
      if (policy === 'enforce' && rec.status !== 'revoked' && rec.status !== 'compromised') {
        const moved = await this.devices.setStatus(ctx.tenantId, deviceId, 'compromised', null, 'attestation failed (TTP_ATTESTATION_POLICY=enforce)');
        if (moved?.status === 'compromised') {
          deviceStatus = 'compromised';
          const sessions = (await this.devices.revokeDeviceSessions?.(ctx.tenantId, deviceId)) ?? 0;
          this.countStatus('compromised');
          this.audit(ctx, 'mobile_pay_device_revoked', deviceId, { status: 'compromised', from: rec.status, sessionsRevoked: sessions, by: 'attestation_policy' }, 'attestation failed');
          this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status: 'compromised' });
          this.emitToDevice(ctx.tenantId, deviceId, EVENTS.mobilePayDeviceUpdated, { deviceId, status: 'compromised' });
          await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REVOKED, 'mobile_pay_device', deviceId, { deviceId, status: 'compromised', reason: 'attestation failed' });
        }
      }
    }
    return { deviceId, verdict: v.verdict, attestationStatus: stored, deviceStatus, policy, reason: v.reason ?? null };
  }

  /** §17 (step-up at the controller) + §14: reassign a phone to another user of this salon — back to 'pending'. */
  async rebindMyDevice(ctx: Ctx, deviceId: string, userId: string): Promise<MobilePayDeviceRecord> {
    if (!hasPermission(ctx as any, 'pos.devices.manage')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Only the salon owner can reassign a payment device.');
    if (!this.devices?.rebind) throw withCode(new AttemptError('unavailable', 'Device registry is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!userId) throw new AttemptError('invalid', 'A userId is required.');
    const rec = await this.devices.rebind(ctx.tenantId, deviceId, userId, ctx.userId);
    if (!rec) throw withCode(new AttemptError('not_found', 'That device is not registered for this salon.'), 'DEVICE_NOT_REGISTERED');
    this.audit(ctx, 'mobile_pay_device_reassigned', deviceId, { userId });
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status: rec.status });
    return rec;
  }

  /** §140 user termination / lost phone from another device: every phone bound to the user loses payment authority. */
  async revokeDevicesForUser(scope: { tenantId: string; branchId?: string | null; actorId?: string | null }, userId: string, reason: string): Promise<number> {
    if (!this.devices) return 0;
    const n = await this.devices.revokeForUser(scope.tenantId, userId, reason);
    if (n > 0) {
      // §72 systemContext; the acting person (when one revoked it) stays the audit actor — a UUID or nothing
      const ctx = { ...systemContext({ tenantId: scope.tenantId, branchId: scope.branchId, actor: 'mobile-pay-device-revocation' }), userId: scope.actorId ?? undefined } as unknown as Ctx;
      this.audit(ctx, 'mobile_pay_devices_revoked_for_user', userId, { count: n }, reason);
      this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { userId, status: 'revoked', count: n });
      await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REVOKED, 'user', userId, { userId, count: n, reason });
    }
    return n;
  }

  /** §149: the registered phone reports it is alive (last_seen) — the POS "Mobile Payments ● Online" card reads it. */
  async heartbeat(ctx: Ctx, deviceId: string, appVersion?: string | null): Promise<{ ok: boolean }> {
    if (!this.devices || !deviceId) return { ok: false };
    try { await this.devices.upsertOnRegister(ctx.tenantId, { deviceId, appVersion: appVersion ?? null, registeredBy: ctx.userId || null }); this.sig().appVersion(appVersion); return { ok: true }; }
    catch (e) { if (e instanceof DeviceBindingError) throw new AttemptError(e.code, e.message); return { ok: false }; }
  }

  // ── Branch switch (§120) ───────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Mandate §120: "active payment must finish/cancel before switching". Asked by the platform's ONE branch switch
   * (POST /auth/select-branch → identity BRANCH_SWITCH_GUARD) before it re-scopes a session. Active, in the branch the
   * session is in now: an unreleased, unexpired MOBILE claim held by this person OR this phone, or a Tap to Pay attempt
   * on this phone that is created (unexpired, §132) / in flight / unresolved. Null = nothing to finish.
   */
  async branchSwitchBlock(who: { tenantId: string; branchId: string | null; userId: string; deviceId?: string | null; targetBranchId?: string | null; sessionId?: string | null }): Promise<{ code: string; kind?: 'claim' | 'attempt' | 'device' | 'step_up' | 'merchant'; ticketId?: string; message: string; status?: number } | null> {
    if (!who.tenantId || !who.branchId) return null;   // no branch yet (first pick after sign-in) — nothing can be active
    const now = this.now();
    // Secure Tap to Pay §10: a REGISTERED payment phone switches store only to a branch the device is authorized for, and only
    // with a fresh step-up (the switch changes which merchant the phone charges through). A phone that is not a payment
    // device (or a browser) switches as before.
    const dev = who.deviceId && this.devices ? await this.devices.get(who.tenantId, who.deviceId) : null;   // a lookup failure fails the switch (closed)
    if (dev && who.targetBranchId) {
      const f = computeDeviceFacts(dev, { requiredBranchId: who.targetBranchId });
      if (f.blockReason === 'DEVICE_BRANCH_NOT_AUTHORIZED') return { code: 'DEVICE_BRANCH_NOT_AUTHORIZED', kind: 'device', message: ERROR_REGISTRY.DEVICE_BRANCH_NOT_AUTHORIZED.message, status: 403 };
      if (dev.status === 'active' && this.x.stepUp && who.userId) {
        const fresh = await this.x.stepUp.isFresh(who.sessionId ?? null, who.userId, 300, who.tenantId);
        if (!fresh) return { code: 'STEP_UP_REQUIRED', kind: 'step_up', message: 'Confirm your password to switch the location this payment phone charges for.', status: 403 };
      }
      // §10 CHECK MERCHANT CONFIGURATION (Oct 26 2026), after the step-up and before the switch: the phone charges through the
      // TARGET location's merchant (its own account, else the salon's) — a location with none (or one that is paused /
      // disabled) is refused now, not on the first tap there. A read that fails throws: identity answers 503 (fail closed).
      if (dev.status === 'active') {
        const gw = await this.gateways.resolve(who.tenantId, who.targetBranchId);
        if (!gw?.configured) return { code: 'MERCHANT_NOT_CONFIGURED', kind: 'merchant', message: ERROR_REGISTRY.MERCHANT_NOT_CONFIGURED.message, status: 409 };
      }
    }
    const message = 'Finish or cancel the active payment on this phone before switching location.';
    const claims = await this.locks.heldBy(who.tenantId, { branchId: who.branchId, source: 'mobile', userId: who.userId || null, deviceId: who.deviceId || null }, now);
    if (claims.length) return { code: 'PAYMENT_IN_PROGRESS', kind: 'claim', ticketId: claims[0].ticketId, message };
    if (who.deviceId && this.attempts.listForDeviceInStates) {
      const live = (await this.attempts.listForDeviceInStates(who.tenantId, who.branchId, who.deviceId, BRANCH_SWITCH_BLOCKING_STATES))
        .filter((a) => a.status !== 'created' || !a.expiresAt || Date.parse(a.expiresAt) > now.getTime());
      if (live.length) return { code: 'PAYMENT_IN_PROGRESS', kind: 'attempt', ticketId: live[0].ticketId, message };
    }
    return null;
  }

  // ── POS-facing (§45, §149–§151) ───────────────────────────────────────────────────────────────────────────────────
  /** §45: every active MOBILE claim in the caller's branch — the POS shows "Payment in progress · Manager · Device". */
  async activeClaims(ctx: Ctx): Promise<{ ticketId: string; userId: string | null; userName: string | null; deviceId: string | null; deviceLabel: string | null; expiresAt: string }[]> {
    if (!this.db) return [];
    let q: any = this.db.selectFrom('checkout_locks as l')
      .leftJoin('users as u', (j: any) => j.onRef('u.id', '=', 'l.owner_user_id'))
      .leftJoin('mobile_pay_devices as d', (j: any) => j.onRef('d.device_id', '=', 'l.owner_device_id').onRef('d.tenant_id', '=', 'l.tenant_id'))
      .select(['l.ticket_id as ticket_id', 'l.owner_user_id as user_id', 'l.owner_device_id as device_id', 'l.expires_at as expires_at', 'u.full_name as user_name', 'd.label as device_label'])
      .where('l.tenant_id', '=', ctx.tenantId).where('l.source', '=', 'mobile').where('l.released_at', 'is', null).where('l.expires_at', '>', this.now());
    if (ctx.branchId) q = q.where('l.branch_id', '=', ctx.branchId);
    const rows: any[] = await q.execute().catch(() => []);
    return rows.map((r) => ({ ticketId: String(r.ticket_id), userId: r.user_id ? String(r.user_id) : null, userName: r.user_name ?? null, deviceId: r.device_id ?? null, deviceLabel: r.device_label ?? null, expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at) }));
  }

  /** §149: the branch's payment phones for the POS "Mobile Payments" card — label, user, online, Tap to Pay ready. Safe fields only. */
  async deviceStatusForPos(ctx: Ctx): Promise<{ deviceId: string; label: string | null; userName: string | null; online: boolean; status: string; tapToPayCapable: boolean; lastSeenAt: string | null }[]> {
    const all = await this.listMyDevices(ctx);
    return all.filter((d) => d.status === 'active' && (!ctx.branchId || !d.branchId || d.branchId === ctx.branchId))
      .map((d) => ({ deviceId: d.deviceId, label: d.label ?? null, userName: d.boundUserName ?? null, online: d.online, status: d.status, tapToPayCapable: d.tapToPayCapable, lastSeenAt: d.lastSeenAt ?? null }));
  }

  /** §150: the front desk sends a checkout to a specific phone — a push to the employee using it + the realtime nudge. The
   *  queue stays the source of truth (the phone still has to claim it; §151 only one may).
   *  Secure Tap to Pay M6-6 (§14 / §77): a SHARED salon phone is used by whoever is signed in on it NOW — the push goes to
   *  that employee (the newest live session opened on the phone), not to whoever registered it; nobody signed in → no push
   *  (the phone's own realtime room still gets the nudge). A personal phone answers only to its bound user. The nudge goes to
   *  the phone's OWN room (rooms.paymentDevice) as well as the branch (the POS screens show "sent"). */
  async sendToDevice(ctx: Ctx, ticketId: string, deviceId: string): Promise<{ sent: boolean; reason?: string }> {
    if (!hasPermission(ctx, 'pos.checkout.take_payment')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'You do not have permission to send a checkout to a payment phone.');
    const detail = await this.checkout.detail(ctx, ticketId);
    const dev = this.devices ? await this.devices.get(ctx.tenantId, deviceId) : null;
    if (!dev || dev.status !== 'active') throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'That phone is not an active payment device for this salon.');
    const where = computeDeviceFacts(dev, { requiredBranchId: ctx.branchId || null });
    if (where.blockReason === 'DEVICE_BRANCH_NOT_AUTHORIZED') throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'That phone belongs to another location.');
    const signedIn = this.devices?.signedInUser ? await this.devices.signedInUser(ctx.tenantId, deviceId) : null;
    // shared: the employee signed in now; personal: its bound user (another person signed in on it cannot take payment anyway)
    const target = dev.shared ? signedIn : (dev.boundUserId ?? signedIn);
    const payload = { ticketId, deviceId, userId: target ?? null, shared: !!dev.shared };
    this.emit(ctx, EVENTS.checkoutSentToMobile, payload);
    this.emitToDevice(ctx.tenantId, deviceId, EVENTS.checkoutSentToMobile, payload);
    this.audit(ctx, 'checkout_sent_to_mobile', ticketId, { deviceId, userId: target ?? null, shared: !!dev.shared, registeredBy: dev.boundUserId ?? null });
    if (!target) return { sent: false, reason: 'no_signed_in_employee' };
    if (!this.x.push) return { sent: false, reason: 'no_push_target' };
    try {
      // §135: no amounts beyond the total, no customer details in the push — ids and a label only
      await this.x.push.dispatchToUser(ctx.tenantId, target, { title: 'Checkout ready to pay', body: `Ticket #${detail.ticketNumber} is ready for payment on your phone.`, data: { route: 'checkout', ticketId, deviceId }, category: 'PAYMENT_ALERT' });
      return { sent: true };
    } catch (e) { return { sent: false, reason: String((e as Error)?.message ?? e).slice(0, 120) }; }
  }

  // ── Session minting / onboarding (§34, §123) ──────────────────────────────────────────────────────────────────────
  /**
   * Mint a processor session token for the on-device Tap to Pay SDK (spec §14 step 2). Only for a 'ready' attempt
   * (readiness already passed). Re-checks the device, the kill switch and — §55/§155 — the checkout VERSION and the
   * balance: the amount frozen on the intent must still be what the ticket owes, or CHECKOUT_VERSION_CONFLICT (the app
   * resyncs, the customer is never charged a stale amount). Delegates to the TapToPaySessionPort — a real CommerceHub
   * adapter or the Noop. When Tap to Pay is not configured the port throws TapToPayNotConfiguredError; it NEVER returns a
   * fabricated token.
   */
  async mintDeviceSession(ctx: Ctx, idempotencyKey: string, deviceId?: string): Promise<DeviceSession> {
    const attempt = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: another location's attempt is a 404, like getAttempt (SD-21)
    if (!attempt) throw withCode(new AttemptError('not_found', 'No such payment attempt.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    if (attempt.status !== 'ready') throw withCode(new AttemptError('invalid', `A device session can only be minted for a ready attempt (this one is '${attempt.status}').`), 'PAYMENT_ATTEMPT_STATE_INVALID');
    await this.assertTapToPayOn(ctx.tenantId);
    await this.assertDeviceTrusted(ctx, deviceId ?? attempt.deviceId);
    await this.assertAttemptStillCurrent(ctx, attempt);
    const port = this.port();
    // Secure Tap to Pay §49: minting a provider session for a phone is audited (ids only — never the session token)
    this.audit(ctx, 'tap_to_pay_session_minted', attempt.ticketId, { idempotencyKey, deviceId: deviceId ?? attempt.deviceId ?? null, amountCents: attempt.amountCents, provider: port.provider });
    const merchant = await this.ttpMerchant(ctx);
    return port.mintDeviceSession({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, idempotencyKey, amountCents: attempt.amountCents, currency: attempt.currency || 'USD', deviceId: deviceId ?? attempt.deviceId ?? null, merchant });
  }

  /** §55 / §155–§156: the ticket's version and balance must still match what the intent was created for. */
  private async assertAttemptStillCurrent(ctx: Ctx, attempt: MobileAttemptView): Promise<void> {
    if (!attempt.checkoutVersion) return;   // an intent made before versions existed (or seeded directly) carries nothing to compare
    const detail = await this.getTicketDetail(ctx, attempt.ticketId);
    const inFlightOthers = (await this.attempts.listForTicket(ctx, attempt.ticketId)).filter((a) => a.idempotencyKey !== attempt.idempotencyKey && a.status !== 'confirmed' && (a.status === 'created' || blocksNewAttempt(a.status as PaymentAttemptState))).reduce((s, a) => s + a.amountCents, 0);
    const stale = (attempt.checkoutVersion && attempt.checkoutVersion !== detail.version) || attempt.amountCents > detail.balanceDueCents - inFlightOthers;
    if (stale) {
      // Secure Tap to Pay §31 / §66 (M6-6): an intent made against an older checkout version is STALE (it was
      // CHECKOUT_VERSION_CONFLICT, which now means only "the version the client sent no longer matches")
      await this.attempts.setMeta(ctx.tenantId, attempt.idempotencyKey, { lastErrorCode: 'CHECKOUT_STALE' });
      this.audit(ctx, 'mobile_checkout_version_conflict', attempt.ticketId, { idempotencyKey: attempt.idempotencyKey, attemptAmountCents: attempt.amountCents, balanceDueCents: detail.balanceDueCents, attemptVersion: attempt.checkoutVersion, currentVersion: detail.version });
      throw new AttemptError('CHECKOUT_STALE', ERROR_REGISTRY.CHECKOUT_STALE.message);
    }
  }

  /** This tenant's Tap to Pay onboarding status (any authenticated app user in the tenant). Read-only. */
  async getTapToPayOnboarding(ctx: Ctx): Promise<{ appleEntitlementStatus: string; commerceHubStatus: string; onboarded: boolean; credentialsPresent: boolean; notes?: string | null; updatedAt?: string | null }> {
    const rec = this.onboarding ? await this.onboarding.get(ctx.tenantId).catch(() => null) : null;
    const credentialsPresent = tapToPayConfigured();
    return {
      appleEntitlementStatus: rec?.appleEntitlementStatus ?? 'not_started',
      commerceHubStatus: rec?.commerceHubStatus ?? 'not_started',
      onboarded: tenantTapToPayConfigured(credentialsPresent, rec),
      credentialsPresent,
      notes: rec?.notes ?? null,
      updatedAt: rec?.updatedAt ?? null,
    };
  }

  /**
   * Record a tenant's Tap to Pay onboarding progress — the switch that flips readiness on. SUPER_ADMIN only: this
   * reflects the Apple entitlement + Fiserv CommerceHub onboarding the platform operator drives externally, so the
   * target tenant is an explicit argument (a Super Admin is tenant-less). Never fakes readiness — the credentials
   * still have to exist for `onboarded` to become true.
   */
  async setTapToPayOnboarding(ctx: Ctx, tenantId: string, input: TtpOnboardingInput): Promise<TtpOnboardingRecord> {
    if (!isPlatformPrincipal(ctx)) throw withCode(new AttemptError('forbidden', 'Only a platform Super Admin can record Tap to Pay onboarding status.'), 'PLATFORM_ONLY_ACTION');
    if (!this.onboarding) throw withCode(new AttemptError('unavailable', 'Onboarding store is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!tenantId) throw new AttemptError('invalid', 'A target tenantId is required.');
    const rec = await this.onboarding.set(tenantId, { ...input, updatedBy: ctx.userId });
    this.audit({ tenantId, branchId: '', userId: ctx.userId, role: ctx.role, permissions: [] } as Ctx, 'tap_to_pay_onboarding_recorded', tenantId, { appleEntitlementStatus: input.appleEntitlementStatus, commerceHubStatus: input.commerceHubStatus });
    return rec;
  }

  /** Super Admin read of a specific tenant's Tap to Pay onboarding status (with the credential + flip facts). */
  async getTapToPayOnboardingForTenant(tenantId: string): Promise<{ tenantId: string; appleEntitlementStatus: string; commerceHubStatus: string; pspEnrollmentStatus: string; onboarded: boolean; credentialsPresent: boolean; notes?: string | null; updatedAt?: string | null }> {
    const rec = this.onboarding ? await this.onboarding.get(tenantId).catch(() => null) : null;
    const credentialsPresent = tapToPayConfigured();
    return {
      tenantId,
      appleEntitlementStatus: rec?.appleEntitlementStatus ?? 'not_started',
      commerceHubStatus: rec?.commerceHubStatus ?? 'not_started',
      pspEnrollmentStatus: rec?.commerceHubStatus ?? 'not_started',   // the Super Admin screen's (provider-neutral) name
      onboarded: tenantTapToPayConfigured(credentialsPresent, rec),
      credentialsPresent,
      notes: rec?.notes ?? null,
      updatedAt: rec?.updatedAt ?? null,
    };
  }

  // ── Queue / ticket (§35–§38, §48–§49, §55) ────────────────────────────────────────────────────────────────────────
  /**
   * The Checkout Queue (first reference screen). REUSES the canonical CheckoutService.getState — the same ready-for-
   * checkout tickets the POS shows, scoped server-side to this caller's tenant/branch. No second query, no duplication.
   * The canonical getState() also re-checks pos.checkout.view, so access is enforced twice (permission + here).
   */
  async getQueue(ctx: Ctx, opts: MobileQueueOpts = {}): Promise<MobileQueueResult> {
    const state = await this.checkout.getState(ctx, {});
    return mapMobileQueue(state.tickets.items, opts);
  }

  /**
   * Ticket detail (second reference screen). REUSES CheckoutService.detail — the same canonical services, totals, and
   * customer the POS shows, scoped server-side; the canonical detail() also re-checks pos.checkout.view and audit-logs
   * the view. The phone is masked in the projection. Carries the checkout VERSION (§55), what the canonical payments
   * already cover (§48 Paid / Balance Due) and the active claim (§45–§46).
   */
  async getTicketDetail(ctx: Ctx, ticketId: string, sessionId?: string): Promise<MobileTicketDetail> {
    const detail = await this.checkout.detail(ctx, ticketId);
    const paid = await this.checkout.paidCentsFor(ctx, ticketId).catch(() => 0);
    const mapped = mapMobileTicketDetail(detail, { paidCents: paid });
    mapped.claim = await this.claimView(ctx, ticketId, sessionId).catch(() => null);
    return mapped;
  }

  /** §45–§46: the active claim as a screen shows it (labels, never PII). */
  async claimView(ctx: Ctx, ticketId: string, sessionId?: string): Promise<CheckoutClaimView | null> {
    const s = await this.locks.getStatus(ctx.tenantId, ticketId, sessionId === undefined ? undefined : this.claimId(ctx, sessionId), this.now());
    if (!s.locked || !s.heldBy) return null;
    const active = await this.locks.active(ctx.tenantId, ticketId, this.now()).catch(() => null);
    const userId = active?.ownerUserId ?? null; const deviceId = active?.ownerDeviceId ?? null;
    const names = userId ? await this.userNames(ctx.tenantId, [userId]) : new Map<string, string>();
    const dev = deviceId && this.devices ? await this.devices.get(ctx.tenantId, deviceId).catch(() => null) : null;
    return { source: s.heldBy.source, ownedByCaller: s.ownedByCaller, userId, userName: userId ? names.get(userId) ?? null : null, deviceId, deviceLabel: dev?.label ?? null, expiresAt: s.heldBy.expiresAt, message: s.heldBy.message };
  }

  // ── Claim (§41–§47, §152–§153) ────────────────────────────────────────────────────────────────────────────────────
  /**
   * Acquire the checkout-session lock on a ticket — the mandate's CheckoutPaymentClaim (server-side reservation with
   * expiry; the app heartbeats it). First confirms the ticket exists / is checkout-visible via the canonical detail()
   * (server-derived tenant scope, throws if not found), checks the device is trusted, THEN takes the lock. Throws
   * LockHeldElsewhereError (→ 409 CHECKOUT_ALREADY_CLAIMED) when the POS or another device already holds it.
   */
  async acquireLock(ctx: Ctx, ticketId: string, deviceId: string | undefined, sessionId: string): Promise<LockResult> {
    const ticket = await this.checkout.detail(ctx, ticketId); // eligibility + tenant scope (canonical, audited)
    if (deviceId && this.devices) {
      // a revoked / foreign phone cannot even claim (§163) — a pending one may open the ticket read-only but not pay
      const rec = await this.devices.get(ctx.tenantId, deviceId).catch(() => null);
      const f = computeDeviceFacts(rec, { requiredBranchId: ctx.branchId || null, requiredUserId: ctx.userId || null });
      if (f.blockReason === 'DEVICE_REVOKED') { this.sig().signal('revoked_device_attempt', { tenantId: ctx.tenantId, deviceId, userId: ctx.userId }); throw new AttemptError('DEVICE_REVOKED', 'This phone’s payment access has been revoked.'); }
      // §14 / §77: a PERSONAL phone answers only to its user; a SHARED salon phone to any employee signed in on it (M6-5 live
      // pilot: this check ignored `shared`, so the second employee of a shift could not claim a ticket on the front desk phone)
      if (!rec?.shared && rec?.boundUserId && ctx.userId && rec.boundUserId !== ctx.userId) throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'This phone is registered to another user.');
      if (rec?.publicKey && (ctx as MobileCtx).verifiedDeviceId !== rec.deviceId) {   // §71: claimed by the phone that holds the key
        this.sig().signal('key_mismatch', { tenantId: ctx.tenantId, deviceId, userId: ctx.userId, detail: 'a claim without the phone\'s signature' });
        throw new AttemptError('DEVICE_KEY_MISMATCH', ERROR_REGISTRY.DEVICE_KEY_MISMATCH.message);
      }
    }
    // Secure Tap to Pay §31 (M6-6): the claim — and every re-claim — remembers the checkout version it was made against
    let r: LockResult;
    try { r = await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: ctx.userId, deviceId, sessionId: this.claimId(ctx, sessionId), source: 'mobile', checkoutVersion: computeCheckoutVersion(ticket) }, this.now()); }
    catch (e) {
      if (e instanceof LockHeldElsewhereError) {   // §51: claim conflicts — counted, and audited so the owner / platform panels can count them durably
        this.sig().count('claim_conflict');
        this.audit(ctx, 'checkout_payment_claim_conflict', ticketId, { deviceId: deviceId ?? null });
      }
      throw e;
    }
    if (r.action !== 'refreshed') {
      this.audit(ctx, 'checkout_payment_claimed', ticketId, { deviceId: deviceId ?? null, action: r.action, expiresAt: r.expiresAt });
      this.emit(ctx, EVENTS.checkoutPaymentClaimed, { ticketId, source: 'mobile', userId: ctx.userId, deviceId: deviceId ?? null, expiresAt: r.expiresAt });
      await this.outboxEvent(ctx, DOMAIN_EVENTS.CHECKOUT_PAYMENT_CLAIMED, 'ticket', ticketId, { ticketId, source: 'mobile', deviceId: deviceId ?? null, action: r.action, expiresAt: r.expiresAt });
    }
    return r;
  }

  refreshLock(ctx: Ctx, ticketId: string, sessionId: string): Promise<LockResult> {
    return this.locks.refresh(ctx.tenantId, ticketId, this.claimId(ctx, sessionId), this.now());
  }

  async releaseLock(ctx: Ctx, ticketId: string, sessionId: string, reason?: string): Promise<{ released: boolean }> {
    const r = await this.locks.release(ctx.tenantId, ticketId, this.claimId(ctx, sessionId), reason);
    if (r.released) {
      this.emit(ctx, EVENTS.checkoutPaymentClaimReleased, { ticketId, source: 'mobile', reason: reason ?? null });
      this.audit(ctx, 'checkout_payment_claim_released', ticketId, { reason: reason ?? null });   // Secure Tap to Pay §49: claim release is audited
    }
    return r;
  }

  lockStatus(ctx: Ctx, ticketId: string, sessionId?: string): Promise<LockStatus> {
    return this.locks.getStatus(ctx.tenantId, ticketId, sessionId === undefined ? undefined : this.claimId(ctx, sessionId), this.now());
  }

  /**
   * §46 authorized takeover: a manager with checkout.manage_overrides takes the claim from the POS / another phone — only
   * when NO card attempt is in flight on the ticket (PAYMENT_IN_PROGRESS otherwise: a tap that may be mid-authorization
   * is never pulled away). Audited with the reason; the previous holder's screen learns it by realtime.
   */
  async takeoverLock(ctx: Ctx, ticketId: string, deviceId: string | undefined, sessionId: string, reason: string): Promise<LockResult> {
    if (!hasPermission(ctx as any, 'checkout.manage_overrides')) throw withCode(new AttemptError('forbidden', 'Taking over a checkout needs the manager override permission.'), 'MANAGER_OVERRIDE_REQUIRED');
    if (!String(reason ?? '').trim()) throw withCode(new AttemptError('invalid', 'A reason is required to take over a checkout.'), 'TAKEOVER_REASON_REQUIRED');
    const ticket = await this.checkout.detail(ctx, ticketId);
    const inFlight = (await this.attempts.listForTicket(ctx, ticketId)).some((a) => a.status !== 'created' && a.status !== 'ready' && blocksNewAttempt(a.status as PaymentAttemptState));
    if (inFlight) throw new AttemptError('PAYMENT_IN_PROGRESS', 'A card payment is being processed on this ticket right now. Wait for it to finish or be verified.');
    const cur = await this.locks.getStatus(ctx.tenantId, ticketId, this.claimId(ctx, sessionId), this.now());
    if (cur.locked && !cur.ownedByCaller) await this.locks.forceRelease(ctx.tenantId, ticketId, 'takeover:' + String(reason).slice(0, 80));
    const r = await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: ctx.userId, deviceId, sessionId: this.claimId(ctx, sessionId), source: 'mobile', checkoutVersion: computeCheckoutVersion(ticket) }, this.now());
    this.audit(ctx, 'checkout_payment_claim_taken_over', ticketId, { from: cur.heldBy?.source ?? null, deviceId: deviceId ?? null }, reason);
    this.emit(ctx, EVENTS.checkoutPaymentClaimed, { ticketId, source: 'mobile', userId: ctx.userId, deviceId: deviceId ?? null, expiresAt: r.expiresAt, takeover: true });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.CHECKOUT_PAYMENT_CLAIMED, 'ticket', ticketId, { ticketId, source: 'mobile', deviceId: deviceId ?? null, action: 'takeover', reason });
    return r;
  }

  /**
   * Secure Tap to Pay §31 / §66 (M6-6): the caller's claim was made against checkout version V; the POS has since changed
   * the ticket (version W). Nothing may be charged from that claim — CHECKOUT_STALE — until the phone re-opens the ticket
   * (a re-claim at W, i.e. it has the authoritative amount again). A claim with no stored version (POS / pre-690) is never
   * called stale. Only the CALLER's own claim is judged here; someone else's claim is lock_not_held downstream.
   */
  private async claimStale(ctx: Ctx, ticketId: string, sessionId: string, currentVersion: string): Promise<boolean> {
    const lock = await this.locks.active(ctx.tenantId, ticketId, this.now());
    if (!lock || lock.sessionId !== this.claimId(ctx, sessionId) || !isClaimStale(lock, currentVersion)) return false;
    this.audit(ctx, 'mobile_checkout_claim_stale', ticketId, { claimVersion: lock.checkoutVersion ?? null, currentVersion });
    return true;
  }

  /**
   * Secure Tap to Pay §33 / §34 / §64 (M6-6): the ONE unsettled-tender view (checkout/unsettled-tenders.ts — POS card
   * payments 'processing', split / Tap to Pay attempts in flight, Skip-the-Line app charges sent to the processor) is read
   * before a phone may start a new card charge or record cash. Any tender whose processor answer may still arrive →
   * PAYMENT_STATUS_UNKNOWN ("being verified — do not charge again"); a tap actively in progress on a phone →
   * PAYMENT_IN_PROGRESS. An attempt that has not reached the processor yet ('ready' / 'readiness_checking') blocks nothing
   * here (it holds its slice of the balance). `exceptKey`: the caller's own intent. A read that fails throws (fail closed).
   */
  private async unsettledBlock(ctx: Ctx, ticketId: string, exceptKey?: string | null): Promise<{ code: 'PAYMENT_STATUS_UNKNOWN' | 'PAYMENT_IN_PROGRESS'; kind: string; status: string } | null> {
    const tenders = await this.checkout.unsettledTenders(ctx as unknown as CheckoutContext, ticketId);
    const block = mobileUnsettledBlock(tenders, exceptKey);
    if (block) this.audit(ctx, 'mobile_payment_blocked_unsettled_tender', ticketId, { kind: block.kind, status: block.status, code: block.code });
    return block;
  }

  /**
   * M6-6 (§31 / §32): a tender THIS phone recorded (the cash part of a split, a captured card part) changes the checkout
   * version — that is the phone's own, authoritative change, not a front-desk edit, so the caller's claim moves to the new
   * version (the next part of the split proceeds on the server's new remaining balance). Only the claim the same employee
   * holds on a mobile claim; the POS's / another phone's claim is never touched. Best effort: a failure here only means the
   * next proceed answers CHECKOUT_STALE and the phone re-opens the ticket (the safe direction).
   */
  private async restampOwnClaim(ctx: Ctx, ticketId: string): Promise<void> {
    try {
      const lock = await this.locks.active(ctx.tenantId, ticketId, this.now());
      if (!lock || lock.source !== 'mobile' || !ctx.userId || lock.ownerUserId !== ctx.userId || !lock.checkoutVersion) return;
      const version = computeCheckoutVersion(await this.checkout.detail(ctx as unknown as CheckoutContext, ticketId));
      if (version === lock.checkoutVersion) return;
      await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: lock.ownerUserId, deviceId: lock.ownerDeviceId, sessionId: lock.sessionId, source: 'mobile', checkoutVersion: version }, this.now());
    } catch (e) { console.warn('[mobile-checkout] claim version re-stamp after an own tender failed (next proceed re-opens the ticket):', (e as Error)?.message); }
  }

  // ── Proceed / intent (§54–§56, §64–§68, §132, §184) ───────────────────────────────────────────────────────────────
  /**
   * "Proceed to payment" gate (spec §14). Gathers the real facts — readiness (so Tap to Pay being SetupRequired blocks),
   * whether the caller holds the lock, the ticket balance (what the canonical payments do not yet cover), the validated
   * tip/split, the checkout version (§55) and the step-up threshold (§184) — and returns the honest decision. NO money
   * moves: when the gate is green it attaches a fresh idempotency key + the 'created' attempt state so the eventual
   * capture is replay-safe.
   */
  async evaluateProceed(ctx: MobileCtx, ticketId: string, opts: { sessionId: string; deviceId?: string; tip?: TipPreset; segments?: SplitSegmentPlan[]; expectedVersion?: string }): Promise<ProceedResult> {
    const [readiness, lock, detail] = await Promise.all([
      this.getReadiness(ctx, opts.deviceId),   // device approval + Tap to Pay onboarding gate the real payment path
      this.locks.getStatus(ctx.tenantId, ticketId, this.claimId(ctx, opts.sessionId), this.now()),
      this.getTicketDetail(ctx, ticketId), // confirms the ticket (404s if missing) + supplies totals
    ]);
    const balanceCents = detail.balanceDueCents;
    const subtotalCents = detail.totals.subtotalCents;
    if (opts.expectedVersion && opts.expectedVersion !== detail.version) {
      return { canProceed: false, reason: 'CHECKOUT_VERSION_CONFLICT', message: 'This checkout changed at the front desk. Review the refreshed amount before charging.', balanceCents, version: detail.version };
    }
    if (lock.ownedByCaller && await this.claimStale(ctx, ticketId, opts.sessionId, detail.version)) {
      return { canProceed: false, reason: 'CHECKOUT_STALE', message: ERROR_REGISTRY.CHECKOUT_STALE.message, balanceCents, version: detail.version };
    }
    const unsettled = await this.unsettledBlock(ctx, ticketId);   // §34: nothing new while a tender is mid-air
    if (unsettled) return { canProceed: false, reason: unsettled.code, message: ERROR_REGISTRY[unsettled.code].message, balanceCents, version: detail.version };
    const tip = opts.tip !== undefined ? computeTip(subtotalCents, opts.tip) : undefined;
    const split = opts.segments !== undefined ? validateSplitPlan(opts.segments, balanceCents) : undefined;

    const decision = decideProceed({
      canTakePayment: readiness.canTakePayment,
      readinessOverall: readiness.overall,
      lockOwnedByCaller: lock.ownedByCaller,
      balanceCents, tip, split,
    });
    if (!decision.canProceed) return { ...decision, version: detail.version };
    // §184 high-value step-up: at or above the threshold the session must have re-proved itself recently
    const chargeCents = split ? split.totalCents : balanceCents + (tip ? tip.tipCents - detail.totals.tipCents : 0);
    if (chargeCents >= stepUpThresholdCents() && this.x.stepUp && ctx.userId) {
      const fresh = await this.x.stepUp.isFresh(ctx.sessionId ?? null, ctx.userId, 300, ctx.tenantId).catch(() => false);
      if (!fresh) return { canProceed: false, reason: 'STEP_UP_REQUIRED', message: 'This amount needs you to confirm your password before charging.', balanceCents, version: detail.version, stepUpRequired: true };
    }

    return {
      ...decision,
      idempotencyKey: await this.stableIntentKey(ctx, ticketId, detail.version, chargeCents, opts.deviceId),
      attemptState: 'created',
      plannedTipCents: tip?.tipCents,
      plannedSplit: split && opts.segments ? { totalCents: split.totalCents, segments: opts.segments } : undefined,
      version: detail.version,
    };
  }

  /**
   * Secure Tap to Pay §30 (Oct 23 2026): ONE logical payment has ONE durable idempotency identity. The key is derived from
   * what the payment IS — the ticket, its checkout version, the amount, the phone and the employee — so twenty taps of
   * "Proceed" (or a reopened app) produce the same key and therefore the same intent / one processor effect. Only after a
   * DEFINITIVE end of that intent (declined / failed / canceled, or a never-used intent past its expiry) does a new attempt
   * get the next suffix. Never Date.now(), never a fresh random value per retry (it was randomUUID() per Proceed).
   */
  private async stableIntentKey(ctx: Ctx, ticketId: string, version: string, chargeCents: number, deviceId?: string): Promise<string> {
    const base = 'ttp_' + createHash('sha256').update([ctx.tenantId, ticketId, version, chargeCents, deviceId ?? '', ctx.userId ?? ''].join('|')).digest('hex').slice(0, 40);
    const existing = await this.attempts.listForTicket(ctx, ticketId);
    const now = this.now().getTime();
    const over = (a: MobileAttemptView) => ['declined', 'failed', 'canceled'].includes(a.status) || (a.status === 'created' && !!a.expiresAt && Date.parse(a.expiresAt) <= now);
    for (let n = 0; n < 1000; n++) {
      const key = n === 0 ? base : `${base}-${n}`;
      const a = existing.find((x) => x.idempotencyKey === key);
      if (!a || !over(a)) return key;
    }
    return `${base}-${randomUUID()}`;   // unreachable in practice: a thousand definitive failures of one exact payment
  }

  /**
   * Idempotently record a payment attempt — the mandate's PaymentIntent (§64–§66) — for the ticket (state 'created').
   * Gated on the caller holding the lock, a trusted device, the kill switch, the checkout version (§55), a positive
   * remaining balance and the attempt amount within it. NOT gated on Tap-to-Pay readiness — the attempt RECORDS the
   * intent; readiness is a tracked state advanced by runReadinessStep. Re-calling with the same idempotency key returns
   * the same attempt (UNIQUE(tenant, idempotency_key)) — twenty taps, one intent (§154).
   */
  async createAttempt(ctx: Ctx, ticketId: string, opts: { sessionId: string; idempotencyKey: string; amountCents?: number; deviceId?: string; expectedVersion?: string }): Promise<MobileAttemptView> {
    if (!opts.idempotencyKey) throw new AttemptError('invalid', 'An idempotencyKey is required.');
    const [lock, detail, existing] = await Promise.all([
      this.locks.getStatus(ctx.tenantId, ticketId, this.claimId(ctx, opts.sessionId), this.now()),
      this.getTicketDetail(ctx, ticketId),
      this.attempts.listForTicket(ctx, ticketId),
    ]);
    // Idempotent replay: an attempt already exists for this key — return it unchanged (it already reserved its slice,
    // so re-validating it against the remaining balance would wrongly reject the retry).
    const prior = existing.find((a) => a.idempotencyKey === opts.idempotencyKey);
    if (prior) {
      if (opts.amountCents != null && Math.round(Number(opts.amountCents)) !== prior.amountCents) throw new AttemptError('IDEMPOTENCY_KEY_REUSED', 'This payment key was already used for a different amount. Start the payment again.');
      return prior;
    }
    if (!lock.ownedByCaller) throw withCode(new AttemptError('lock_not_held', 'Re-open the ticket to continue checkout.'), 'CHECKOUT_STALE');
    await this.assertTapToPayOn(ctx.tenantId);
    const dev = await this.assertDeviceTrusted(ctx, opts.deviceId);
    if (opts.expectedVersion && opts.expectedVersion !== detail.version) throw new AttemptError('CHECKOUT_VERSION_CONFLICT', 'This checkout changed at the front desk. Review the refreshed amount before charging.');
    if (await this.claimStale(ctx, ticketId, opts.sessionId, detail.version)) throw new AttemptError('CHECKOUT_STALE', ERROR_REGISTRY.CHECKOUT_STALE.message);   // §31 / §66
    const unsettled = await this.unsettledBlock(ctx, ticketId, opts.idempotencyKey);   // §33 / §34 / §64: never a second card while one may land
    if (unsettled) throw new AttemptError(unsettled.code, ERROR_REGISTRY[unsettled.code].message);
    // Partial / split-tender aware: a new attempt may charge up to the REMAINING balance — the ticket balance (what the
    // canonical payments do not cover) minus what in-flight attempts already reserve — and defaults to the whole
    // remaining when no amount is supplied. Never trust a client total: resolveAttemptAmount clamps against the server-derived remaining.
    const summary = summariseBalance(detail.totals.totalDueCents, existing, { paidCents: detail.paidCents });
    let amountCents: number;
    try { amountCents = resolveAttemptAmount(opts.amountCents, summary); }
    catch (e) {
      if (!(e instanceof PartialAmountError)) throw e;
      if (e.code === 'already_paid') throw new AttemptError('PAYMENT_ALREADY_COMPLETED', e.message);
      // M6-5: the balance is held by another attempt — an unresolved one is "being verified, do not run the card again"
      if (e.code === 'in_flight') { const code = existing.some((a) => UNRESOLVED.includes(a.status as PaymentAttemptState)) ? 'PAYMENT_STATUS_UNKNOWN' : 'PAYMENT_IN_PROGRESS'; throw new AttemptError(code, ERROR_REGISTRY[code].message); }
      throw new AttemptError(e.code, e.message);
    }
    const gateway = await Promise.resolve().then(() => this.gateways.resolve(ctx.tenantId, ctx.branchId || null)).catch(() => null);
    // migration 704: no Tap to Pay MID for this location → refused BEFORE an intent exists (the customer never taps)
    await this.ttpMerchant(ctx);
    const created = await this.attempts.createOrGet(ctx, {
      ticketId, amountCents, idempotencyKey: opts.idempotencyKey, method: MOBILE_ATTEMPT_METHOD,
      provider: this.port().provider, paymentSurface: TAP_TO_PAY_SURFACE, deviceId: opts.deviceId ?? dev?.deviceId ?? null,
      merchantAccountId: gateway?.merchantAccountId ?? null, currency: 'USD', checkoutVersion: detail.version,
      expiresAt: new Date(this.now().getTime() + INTENT_TTL_MS).toISOString(),
    });
    if (created.wasCreated) {   // twenty concurrent taps: one row, one audit line, one intent event (§154)
      recordPaymentEvent('attempt');
      this.audit(ctx, 'mobile_payment_initiated', ticketId, { idempotencyKey: opts.idempotencyKey, amountCents, deviceId: opts.deviceId ?? null, version: detail.version });
      await this.outboxEvent(ctx, DOMAIN_EVENTS.PAYMENT_INTENT_CREATED, 'payment_attempt', created.id, { ticketId, idempotencyKey: opts.idempotencyKey, amountCents, surface: TAP_TO_PAY_SURFACE, deviceId: opts.deviceId ?? null });
    }
    // §30 / §58: a key that already belongs to ANOTHER ticket (or another amount) is never "the same payment" — the UNIQUE
    // (tenant, idempotency_key) row came back from createOrGet, so refuse instead of handing this caller someone else's intent
    if (!created.wasCreated && (created.ticketId !== ticketId || created.amountCents !== amountCents)) {
      throw new AttemptError('IDEMPOTENCY_KEY_REUSED', 'This payment key was already used for a different payment. Start the payment again.');
    }
    const { wasCreated: _w, ...view } = created; void _w;
    return view;
  }

  /**
   * §83–§84 split tender, cash part: record a cash tender on the canonical checkout (a payments row, 'partial' until the
   * ticket is covered). Idempotent on the client's key. The card part is its own PaymentIntent (§86). Permission: the
   * mobile split right plus the POS cash-payment right (one permission model, §10).
   */
  async recordCashTender(ctx: Ctx, ticketId: string, opts: { sessionId: string; idempotencyKey: string; amountCents: number; deviceId?: string }): Promise<RecordTenderResult> {
    if (!hasPermission(ctx as any, 'mobile_checkout.split_payment') || !hasPermission(ctx as any, 'pos.checkout.cash_payment')) throw new AttemptError('PAYMENT_PERMISSION_DENIED', 'Missing permission to take a cash tender on the mobile checkout.');
    if (!this.x.recorder) throw withCode(new AttemptError('unavailable', 'Tender recording is not available on this build.'), 'FEATURE_NOT_AVAILABLE');
    if (!opts.idempotencyKey) throw new AttemptError('invalid', 'An idempotencyKey is required.');
    const amount = Math.round(Number(opts.amountCents));
    if (!Number.isInteger(amount) || amount <= 0) throw withCode(new AttemptError('invalid', 'Cash amount must be a positive whole number of cents.'), 'AMOUNT_INVALID');
    const [lock, detail] = await Promise.all([this.locks.getStatus(ctx.tenantId, ticketId, this.claimId(ctx, opts.sessionId), this.now()), this.getTicketDetail(ctx, ticketId)]);
    if (!lock.ownedByCaller) throw withCode(new AttemptError('lock_not_held', 'Re-open the ticket to continue checkout.'), 'CHECKOUT_STALE');
    // Secure Tap to Pay §19 / §61: a cash tender recorded from a phone is a money operation like any other — the phone must
    // be a trusted, active payment device of this salon, bound to this employee and this branch (it was never checked)
    await this.assertDeviceTrusted(ctx, opts.deviceId);
    const unsettled = await this.unsettledBlock(ctx, ticketId);   // §34: no cash while a card answer may still arrive (a double payment)
    if (unsettled) throw new AttemptError(unsettled.code, ERROR_REGISTRY[unsettled.code].message);
    if (detail.balanceDueCents <= 0) throw new AttemptError('PAYMENT_ALREADY_COMPLETED', 'This ticket is already paid in full.');
    if (amount > detail.balanceDueCents) throw withCode(new AttemptError('amount_exceeds_remaining', `Amount ${amount} exceeds the remaining balance ${detail.balanceDueCents}.`), 'AMOUNT_EXCEEDS_REMAINING');
    const r = await this.x.recorder.recordTender(ctx, { ticketId, idempotencyKey: 'cash:' + opts.idempotencyKey, amountCents: amount, method: 'cash', surface: 'cash', deviceId: opts.deviceId ?? null });
    if (!r.duplicate) {
      this.audit(ctx, 'mobile_cash_tender_recorded', ticketId, { paymentId: r.paymentId, amountCents: amount, ticketPaid: r.ticketPaid, deviceId: opts.deviceId ?? null });
      await this.afterTenderRecorded(ctx, ticketId, r, 'cash');
    }
    return r;
  }

  /** The post-payment work + signals every recorded tender gets (the POS's afterPaid, the display, reports). */
  private async afterTenderRecorded(ctx: Ctx, ticketId: string, r: RecordTenderResult, method: 'card' | 'cash'): Promise<void> {
    if (!r.ticketPaid) await this.restampOwnClaim(ctx, ticketId);
    if (r.ticketPaid) {
      try { await this.checkout.runPostPaymentWork({ tenantId: ctx.tenantId, branchId: ctx.branchId || '' }, ticketId); } catch { /* its steps log their own failures; the money stands */ }
    }
    // the realtime projection delivers these from the outbox when the repository emits domain events (same rule as the POS)
    if (!r.eventsViaOutbox) {
      this.emit(ctx, EVENTS.paymentApproved, { ticketId, method, source: 'mobile' });
      if (r.ticketPaid) { this.emit(ctx, EVENTS.ticketPaid, { ticketId }); this.emit(ctx, EVENTS.reportsUpdated, {}); }
      else this.emit(ctx, EVENTS.checkoutTotalRecalculated, { ticketId });
    }
  }

  /**
   * Remaining-balance summary for a ticket: what the canonical payments already cover, what in-flight attempts reserve,
   * and what a new attempt may still charge. Read-only; lets the app show "remaining" and offer a partial/split tender.
   */
  async getBalanceSummary(ctx: Ctx, ticketId: string): Promise<BalanceSummary> {
    const [detail, existing] = await Promise.all([
      this.getTicketDetail(ctx, ticketId),
      this.attempts.listForTicket(ctx, ticketId),
    ]);
    return summariseBalance(detail.totals.totalDueCents, existing, { paidCents: detail.paidCents });
  }

  /**
   * The ticket's captured payments (approved/partial) — what a refund or void can act on. Read-only; never throws
   * (degrades to []). Refunds themselves go through the canonical checkout engine below, not a second implementation.
   */
  async listTicketPayments(ctx: Ctx, ticketId: string): Promise<MobileTicketPayment[]> {
    if (!this.db) return [];
    try {
      let q = this.db.selectFrom('payments')
        .select(['id', 'method', 'amount_cents', 'tip_cents', 'status', 'created_at'])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('status', 'in', ['approved', 'partial']);
      if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
      const rows = await q.orderBy('created_at', 'asc').execute();
      return rows.map((r) => ({ paymentId: r.id, method: String(r.method || ''), amountCents: Number(r.amount_cents || 0), tipCents: Number(r.tip_cents || 0), status: String(r.status || ''), createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

  // ── Refund / void (§112–§116, §165) ───────────────────────────────────────────────────────────────────────────────
  /**
   * Refund a captured payment. Delegates entirely to the canonical checkout refund engine (reason required, permission,
   * atomic cumulative-cap, audit log, §21 attribution reversal) — no refund logic is duplicated here. Full or partial
   * (amountCents). Errors from the engine propagate so the caller sees the real reason. Step-up for a large refund is
   * enforced at the controller (@RequireStepUp above the tenant's threshold is the refund approval rule's job).
   */
  async refundPayment(ctx: Ctx, paymentId: string, body: { reason?: string; amountCents?: number; serviceLineIds?: string[]; tipRefunded?: boolean }) {
    await this.assertSigningDeviceTrusted(ctx);   // Secure Tap to Pay §41: user + DEVICE + tenant + branch scope
    // permission: the controller's @RequirePermission('pos.checkout.refund') and the engine's own need() — §165 DENIED
    // serviceLineIds / tipRefunded are passed THROUGH (Oct 1 2026): they were dropped here and in the controller, so the
    // Manager Pay refund panel's "commission on the selected services will be reversed" never reached the engine.
    this.audit(ctx, 'mobile_refund_requested', paymentId, { amountCents: body?.amountCents ?? null }, body?.reason ?? null);
    return this.checkout.refund(ctx, paymentId, {
      reason: String(body?.reason ?? ''), amountCents: body?.amountCents,
      ...(Array.isArray(body?.serviceLineIds) && body!.serviceLineIds!.length ? { serviceLineIds: body!.serviceLineIds!.map(String), tipRefunded: !!body?.tipRefunded } : {}),
    });
  }
  /** Functional Decision 20 — how a ticket-level refund would split across the ticket's original tenders. */
  async refundPreview(ctx: Ctx, ticketId: string, amountCents: number) {
    return this.checkout.refundAllocationPreview(ctx, ticketId, Number(amountCents));
  }

  /** Functional Decision 20 — refund an amount from a ticket; the canonical checkout engine splits it across tenders. */
  async refundTicket(ctx: Ctx, ticketId: string, body: { reason?: string; amountCents?: number }) {
    await this.assertSigningDeviceTrusted(ctx);
    this.audit(ctx, 'mobile_refund_requested', ticketId, { amountCents: body?.amountCents ?? null, ticketLevel: true }, body?.reason ?? null);
    return this.checkout.refundTicket(ctx, ticketId, { reason: String(body?.reason ?? ''), amountCents: Number(body?.amountCents) });
  }

  /** Void a captured payment via the canonical checkout void engine (reason required, permission, audit). §116: void stays
   *  separate from refund — the engine offers it only while the processor transaction is still voidable. */
  async voidPayment(ctx: Ctx, paymentId: string, body: { reason?: string }) {
    await this.assertSigningDeviceTrusted(ctx);
    this.audit(ctx, 'mobile_void_requested', paymentId, {}, body?.reason ?? null);
    return this.checkout.void(ctx, paymentId, { reason: String(body?.reason ?? '') });
  }

  // ── Attempt lifecycle (§69–§78, §130, §159–§160) ───────────────────────────────────────────────────────────────────
  /**
   * Backend-driven readiness step: created → readiness_checking → ready | failed, using the REAL readiness check. Drives
   * the attempt to 'ready' only when canTakePayment is true (all critical legs ok, Tap-to-Pay onboarded); otherwise
   * 'failed'. It never drives capture states (authorized/confirmed) — those require a real processor event from the
   * native Tap-to-Pay capture, which is not part of this layer.
   */
  async runReadinessStep(ctx: Ctx, idempotencyKey: string, deviceId?: string): Promise<MobileAttemptView> {
    const existing = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: scoped to the caller's location (SD-21)
    if (!existing) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    const from = existing.status as PaymentAttemptState;
    if (from !== 'created') throw withCode(new AttemptError('invalid_state', `Readiness step requires a 'created' attempt (is '${from}').`), 'PAYMENT_ATTEMPT_STATE_INVALID');
    assertTransition('created', 'readiness_checking');
    const readiness = await this.getReadiness(ctx, deviceId ?? existing.deviceId ?? undefined);   // device approval gates the attempt-level readiness too
    const target: PaymentAttemptState = readiness.canTakePayment ? 'ready' : 'failed';
    assertTransition('readiness_checking', target);
    if (target === 'failed') {
      const first = readiness.checks.find((c) => c.critical && c.state !== 'ok');
      if (first?.key === 'app_version') this.sig().signal('app_version_refused', { tenantId: ctx.tenantId, deviceId: deviceId ?? existing.deviceId ?? null, userId: ctx.userId });   // §51
      await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { lastErrorCode: first?.key === 'device' ? readiness.deviceBlockReason ?? 'DEVICE_NOT_AUTHORIZED' : first?.key === 'tap_to_pay' ? 'TAP_TO_PAY_NOT_PROVISIONED' : first?.key === 'app_version' ? 'APP_UPDATE_REQUIRED' : 'TAP_TO_PAY_NOT_PROVISIONED' });
    }
    return (await this.attempts.updateStatus(ctx.tenantId, idempotencyKey, target))!;
  }

  /** Cancel an attempt (state-machine enforced: terminal attempts cannot be canceled again). §193: a cancel never marks paid. */
  async cancelAttempt(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView> {
    const existing = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: scoped to the caller's location (SD-21)
    if (!existing) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    await this.assertAttemptDeviceProof(ctx, existing);
    assertTransition(existing.status as PaymentAttemptState, 'canceled');
    const r = (await this.attempts.updateStatus(ctx.tenantId, idempotencyKey, 'canceled'))!;
    await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { lastErrorCode: 'PAYMENT_CANCELED' });
    this.audit(ctx, 'mobile_payment_canceled', existing.ticketId, { idempotencyKey, from: existing.status });
    return r;
  }

  /** §130/§160 app-relaunch recovery: the attempt by its key (this tenant only) with the ticket it belongs to. */
  async getAttempt(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView & { terminal: boolean; recoverable: boolean }> {
    // SD-21 (Oct 27 2026): scoped to the caller's location — another location's attempt answers 404 like an unknown key
    const a = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);
    if (!a) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    const s = a.status as PaymentAttemptState;
    return { ...a, terminal: isTerminal(s) || s === 'confirmed' || s === 'declined' || s === 'failed', recoverable: blocksNewAttempt(s) || s === 'created' };
  }

  /** Mobile payment attempts for a ticket (newest first) — feeds the History screen. */
  listAttempts(ctx: Ctx, ticketId: string): Promise<MobileAttemptView[]> {
    return this.attempts.listForTicket(ctx, ticketId);
  }

  /** Recent mobile payment attempts across all tickets (newest first) — feeds the History tab. */
  recentAttempts(ctx: Ctx, limit = 50): Promise<MobileAttemptView[]> {
    return this.attempts.listRecent(ctx, limit);
  }

  /** Aggregated ATTEMPT funnel for the Reports tab (attempted vs settled, outcomes, daily buckets) — §202 analytics. */
  async report(ctx: Ctx, period: ReportPeriod = '7d'): Promise<AttemptReport> {
    const now = this.now();
    const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const attempts = await this.attempts.listSince(ctx, since);
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);   // the branch's day (Oct 6 2026)
    return computeReport(attempts.map((a) => ({ status: a.status, amountCents: a.amountCents, createdAt: a.createdAt })), period, now, tz);
  }

  // ── History / reports from the canonical payments (§103–§110, §221) ──────────────────────────────────────────────
  /**
   * Payment History (§103–§106): rows come from the canonical payments table — every sale the branch took (any surface),
   * with the surface as a dimension; filters by date, status, method, employee, device, branch (the caller's own
   * tenant always; another branch only when the caller's session is tenant-wide, §11/§121).
   */
  async paymentHistory(ctx: Ctx, f: MobilePaymentHistoryFilter = {}): Promise<MobilePaymentHistoryResult> {
    if (!this.db) return { items: [], count: 0, generatedAt: this.now().toISOString() };
    const limit = Math.max(1, Math.min(200, Number(f.limit) || 50));
    const branchId = ctx.branchId ? ctx.branchId : (f.branchId || null);   // a branch-scoped manager sees only their branch
    let q: any = this.db.selectFrom('payments as p')
      .leftJoin('tickets as t', (j: any) => j.onRef('t.id', '=', 'p.ticket_id').onRef('t.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('customers as c', (j: any) => j.onRef('c.id', '=', 't.customer_id').onRef('c.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('users as u', (j: any) => j.onRef('u.id', '=', 'p.created_by_user_id'))
      .leftJoin('mobile_pay_devices as d', (j: any) => j.onRef('d.device_id', '=', 'p.device_id').onRef('d.tenant_id', '=', 'p.tenant_id'))
      .select(['p.id as id', 'p.ticket_id as ticket_id', 'p.created_at as created_at', 'p.amount_cents as amount_cents', 'p.tip_cents as tip_cents', 'p.method as method', 'p.status as status',
        'p.payment_surface as payment_surface', 'p.card_brand as card_brand', 'p.card_last4 as card_last4', 'p.device_id as device_id', 'p.branch_id as branch_id', 'p.created_by_user_id as user_id',
        't.ticket_number as ticket_number', 'c.full_name as customer_name', 'u.full_name as employee_name', 'd.label as device_label'])
      .where('p.tenant_id', '=', ctx.tenantId).where('p.status', 'in', ['approved', 'partial', 'declined', 'failed', 'processing', 'voided']);
    if (branchId) q = q.where('p.branch_id', '=', branchId);
    if (f.from) q = q.where('p.created_at', '>=', new Date(f.from));
    if (f.to) q = q.where('p.created_at', '<=', new Date(f.to));
    if (f.method) q = q.where('p.method', '=', String(f.method));
    if (f.surface) q = q.where('p.payment_surface', '=', String(f.surface));
    if (f.employeeId) q = q.where('p.created_by_user_id', '=', String(f.employeeId));
    if (f.deviceId) q = q.where('p.device_id', '=', String(f.deviceId));
    const rows: any[] = await q.orderBy('p.created_at', 'desc').limit(limit).execute();
    const ids = rows.map((r) => String(r.id));
    const refunds = new Map<string, number>();
    if (ids.length) {
      const rr: any[] = await this.db.selectFrom('payment_refunds').select(['payment_id', (eb: any) => eb.fn.sum('amount_cents').as('s')])
        .where('tenant_id', '=', ctx.tenantId).where('payment_id', 'in', ids).where('status', 'in', ['refunded', 'approved', 'succeeded', 'completed']).groupBy('payment_id').execute().catch(() => []);
      for (const r of rr) refunds.set(String(r.payment_id), Number(r.s || 0));
    }
    const items: MobilePaymentHistoryRow[] = rows.map((r) => {
      const amount = Number(r.amount_cents || 0); const refunded = refunds.get(String(r.id)) ?? 0;
      const status = r.status === 'voided' ? 'VOIDED' : r.status === 'processing' ? 'UNKNOWN' : r.status === 'declined' ? 'DECLINED' : r.status === 'failed' ? 'FAILED'
        : refunded >= amount && amount > 0 ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'PAID';
      return {
        paymentId: String(r.id), ticketId: String(r.ticket_id ?? ''), ticketNumber: r.ticket_number ?? undefined,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        customerName: safeName(r.customer_name), amountCents: amount, tipCents: Number(r.tip_cents || 0), refundedCents: refunded,
        method: String(r.method || ''), paymentSurface: String(r.payment_surface || 'pos'), cardBrand: r.card_brand ?? null, cardLast4: r.card_last4 ?? null,
        status, employeeName: r.employee_name ?? null, deviceId: r.device_id ?? null, deviceLabel: r.device_label ?? null, branchId: r.branch_id ?? null,
      };
    });
    const filtered = f.status ? items.filter((i) => i.status === String(f.status).toUpperCase()) : items;
    return { items: filtered, count: filtered.length, generatedAt: this.now().toISOString() };
  }

  /**
   * The mobile manager report (§107–§110): GROSS card / cash sales, refunds, tips, count, average ticket, by surface —
   * from the canonical payments rows (one sale is one row whatever surface took it, §221). The payout line appears ONLY
   * when payment_settlements holds processor settlement data for the period; gross sales are never called payout.
   */
  async paymentsReport(ctx: Ctx, period: ReportPeriod = '7d'): Promise<MobilePaymentsReport> {
    const now = this.now();
    const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const empty: MobilePaymentsReport = { period, from: from.toISOString(), to: now.toISOString(), grossCardSalesCents: 0, cashSalesCents: 0, otherSalesCents: 0, refundsCents: 0, tipsCents: 0, transactionCount: 0, averageTicketCents: 0, bySurface: [], settlementKnown: false };
    if (!this.db) return empty;
    let q: any = this.db.selectFrom('payments').select(['method', 'payment_surface', 'amount_cents', 'tip_cents', 'status', 'ticket_id'])
      .where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['approved', 'partial']).where('created_at', '>=', from);
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    const rows: any[] = await q.execute().catch(() => []);
    let card = 0, cash = 0, other = 0, tips = 0; const tickets = new Set<string>(); const bySurface = new Map<string, { salesCents: number; count: number }>();
    for (const r of rows) {
      const a = Number(r.amount_cents || 0); tips += Number(r.tip_cents || 0); if (r.ticket_id) tickets.add(String(r.ticket_id));
      if (r.method === 'card') card += a; else if (r.method === 'cash') cash += a; else other += a;
      const s = String(r.payment_surface || 'pos'); const cur = bySurface.get(s) ?? { salesCents: 0, count: 0 }; cur.salesCents += a; cur.count += 1; bySurface.set(s, cur);
    }
    let refq: any = this.db.selectFrom('payment_refunds').select((eb: any) => eb.fn.sum('amount_cents').as('s')).where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', from).where('status', 'in', ['refunded', 'approved', 'succeeded', 'completed']);
    if (ctx.branchId) refq = refq.where('branch_id', '=', ctx.branchId);
    const refunds = Number((await refq.executeTakeFirst().catch(() => null))?.s || 0);
    let setq: any = this.db.selectFrom('payment_settlements').select([(eb: any) => eb.fn.sum('fee_cents').as('fees'), (eb: any) => eb.fn.sum('net_cents').as('net'), (eb: any) => eb.fn.count('id').as('n')]).where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', from);
    if (ctx.branchId) setq = setq.where('branch_id', '=', ctx.branchId);
    const set: any = await setq.executeTakeFirst().catch(() => null);
    const settlementKnown = Number(set?.n || 0) > 0;
    const total = card + cash + other;
    return {
      ...empty, grossCardSalesCents: card, cashSalesCents: cash, otherSalesCents: other, refundsCents: refunds, tipsCents: tips,
      transactionCount: rows.length, averageTicketCents: tickets.size ? Math.round(total / tickets.size) : 0,
      bySurface: [...bySurface.entries()].map(([surface, v]) => ({ surface, ...v })).sort((a, b) => b.salesCents - a.salesCents),
      settlementKnown, ...(settlementKnown ? { processorFeesCents: Number(set.fees || 0), netProcessorPayoutCents: Number(set.net || 0) } : {}),
    };
  }

  // ── Receipts (§97–§102, §167) ─────────────────────────────────────────────────────────────────────────────────────
  /**
   * Send a receipt for a ticket. With the outbox, the request is a `receipt.requested` domain event the receipt consumer
   * delivers through the canonical CheckoutService receipt methods (the tenant's own messenger: its number, opt-outs,
   * ledger) with the consumer runner's retries — Twilio being down never touches the payment and never loses the
   * receipt (§102). Without an outbox (dev / tests) it delivers inline, honestly reporting an unconfigured channel.
   */
  async sendReceipt(ctx: Ctx, ticketId: string, channel: 'sms' | 'email' | 'app') {
    if (this.db && this.x.outbox) {
      try {
        await this.x.outbox.write(this.db, createDomainEvent({ eventType: DOMAIN_EVENTS.RECEIPT_REQUESTED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType: 'ticket', aggregateId: ticketId,
          actorId: ctx.userId ?? undefined, actorType: 'user', correlationId: `ticket:${ticketId}`, payload: { ticketId, channel, requestedBy: ctx.userId ?? null, role: ctx.role ?? null, permissions: ['pos.receipts.send'], surface: TAP_TO_PAY_SURFACE } }));
        this.audit(ctx, 'mobile_receipt_requested', ticketId, { channel });
        return { channel, configured: true, delivery: 'queued' as const, queued: true };
      } catch { /* fall through to inline delivery */ }
    }
    if (channel === 'email') return this.checkout.receiptEmail(ctx, ticketId);
    if (channel === 'app') return this.checkout.receiptApp(ctx, ticketId);
    return this.checkout.receiptSms(ctx, ticketId);
  }

  /** The precise capture gate: the Tap-to-Pay rail is configured for this tenant (credentials + recorded onboarding).
   *  Deliberately NOT the kill switch: a switch flipped after a card was presented must never stop money that the
   *  processor already captured from being recorded / verified (the switch blocks NEW taps at proceed / intent / mint). */
  private async captureRailConfigured(ctx: Ctx, deviceId?: string | null): Promise<boolean> {
    const r = await this.getReadiness(ctx, deviceId ?? undefined);
    const ttp = r.checks?.find((c) => c.key === 'tap_to_pay');
    return !!ttp && ttp.state !== 'setup_required';   // 'ok', or 'unavailable' = the kill switch (money already captured still records)
  }

  // ── Capture bridge (§71–§78, §80–§82, §168–§173) ──────────────────────────────────────────────────────────────────
  /**
   * §72 server bridge — a native Tap-to-Pay capture result reaches the backend. The PROCESSOR, not the on-device SDK
   * callback, is the source of truth: an 'approved' result is finalized/verified with the provider first; only a verified
   * approval becomes money — recorded on the canonical checkout through mobile-capture-recorder in ONE transaction
   * (payments row with surface 'tap_to_pay_iphone', ticket paid or partially paid, payment.captured / checkout.completed on
   * the outbox), then the POS's post-payment work (payroll snapshot, loyalty, gift cards, review request) and the
   * realtime signals the POS and the customer display refresh on. Idempotent: a redelivered result finds the payments row
   * by the attempt's key and records nothing twice. A verified approval whose recording fails leaves the attempt
   * 'unknown' with the processor reference (never 'failed', never re-charged) for the recovery worker.
   *
   * SAFETY: a capture result is accepted only when the Tap-to-Pay rail is actually configured for this tenant. In an
   * environment without CommerceHub/Tap-to-Pay onboarding this refuses, so no "confirmed" capture can be fabricated.
   */
  async applyCaptureResult(ctx: Ctx, idempotencyKey: string, result: { outcome: CaptureOutcome; processorRef?: string; authCode?: string; brand?: string; last4?: string; capturedAmountCents?: number }, deviceId?: string): Promise<{ idempotencyKey: string; from: PaymentAttemptState; to: PaymentAttemptState; outcome: CaptureOutcome; paymentId?: string; ticketPaid?: boolean; remainingCents?: number }> {
    const existing = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: scoped to the caller's location (SD-21)
    if (!existing) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    await this.assertAttemptDeviceProof(ctx, existing);
    const from = existing.status as PaymentAttemptState;
    if (isTerminal(from)) throw withCode(new AttemptError('already_resolved', `This attempt is already ${from} and cannot receive a capture result.`), 'PAYMENT_ATTEMPT_STATE_INVALID');
    // §67/§154: the SDK callback repeated after we already confirmed — answer with the same result, charge nothing
    if (from === 'confirmed') return { idempotencyKey, from, to: 'confirmed', outcome: 'approved', paymentId: existing.paymentId ?? undefined, ticketPaid: undefined };

    if (!(await this.captureRailConfigured(ctx, deviceId ?? existing.deviceId))) throw new AttemptError('TAP_TO_PAY_NOT_AVAILABLE', 'Tap to Pay is not configured on this device; a capture result cannot be recorded.');

    // Server-side verification (spec §14 step 7): when Tap to Pay is configured, the PROCESSOR — not the on-device SDK
    // callback — is the source of truth. finalizeTransaction charges/confirms the captured PaymentSession; a processor
    // that doesn't confirm turns an "approved" SDK result into a decline, and a not-configured / not-yet-wired
    // processor throws (honest — we cannot mark a payment complete we couldn't verify). Never trust the local callback.
    // §67/§154 claim-first: of N concurrent deliveries of the same result, exactly ONE moves the attempt from 'ready' into
    // the reader states (a conditional status write) and goes on to ask the processor; the others see the attempt
    // already moving and get PAYMENT_IN_PROGRESS (or the replay once it is confirmed) — the provider is never asked twice.
    let cur: PaymentAttemptState = from;
    if (from === 'ready') {
      const claimed = await this.attempts.updateStatusIf(ctx.tenantId, idempotencyKey, 'ready', 'reader_initializing');
      if (!claimed) {
        const now = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
        if (now?.status === 'confirmed') return { idempotencyKey, from, to: 'confirmed', outcome: 'approved', paymentId: now.paymentId ?? undefined };
        throw new AttemptError('PAYMENT_IN_PROGRESS', 'This payment result is already being processed. Wait for it to finish.');
      }
      cur = 'reader_initializing';
    }

    let outcome = result.outcome;
    let processorRef = result.processorRef ?? idempotencyKey;
    // Secure Tap to Pay §29: the phone's "approved" is presentation, not money. The amount is the intent's (server-derived),
    // never a number the phone sends; only the PROVIDER's finalize answer may state a different captured amount.
    let capturedCents = existing.amountCents;
    // a result for an attempt that is not at the capture step is refused for what it is (state), before anything else
    try { planCapture(from === 'ready' ? 'reader_initializing' : from, result.outcome); }
    catch (e) { if (e instanceof InvalidTransitionError && from !== 'ready') throw new AttemptError('invalid_state', e.message); }
    if (outcome === 'approved' && !this.ttpSession?.isConfigured()) {
      throw new AttemptError('TAP_TO_PAY_NOT_AVAILABLE', 'Tap to Pay is not configured; an approval cannot be verified with the provider, so it is not recorded.');
    }
    if (outcome === 'approved' && this.ttpSession?.isConfigured()) {
      let fin;
      try {
        fin = await this.ttpSession.finalizeTransaction({ tenantId: ctx.tenantId, idempotencyKey, processorRef, amountCents: capturedCents, merchant: await this.ttpMerchant(ctx) });
      } catch (e) {
        // §74/§129: the customer tapped and the provider did not answer — UNKNOWN, verified later; never a decline, never a retry
        if (e instanceof TapToPayNotConfiguredError || e instanceof TapToPayNotImplementedError) throw e;
        return this.markUnknown(ctx, existing, cur, 'PAYMENT_STATUS_UNKNOWN', processorRef);
      }
      // M6-5 (live pilot): an answer that is neither approved nor declined (a 200 with a PENDING state) is UNKNOWN — the
      // customer may have been charged; it is verified with the provider later, never recorded as a decline (§74 / §232)
      if (!fin.verified && fin.outcome === 'unknown') return this.markUnknown(ctx, existing, cur, 'PAYMENT_STATUS_UNKNOWN', fin.processorRef || processorRef);
      // Oct 28 2026 (mandate audit): only the provider's explicit DECLINED is a decline — an adapter that leaves `outcome` out
      // (or any other non-approved answer) is UNKNOWN and verified later; "not verified" alone must never read as declined
      if (!fin.verified && fin.outcome !== 'declined') return this.markUnknown(ctx, existing, cur, 'PAYMENT_STATUS_UNKNOWN', fin.processorRef || processorRef);
      if (!fin.verified) outcome = 'declined';
      else { processorRef = fin.processorRef || processorRef; capturedCents = fin.capturedAmountCents ?? capturedCents; }
    }

    let plan: PaymentAttemptState[];
    try { plan = planCapture(cur, outcome); }
    catch (e) { if (e instanceof InvalidTransitionError) throw new AttemptError('invalid_state', e.message); throw e; }
    const target = finalStateOf(plan, cur);

    if (outcome === 'approved' && target === 'confirmed') {
      // the money: ONE transaction on the canonical checkout (idempotent on the attempt key)
      let rec: RecordTenderResult | null = null;
      if (this.x.recorder) {
        try { rec = await this.x.recorder.recordTender(ctx, { ticketId: existing.ticketId, idempotencyKey, amountCents: capturedCents, method: 'card', surface: TAP_TO_PAY_SURFACE, deviceId: deviceId ?? existing.deviceId ?? null, processorRef, cardBrand: result.brand, cardLast4: result.last4 }); }
        catch (e) {
          // the processor captured the card and recording failed: unknown (money moved, nothing here shows it) — the recovery worker records it from the processor's answer
          return this.markUnknown(ctx, existing, cur, 'PAYMENT_STATUS_UNKNOWN', processorRef, String((e as Error)?.message ?? e));
        }
      }
      await this.walk(ctx, idempotencyKey, cur, plan);
      await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { processorRef, cardBrand: result.brand ?? null, cardLast4: result.last4 ?? null, paymentId: rec?.paymentId ?? null, lastErrorCode: null });
      if (this.devices && (deviceId ?? existing.deviceId)) await this.devices.touchPayment(ctx.tenantId, (deviceId ?? existing.deviceId)!).catch(() => undefined);
      if (!rec?.duplicate) recordPaymentEvent('approved');
      this.audit(ctx, 'mobile_payment_completed', existing.ticketId, { idempotencyKey, paymentId: rec?.paymentId ?? null, amountCents: capturedCents, brand: result.brand ?? null, last4: result.last4 ?? null, processorRef, ticketPaid: rec?.ticketPaid ?? null, deviceId: deviceId ?? existing.deviceId ?? null });
      if (rec && !rec.duplicate) await this.afterTenderRecorded(ctx, existing.ticketId, rec, 'card');
      return { idempotencyKey, from, to: target, outcome, paymentId: rec?.paymentId, ticketPaid: rec?.ticketPaid, remainingCents: rec?.remainingCents };
    }

    await this.walk(ctx, idempotencyKey, cur, plan);
    const code = outcome === 'declined' ? 'PAYMENT_DECLINED' : 'PAYMENT_STATUS_UNKNOWN';
    await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { processorRef: result.processorRef ?? null, lastErrorCode: code });
    if (this.devices && (deviceId ?? existing.deviceId) && outcome !== 'declined') await this.devices.touchError?.(ctx.tenantId, (deviceId ?? existing.deviceId)!, code).catch(() => undefined);
    recordPaymentEvent(outcome === 'declined' ? 'declined' : 'unknown');
    this.audit(ctx, outcome === 'declined' ? 'mobile_payment_declined' : 'mobile_payment_unresolved', existing.ticketId, { idempotencyKey, outcome, to: target });
    if (target === 'unknown' || target === 'timed_out') {
      this.emit(ctx, EVENTS.paymentVerifying, { ticketId: existing.ticketId, idempotencyKey });
      await this.outboxEvent(ctx, DOMAIN_EVENTS.PAYMENT_UNKNOWN, 'payment_attempt', existing.id, { ticketId: existing.ticketId, idempotencyKey, outcome });
    }
    return { idempotencyKey, from, to: target, outcome };
  }

  /** Apply a planned sequence of lifecycle hops, each a conditional write (a concurrent mover is a conflict, never an overwrite). */
  private async walk(ctx: Ctx, idempotencyKey: string, from: PaymentAttemptState, plan: PaymentAttemptState[]): Promise<PaymentAttemptState> {
    let cur = from;
    for (const next of plan) {
      const ok = await this.attempts.updateStatusIf(ctx.tenantId, idempotencyKey, cur, next);
      if (!ok) throw withCode(new AttemptError('conflict', 'The attempt changed while the result was processed; reload and try again.'), 'PAYMENT_ATTEMPT_STATE_INVALID');
      cur = next;
    }
    return cur;
  }

  private async markUnknown(ctx: Ctx, existing: MobileAttemptView, from: PaymentAttemptState, code: string, processorRef: string, detail?: string) {
    let target: PaymentAttemptState = 'unknown';
    try { const plan = planCapture(from, 'unknown'); target = await this.walk(ctx, existing.idempotencyKey, from, plan); } catch { target = (await this.attempts.findByKey(ctx.tenantId, existing.idempotencyKey))?.status as PaymentAttemptState ?? 'unknown'; }
    await this.attempts.setMeta(ctx.tenantId, existing.idempotencyKey, { processorRef, lastErrorCode: code });
    recordPaymentEvent('unknown');
    this.audit(ctx, 'mobile_payment_unresolved', existing.ticketId, { idempotencyKey: existing.idempotencyKey, processorRef, detail: detail ?? null });
    this.emit(ctx, EVENTS.paymentVerifying, { ticketId: existing.ticketId, idempotencyKey: existing.idempotencyKey });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.PAYMENT_UNKNOWN, 'payment_attempt', existing.id, { ticketId: existing.ticketId, idempotencyKey: existing.idempotencyKey, processorRef });
    return { idempotencyKey: existing.idempotencyKey, from, to: target, outcome: 'unknown' as CaptureOutcome };
  }

  /**
   * §76 reconciliation — resolve an attempt whose result was unresolved (`unknown`/`timed_out`) or already at
   * `reconciliation_required`, once the processor's settlement/webhook is known. A 'confirmed' resolution RECORDS the
   * money (same recorder, same idempotency) when it was not recorded yet — it needs the processor reference. Same
   * safety gate as the capture bridge.
   */
  async reconcileAttempt(ctx: Ctx, idempotencyKey: string, resolution: ReconcileResolution, meta: { processorRef?: string; brand?: string; last4?: string; capturedAmountCents?: number } = {}): Promise<{ idempotencyKey: string; from: PaymentAttemptState; to: PaymentAttemptState; resolution: ReconcileResolution; paymentId?: string }> {
    const existing = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: scoped to the caller's location (SD-21)
    if (!existing) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    const from = existing.status as PaymentAttemptState;

    if (!(await this.captureRailConfigured(ctx, existing.deviceId))) throw new AttemptError('TAP_TO_PAY_NOT_AVAILABLE', 'Tap to Pay is not configured on this device.');

    let target: PaymentAttemptState;
    try { target = finalStateOf(planReconciliation(from, resolution), from); }
    catch (e) { if (e instanceof InvalidTransitionError) throw new AttemptError('invalid_state', e.message); throw e; }

    let paymentId: string | undefined = existing.paymentId ?? undefined;
    if (resolution === 'confirmed' && !existing.paymentId && this.x.recorder) {
      const processorRef = meta.processorRef || existing.processorRef;
      if (!processorRef) throw withCode(new AttemptError('invalid', 'A processor reference is required to confirm a payment that was never verified.'), 'PROCESSOR_REFERENCE_REQUIRED');
      const rec = await this.x.recorder.recordTender(ctx, { ticketId: existing.ticketId, idempotencyKey, amountCents: meta.capturedAmountCents ?? existing.amountCents, method: 'card', surface: TAP_TO_PAY_SURFACE, deviceId: existing.deviceId ?? null, processorRef, cardBrand: meta.brand ?? existing.cardBrand ?? undefined, cardLast4: meta.last4 ?? existing.cardLast4 ?? undefined });
      paymentId = rec.paymentId;
      if (!rec.duplicate) await this.afterTenderRecorded(ctx, existing.ticketId, rec, 'card');
    }
    await this.walk(ctx, idempotencyKey, from, planReconciliation(from, resolution));
    await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { paymentId: paymentId ?? null, processorRef: meta.processorRef ?? existing.processorRef ?? null, cardBrand: meta.brand ?? existing.cardBrand ?? null, cardLast4: meta.last4 ?? existing.cardLast4 ?? null, lastErrorCode: resolution === 'confirmed' ? null : resolution === 'declined' ? 'PAYMENT_DECLINED' : 'PAYMENT_CANCELED' });
    this.audit(ctx, 'mobile_payment_status_recovered', existing.ticketId, { idempotencyKey, from, to: target, resolution, paymentId: paymentId ?? null });
    this.emit(ctx, EVENTS.paymentRecovered, { ticketId: existing.ticketId, idempotencyKey, resolution });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.PAYMENT_RECOVERED, 'payment_attempt', existing.id, { ticketId: existing.ticketId, idempotencyKey, resolution, paymentId: paymentId ?? null });
    return { idempotencyKey, from, to: target, resolution, paymentId };
  }

  /**
   * §76–§78 "verify": ask the provider what became of an unresolved attempt and act ONLY on its answer (the recovery
   * worker calls this for every stale unresolved attempt; the app's Verifying screen calls it on demand). Never charges,
   * never guesses: approved → recorded + confirmed; declined → declined; nothing at the processor past the window →
   * failed (the key is free again); no inquiry / unreachable → unchanged.
   */
  async verifyAttempt(ctx: Ctx, idempotencyKey: string, opts: { notFoundReleaseMs?: number } = {}): Promise<{ status: PaymentAttemptState; decision: RecoveryDecision; paymentId?: string }> {
    const existing = await this.attempts.findByKeyInBranch(ctx, idempotencyKey);   // Oct 28 audit: scoped to the caller's location (SD-21)
    if (!existing) throw withCode(new AttemptError('not_found', 'Payment attempt not found.'), 'PAYMENT_ATTEMPT_NOT_FOUND');
    const from = existing.status as PaymentAttemptState;
    if (!UNRESOLVED.includes(from)) return { status: from, decision: { action: 'wait', reason: 'nothing to verify in this state' } };
    let lookup: TapToPayLookup;
    try { lookup = await this.port().lookupTransaction({ tenantId: ctx.tenantId, idempotencyKey, processorRef: existing.processorRef, amountCents: existing.amountCents, merchant: await this.ttpMerchant(ctx) }); }
    catch (e) { if (e instanceof TapToPayNotConfiguredError || e instanceof TapToPayNotImplementedError) lookup = { kind: 'no_inquiry' }; else lookup = { kind: 'unreachable', error: String((e as Error)?.message ?? e).slice(0, 200) }; }
    const decision = decideRecovery(lookup, { ageMs: this.now().getTime() - Date.parse(existing.updatedAt), notFoundReleaseMs: opts.notFoundReleaseMs });
    if (decision.action === 'confirm') {
      const r = await this.reconcileAttempt(ctx, idempotencyKey, 'confirmed', { processorRef: decision.processorRef, brand: decision.cardBrand, last4: decision.cardLast4, capturedAmountCents: decision.capturedAmountCents });
      return { status: r.to, decision, paymentId: r.paymentId };
    }
    if (decision.action === 'decline') { const r = await this.reconcileAttempt(ctx, idempotencyKey, 'declined', { processorRef: decision.processorRef }); return { status: r.to, decision }; }
    if (decision.action === 'release') {
      // nothing ever reached the processor: the attempt is failed (retryable) — the idempotency key is released for a new intent
      const to: PaymentAttemptState = from === 'unknown' || from === 'timed_out' || from === 'reconciliation_required' ? 'canceled' : 'failed';
      const ok = await this.attempts.updateStatusIf(ctx.tenantId, idempotencyKey, existing.status, to);
      if (ok) { await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { lastErrorCode: 'PAYMENT_CANCELED' }); this.audit(ctx, 'mobile_payment_status_recovered', existing.ticketId, { idempotencyKey, from, to, resolution: 'not_found' }); this.emit(ctx, EVENTS.paymentRecovered, { ticketId: existing.ticketId, idempotencyKey, resolution: 'not_found' }); }
      return { status: ok ? to : from, decision };
    }
    return { status: from, decision };
  }

  // ── Ticket composition (Jul 28, 2026 — TapPay prototype pass) ──────────────────────────────────────────────────
  // The prototype's "Add Retail Product" and "Add Discount" are thin delegates to the CANONICAL engines — the same
  // pattern as refund/void. Prices come from the tenant catalog (a client can never name its own price), discounts
  // go through checkout.applyDiscount (caps, reason, audit), and the POS sees the change instantly because there is
  // only one ticket.
  async retailCatalog(ctx: unknown, search?: string) {
    if (!this.serving) throw withCode(new AttemptError('not_available', 'Retail catalog is not available on this build.'), 'FEATURE_NOT_AVAILABLE');
    return this.serving.retailCatalog(ctx as never, search);
  }

  async addRetailToTicket(ctx: unknown, ticketId: string, body: { productId?: string; quantity?: number; managerPin?: string }) {
    if (!this.serving) throw withCode(new AttemptError('not_available', 'Retail sales are not available on this build.'), 'FEATURE_NOT_AVAILABLE');
    const r = await this.serving.addRetail(ctx as never, ticketId, { productId: body?.productId, quantity: body?.quantity, managerPin: body?.managerPin });   // B-19
    await this.restampOwnClaim(ctx as Ctx, ticketId);   // M6-6: the claim holder's own edit keeps its claim current
    return r;
  }

  async applyTicketDiscount(ctx: unknown, ticketId: string, body: { discountCents?: number; reason?: string; managerPin?: string }) {
    const r = await this.checkout.applyDiscount(ctx as never, ticketId, { discountCents: Number(body?.discountCents) || 0, reason: body?.reason, managerPin: body?.managerPin });
    this.audit(ctx as Ctx, 'mobile_discount_applied', ticketId, { discountCents: Number(body?.discountCents) || 0 }, body?.reason ?? null);
    await this.restampOwnClaim(ctx as Ctx, ticketId);   // M6-6: the claim holder's own edit keeps its claim current
    return r;
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private async userNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    if (!this.db || !ids.length) return m;
    try {
      const rows: any[] = await this.db.selectFrom('users').select(['id', 'full_name', 'first_name', 'last_name']).where('tenant_id', '=', tenantId).where('id', 'in', [...new Set(ids)]).execute();
      for (const r of rows) m.set(String(r.id), String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim());
    } catch { /* names are a courtesy */ }
    return m;
  }
}

/** §37/§104 "customer safe name": first name + last initial (never the full record, never the phone). */
export function safeName(full: string | null | undefined): string {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Walk-in';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Tap to Pay attempt states where the phone is actively talking to the reader / processor (a tap in progress). */
const MOBILE_ACTIVE_STATES: ReadonlySet<string> = new Set(['reader_initializing', 'awaiting_customer_tap', 'card_detected']);
/** States that have not reached the processor — they reserve balance but block no other tender here. */
const MOBILE_PRE_PROCESSOR_STATES: ReadonlySet<string> = new Set(['created', 'readiness_checking', 'ready']);

/**
 * M6-6 (§33 / §34 / §64), pure: what the unsettled-tender view means for a phone that wants to start a charge or record
 * cash. UNKNOWN beats IN_PROGRESS: a POS card 'processing', a split reservation 'processing', an app charge sent to the
 * processor, or a Tap to Pay attempt past the tap (authorization / confirmation / unknown / reconciliation) may already
 * have charged the card → PAYMENT_STATUS_UNKNOWN. A tap in progress on a phone → PAYMENT_IN_PROGRESS.
 */
export function mobileUnsettledBlock(tenders: readonly UnsettledTender[], exceptKey?: string | null): { code: 'PAYMENT_STATUS_UNKNOWN' | 'PAYMENT_IN_PROGRESS'; kind: string; status: string } | null {
  let inProgress: { kind: string; status: string } | null = null;
  for (const t of tenders) {
    if (t.kind === 'attempt' && exceptKey && t.idempotencyKey === exceptKey) continue;
    if (t.kind === 'attempt' && MOBILE_PRE_PROCESSOR_STATES.has(t.status)) continue;
    if (t.kind === 'attempt' && MOBILE_ACTIVE_STATES.has(t.status)) { inProgress = inProgress ?? { kind: t.kind, status: t.status }; continue; }
    return { code: 'PAYMENT_STATUS_UNKNOWN', kind: t.kind, status: t.status };
  }
  return inProgress ? { code: 'PAYMENT_IN_PROGRESS', ...inProgress } : null;
}

