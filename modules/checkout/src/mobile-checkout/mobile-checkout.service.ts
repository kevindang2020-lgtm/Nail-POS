// mobile-checkout.service.ts — the Owner & Manager Payment App backend (the mandate's "Owner/Manager Payment App → Existing
// Checkout API → Existing Payment Domain → TapToPay capability", §3). ONE checkout, ONE payment domain: every read is the
// canonical CheckoutService / repository, every tender becomes money through mobile-capture-recorder (the same
// repository the POS and the customer-display terminal use), refunds / voids / receipts / discounts / retail delegate to
// the canonical engines. This file owns the PaymentIntent lifecycle (payment_attempts, method 'tap_to_pay'), the device
// trust gate (§12–§14), the claim (§41–§47, the checkout lock), version conflicts (§55), the kill switches (§197–§199),
// unknown-result recovery (§74–§78) and the history / report projections (§103–§110). It never talks to a processor SDK:
// the TapToPaySessionPort does, and only when it is really configured (never a fabricated token or success, §211).

import type { ProceedResult, MobilePaymentHistoryFilter, MobilePaymentHistoryResult, MobilePaymentHistoryRow, MobilePaymentsReport, MobilePayDeviceView, TapToPayCapabilityView, CheckoutClaimView } from '@aipowersalon/api-contracts/tenant';
export type { ProceedResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { branchTimeZone, type AppDatabase } from '@aipowersalon/database';
import type { Ctx } from '@aipowersalon/permissions';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { DOMAIN_EVENTS, createDomainEvent, type OutboxWriter } from '@aipowersalon/events';
import { CheckoutService } from '../checkout/checkout.service';
import type { ServingService } from '@aipowersalon/queue';
import { tapToPayConfigured, FISERV_COMMERCEHUB_TTP_CAPABILITIES } from './ttp-config';
import { tenantTapToPayConfigured, type TtpOnboardingStore, type TtpOnboardingRecord, type TtpOnboardingInput } from './ttp-onboarding';
import { computeDeviceFacts, effectiveMinAppVersion, readMobilePayMinVersion, DeviceBindingError, MOBILE_PAY_DEVICE_STATUSES, type MobilePayDeviceStore, type MobilePayDeviceRecord, type MobilePayDeviceStatus, type RegisterDeviceInput } from './mobile-pay-device';
import { NoopTapToPaySessionAdapter, TapToPayNotConfiguredError, TapToPayNotImplementedError, type DeviceSession, type TapToPaySessionPort, type TapToPayLookup } from './tap-to-pay-session';
import { computeReadiness, type ReadinessFacts, type ReadinessReport, type GatewayStatus } from './mobile-checkout-readiness';
import { mapMobileQueue, type MobileQueueResult, type MobileQueueOpts } from './mobile-checkout-queue';
import { mapMobileTicketDetail, type MobileTicketDetail } from './mobile-checkout-ticket';
import { CheckoutLockService, type LockResult, type LockStatus } from '../checkout-lock/checkout-lock.service';
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
import { randomUUID } from 'node:crypto';
import { recordPaymentEvent } from '@aipowersalon/observability';   // TTP §143–§144: the ONE payment business counter (bounded vocabulary)
import { hasPermission, isPlatformPrincipal } from '@aipowersalon/permissions';
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

export interface MobileCheckoutExtras {
  recorder?: MobileCaptureRecorderPort;
  push?: MobilePushPort;
  realtime?: RealtimeEmitter;
  audit?: MobileAuditPort;
  killSwitch?: TapToPayKillSwitchPort;
  outbox?: OutboxWriter | null;
  stepUp?: StepUpReadPort;
  now?: () => Date;
}

function normalizeStartIso(val?: string): string | undefined {
  if (!val) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00.000Z`;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function normalizeEndIso(val?: string): string | undefined {
  if (!val) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T23:59:59.999Z`;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

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
  private port(): TapToPaySessionPort { return this.ttpSession ?? new NoopTapToPaySessionAdapter(); }
  private audit(ctx: Ctx, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}, reason?: string | null): void {
    try { this.x.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, userId: ctx.userId ?? null, role: ctx.role ?? null }, { module: 'mobile_checkout', action, resourceType: 'mobile_checkout', resourceId, metadata, reason: reason ?? null }); } catch { /* audit never breaks the operation */ }
  }
  // a screen signal (claim / verifying / device / sent-to-phone); the FACTS travel as outbox domain events (outboxEvent below)
  private emit(ctx: Ctx, event: (typeof EVENTS)[keyof typeof EVENTS], payload: Record<string, unknown>): void { try { this.x.realtime?.toTenant(ctx, event, payload); } catch { /* a signal, never the fact */ } }
  /** A domain event on the outbox (§175). Only with a database and a writer; never blocks the operation. */
  private async outboxEvent(ctx: Ctx, eventType: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.db || !this.x.outbox) return;
    try {
      await this.x.outbox.write(this.db as any, createDomainEvent({ eventType: eventType as any, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType, aggregateId, actorId: ctx.userId ?? undefined, actorType: ctx.userId ? 'user' : 'system', correlationId: `mobile:${aggregateId}`, payload }));
    } catch { /* the business write stands; the realtime signal still went */ }
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
    const killed = this.x.killSwitch ? await this.x.killSwitch.disabledReason(this.port().provider).catch(() => null) : null;
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
    if (!deviceId) throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'This phone is not registered to take payments.');
    const rec = await this.devices.get(ctx.tenantId, deviceId).catch(() => null);
    const facts = computeDeviceFacts(rec, { requiredBranchId: ctx.branchId || null, requiredUserId: ctx.userId || null });
    if (!facts.deviceApproved) {
      await this.devices.touchError?.(ctx.tenantId, deviceId, facts.blockReason ?? 'DEVICE_NOT_AUTHORIZED').catch(() => undefined);
      throw new AttemptError(facts.blockReason ?? 'DEVICE_NOT_AUTHORIZED', facts.blockReason === 'DEVICE_REVOKED' ? 'This phone’s payment access has been revoked.' : 'This phone is not authorized to take payments for this salon.');
    }
    return rec;
  }
  private async assertTapToPayOn(): Promise<void> {
    const killed = this.x.killSwitch ? await this.x.killSwitch.disabledReason(this.port().provider).catch(() => null) : null;
    if (killed) throw new AttemptError('TAP_TO_PAY_DISABLED', killed === 'platform' ? 'Tap to Pay is currently switched off by the platform. Use the terminal, cash or another payment option.' : 'Tap to Pay through this provider is currently switched off. Use the terminal, cash or another payment option.');
  }

  // ── Device registry (§12–§14, §123, §138–§141, §145) ──────────────────────────────────────────────────────────────
  /** The Manager Pay app registers its stable per-install device id on sign-in. Always lands 'pending' — an owner/Super
   *  Admin must approve before it can take payment; the install is BOUND to this user. Returns the record. */
  async registerDevice(ctx: Ctx, input: Omit<RegisterDeviceInput, 'registeredBy'>): Promise<MobilePayDeviceRecord> {
    if (!this.devices) throw new AttemptError('unavailable', 'Device registry is not available.');
    if (!input.deviceId) throw new AttemptError('invalid', 'A deviceId is required.');
    // Developer merge (Oct 6 2026): an EMPTY branch / user id ('' from a session without a branch, a kiosk principal)
    // reached the UUID columns as '' and the insert failed — '' is "none", so it falls through to the session's branch / null.
    let rec: MobilePayDeviceRecord;
    try { rec = await this.devices.upsertOnRegister(ctx.tenantId, { ...input, branchId: input.branchId || ctx.branchId || null, registeredBy: ctx.userId || null }); }
    catch (e) { if (e instanceof DeviceBindingError) throw new AttemptError(e.code, e.message); throw e; }
    this.audit(ctx, 'mobile_pay_device_registered', rec.deviceId, { status: rec.status, platform: rec.platform, appVersion: rec.appVersion, tapToPayCapable: rec.tapToPayCapable });
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId: rec.deviceId, status: rec.status });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REGISTERED, 'mobile_pay_device', rec.deviceId, { deviceId: rec.deviceId, status: rec.status, platform: rec.platform });
    return rec;
  }

  /** List a tenant's registered Tap to Pay devices (Super Admin oversight). */
  async listDevices(tenantId: string): Promise<MobilePayDeviceRecord[]> {
    if (!this.devices) return [];
    return this.devices.list(tenantId);
  }

  /** Approve or revoke a device. SUPER_ADMIN only (platform operator); explicit target tenant since SA is tenant-less. */
  async setDeviceStatus(ctx: Ctx, tenantId: string, deviceId: string, status: MobilePayDeviceStatus, reason?: string | null): Promise<MobilePayDeviceRecord> {
    if (!isPlatformPrincipal(ctx)) throw new AttemptError('forbidden', 'Only a platform Super Admin can approve or revoke a payment device.');
    if (!this.devices) throw new AttemptError('unavailable', 'Device registry is not available.');
    if (!MOBILE_PAY_DEVICE_STATUSES.includes(status)) throw new AttemptError('invalid', 'Unknown device status.');
    const rec = await this.devices.setStatus(tenantId, deviceId, status, ctx.userId, reason ?? null);
    if (!rec) throw new AttemptError('not_found', 'That device is not registered for this tenant.');
    const scope = { tenantId, branchId: rec.branchId ?? '', userId: ctx.userId, role: ctx.role, permissions: [] } as Ctx;
    this.audit(scope, status === 'active' ? 'mobile_pay_device_activated' : 'mobile_pay_device_revoked', deviceId, { status, by: 'super_admin' }, reason);
    this.emit(scope, EVENTS.mobilePayDeviceUpdated, { deviceId, status });
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
    if (!hasPermission(ctx as any, 'pos.devices.manage')) throw new AttemptError('forbidden', 'Only the salon owner can approve or revoke a payment device.');
    if (!this.devices) throw new AttemptError('unavailable', 'Device registry is not available.');
    if (!MOBILE_PAY_DEVICE_STATUSES.includes(status)) throw new AttemptError('invalid', 'Unknown device status.');
    const rec = await this.devices.setStatus(ctx.tenantId, deviceId, status, ctx.userId, reason ?? null);
    if (!rec) throw new AttemptError('not_found', 'That device is not registered for this salon.');
    this.audit(ctx, status === 'active' ? 'mobile_pay_device_activated' : 'mobile_pay_device_revoked', deviceId, { status }, reason);
    this.emit(ctx, EVENTS.mobilePayDeviceUpdated, { deviceId, status });
    if (status !== 'active' && status !== 'pending') await this.outboxEvent(ctx, DOMAIN_EVENTS.MOBILE_PAYMENT_DEVICE_REVOKED, 'mobile_pay_device', deviceId, { deviceId, status, reason: reason ?? null });
    return rec;
  }

  /** §17 (step-up at the controller) + §14: reassign a phone to another user of this salon — back to 'pending'. */
  async rebindMyDevice(ctx: Ctx, deviceId: string, userId: string): Promise<MobilePayDeviceRecord> {
    if (!hasPermission(ctx as any, 'pos.devices.manage')) throw new AttemptError('forbidden', 'Only the salon owner can reassign a payment device.');
    if (!this.devices?.rebind) throw new AttemptError('unavailable', 'Device registry is not available.');
    if (!userId) throw new AttemptError('invalid', 'A userId is required.');
    const rec = await this.devices.rebind(ctx.tenantId, deviceId, userId, ctx.userId);
    if (!rec) throw new AttemptError('not_found', 'That device is not registered for this salon.');
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
    try { await this.devices.upsertOnRegister(ctx.tenantId, { deviceId, appVersion: appVersion ?? null, registeredBy: ctx.userId || null }); return { ok: true }; }
    catch (e) { if (e instanceof DeviceBindingError) throw new AttemptError(e.code, e.message); return { ok: false }; }
  }

  // ── Branch switch (§120) ───────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Mandate §120: "active payment must finish/cancel before switching". Asked by the platform's ONE branch switch
   * (POST /auth/select-branch → identity BRANCH_SWITCH_GUARD) before it re-scopes a session. Active, in the branch the
   * session is in now: an unreleased, unexpired MOBILE claim held by this person OR this phone, or a Tap to Pay attempt
   * on this phone that is created (unexpired, §132) / in flight / unresolved. Null = nothing to finish.
   */
  async branchSwitchBlock(who: { tenantId: string; branchId: string | null; userId: string; deviceId?: string | null }): Promise<{ code: 'PAYMENT_IN_PROGRESS'; kind: 'claim' | 'attempt'; ticketId: string; message: string } | null> {
    if (!who.tenantId || !who.branchId) return null;   // no branch yet (first pick after sign-in) — nothing can be active
    const now = this.now();
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
    let q: any = (this.db as any).selectFrom('checkout_locks as l')
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

  /** §150: the front desk sends a checkout to a specific phone — a push to its bound user + the realtime nudge. The queue
   *  stays the source of truth (the phone still has to claim it; §151 only one may). */
  async sendToDevice(ctx: Ctx, ticketId: string, deviceId: string): Promise<{ sent: boolean; reason?: string }> {
    if (!hasPermission(ctx as any, 'pos.checkout.take_payment')) throw new AttemptError('forbidden', 'Missing pos.checkout.take_payment.');
    const detail = await this.checkout.detail(ctx as any, ticketId);
    const dev = this.devices ? await this.devices.get(ctx.tenantId, deviceId).catch(() => null) : null;
    if (!dev || dev.status !== 'active') throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'That phone is not an active payment device for this salon.');
    if (dev.branchId && ctx.branchId && dev.branchId !== ctx.branchId) throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'That phone belongs to another location.');
    this.emit(ctx, EVENTS.checkoutSentToMobile, { ticketId, deviceId, userId: dev.boundUserId ?? null });
    this.audit(ctx, 'checkout_sent_to_mobile', ticketId, { deviceId, userId: dev.boundUserId ?? null });
    if (!this.x.push || !dev.boundUserId) return { sent: false, reason: 'no_push_target' };
    try {
      // §135: no amounts beyond the total, no customer details in the push — ids and a label only
      await this.x.push.dispatchToUser(ctx.tenantId, dev.boundUserId, { title: 'Checkout ready to pay', body: `Ticket #${detail.ticketNumber} is ready for payment on your phone.`, data: { route: 'checkout', ticketId }, category: 'PAYMENT_ALERT' });
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
    const attempt = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!attempt) throw new AttemptError('not_found', 'No such payment attempt.');
    if (attempt.status !== 'ready') throw new AttemptError('invalid', `A device session can only be minted for a ready attempt (this one is '${attempt.status}').`);
    await this.assertTapToPayOn();
    await this.assertDeviceTrusted(ctx, deviceId ?? attempt.deviceId);
    await this.assertAttemptStillCurrent(ctx, attempt);
    const port = this.port();
    return port.mintDeviceSession({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, idempotencyKey, amountCents: attempt.amountCents, currency: attempt.currency || 'USD', deviceId: deviceId ?? attempt.deviceId ?? null });
  }

  /** §55 / §155–§156: the ticket's version and balance must still match what the intent was created for. */
  private async assertAttemptStillCurrent(ctx: Ctx, attempt: MobileAttemptView): Promise<void> {
    if (!attempt.checkoutVersion) return;   // an intent made before versions existed (or seeded directly) carries nothing to compare
    const detail = await this.getTicketDetail(ctx, attempt.ticketId);
    const inFlightOthers = (await this.attempts.listForTicket(ctx, attempt.ticketId)).filter((a) => a.idempotencyKey !== attempt.idempotencyKey && a.status !== 'confirmed' && (a.status === 'created' || blocksNewAttempt(a.status as PaymentAttemptState))).reduce((s, a) => s + a.amountCents, 0);
    const stale = (attempt.checkoutVersion && attempt.checkoutVersion !== detail.version) || attempt.amountCents > detail.balanceDueCents - inFlightOthers;
    if (stale) {
      await this.attempts.setMeta(ctx.tenantId, attempt.idempotencyKey, { lastErrorCode: 'CHECKOUT_VERSION_CONFLICT' });
      this.audit(ctx, 'mobile_checkout_version_conflict', attempt.ticketId, { idempotencyKey: attempt.idempotencyKey, attemptAmountCents: attempt.amountCents, balanceDueCents: detail.balanceDueCents, attemptVersion: attempt.checkoutVersion, currentVersion: detail.version });
      throw new AttemptError('CHECKOUT_VERSION_CONFLICT', 'This checkout changed at the front desk. The amount has been refreshed — please review it before charging.');
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
    if (!isPlatformPrincipal(ctx)) throw new AttemptError('forbidden', 'Only a platform Super Admin can record Tap to Pay onboarding status.');
    if (!this.onboarding) throw new AttemptError('unavailable', 'Onboarding store is not available.');
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
    const state = await this.checkout.getState(ctx as any, {});
    return mapMobileQueue(state.tickets.items, opts);
  }

  /**
   * Ticket detail (second reference screen). REUSES CheckoutService.detail — the same canonical services, totals, and
   * customer the POS shows, scoped server-side; the canonical detail() also re-checks pos.checkout.view and audit-logs
   * the view. The phone is masked in the projection. Carries the checkout VERSION (§55), what the canonical payments
   * already cover (§48 Paid / Balance Due) and the active claim (§45–§46).
   */
  async getTicketDetail(ctx: Ctx, ticketId: string, sessionId?: string): Promise<MobileTicketDetail> {
    const detail = await this.checkout.detail(ctx as any, ticketId);
    const paid = await this.checkout.paidCentsFor(ctx as any, ticketId).catch(() => 0);
    const mapped = mapMobileTicketDetail(detail, { paidCents: paid });
    mapped.claim = await this.claimView(ctx, ticketId, sessionId).catch(() => null);
    return mapped;
  }

  /** §45–§46: the active claim as a screen shows it (labels, never PII). */
  async claimView(ctx: Ctx, ticketId: string, sessionId?: string): Promise<CheckoutClaimView | null> {
    const s = await this.locks.getStatus(ctx.tenantId, ticketId, sessionId, this.now());
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
    await this.checkout.detail(ctx as any, ticketId); // eligibility + tenant scope (canonical, audited)
    if (deviceId && this.devices) {
      // a revoked / foreign phone cannot even claim (§163) — a pending one may open the ticket read-only but not pay
      const rec = await this.devices.get(ctx.tenantId, deviceId).catch(() => null);
      const f = computeDeviceFacts(rec, { requiredBranchId: ctx.branchId || null, requiredUserId: ctx.userId || null });
      if (f.blockReason === 'DEVICE_REVOKED') throw new AttemptError('DEVICE_REVOKED', 'This phone’s payment access has been revoked.');
      if (rec?.boundUserId && ctx.userId && rec.boundUserId !== ctx.userId) throw new AttemptError('DEVICE_NOT_AUTHORIZED', 'This phone is registered to another user.');
    }
    const r = await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: ctx.userId, deviceId, sessionId, source: 'mobile' }, this.now());
    if (r.action !== 'refreshed') {
      this.audit(ctx, 'checkout_payment_claimed', ticketId, { deviceId: deviceId ?? null, action: r.action, expiresAt: r.expiresAt });
      this.emit(ctx, EVENTS.checkoutPaymentClaimed, { ticketId, source: 'mobile', userId: ctx.userId, deviceId: deviceId ?? null, expiresAt: r.expiresAt });
      await this.outboxEvent(ctx, DOMAIN_EVENTS.CHECKOUT_PAYMENT_CLAIMED, 'ticket', ticketId, { ticketId, source: 'mobile', deviceId: deviceId ?? null, action: r.action, expiresAt: r.expiresAt });
    }
    return r;
  }

  refreshLock(ctx: Ctx, ticketId: string, sessionId: string): Promise<LockResult> {
    return this.locks.refresh(ctx.tenantId, ticketId, sessionId, this.now());
  }

  async releaseLock(ctx: Ctx, ticketId: string, sessionId: string, reason?: string): Promise<{ released: boolean }> {
    const r = await this.locks.release(ctx.tenantId, ticketId, sessionId, reason);
    if (r.released) this.emit(ctx, EVENTS.checkoutPaymentClaimReleased, { ticketId, source: 'mobile', reason: reason ?? null });
    return r;
  }

  lockStatus(ctx: Ctx, ticketId: string, sessionId?: string): Promise<LockStatus> {
    return this.locks.getStatus(ctx.tenantId, ticketId, sessionId, this.now());
  }

  /**
   * §46 authorized takeover: a manager with checkout.manage_overrides takes the claim from the POS / another phone — only
   * when NO card attempt is in flight on the ticket (PAYMENT_IN_PROGRESS otherwise: a tap that may be mid-authorization
   * is never pulled away). Audited with the reason; the previous holder's screen learns it by realtime.
   */
  async takeoverLock(ctx: Ctx, ticketId: string, deviceId: string | undefined, sessionId: string, reason: string): Promise<LockResult> {
    if (!hasPermission(ctx as any, 'checkout.manage_overrides')) throw new AttemptError('forbidden', 'Taking over a checkout needs the manager override permission.');
    if (!String(reason ?? '').trim()) throw new AttemptError('invalid', 'A reason is required to take over a checkout.');
    await this.checkout.detail(ctx as any, ticketId);
    const inFlight = (await this.attempts.listForTicket(ctx, ticketId)).some((a) => a.status !== 'created' && a.status !== 'ready' && blocksNewAttempt(a.status as PaymentAttemptState));
    if (inFlight) throw new AttemptError('PAYMENT_IN_PROGRESS', 'A card payment is being processed on this ticket right now. Wait for it to finish or be verified.');
    const cur = await this.locks.getStatus(ctx.tenantId, ticketId, sessionId, this.now());
    if (cur.locked && !cur.ownedByCaller) await this.locks.forceRelease(ctx.tenantId, ticketId, 'takeover:' + String(reason).slice(0, 80));
    const r = await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: ctx.userId, deviceId, sessionId, source: 'mobile' }, this.now());
    this.audit(ctx, 'checkout_payment_claim_taken_over', ticketId, { from: cur.heldBy?.source ?? null, deviceId: deviceId ?? null }, reason);
    this.emit(ctx, EVENTS.checkoutPaymentClaimed, { ticketId, source: 'mobile', userId: ctx.userId, deviceId: deviceId ?? null, expiresAt: r.expiresAt, takeover: true });
    await this.outboxEvent(ctx, DOMAIN_EVENTS.CHECKOUT_PAYMENT_CLAIMED, 'ticket', ticketId, { ticketId, source: 'mobile', deviceId: deviceId ?? null, action: 'takeover', reason });
    return r;
  }

  // ── Proceed / intent (§54–§56, §64–§68, §132, §184) ───────────────────────────────────────────────────────────────
  /**
   * "Proceed to payment" gate (spec §14). Gathers the real facts — readiness (so Tap to Pay being SetupRequired blocks),
   * whether the caller holds the lock, the ticket balance (what the canonical payments do not yet cover), the validated
   * tip/split, the checkout version (§55) and the step-up threshold (§184) — and returns the honest decision. NO money
   * moves: when the gate is green it attaches a fresh idempotency key + the 'created' attempt state so the eventual
   * capture is replay-safe.
   */
  async evaluateProceed(ctx: Ctx, ticketId: string, opts: { sessionId: string; deviceId?: string; tip?: TipPreset; segments?: SplitSegmentPlan[]; expectedVersion?: string }): Promise<ProceedResult> {
    const [readiness, lock] = await Promise.all([
      this.getReadiness(ctx, opts.deviceId),   // device approval + Tap to Pay onboarding gate the real payment path
      this.locks.getStatus(ctx.tenantId, ticketId, opts.sessionId, this.now()),
    ]);
    let detail = await this.getTicketDetail(ctx, ticketId);
    let balanceCents = detail.balanceDueCents;
    let subtotalCents = detail.totals.subtotalCents;
    if (opts.expectedVersion && opts.expectedVersion !== detail.version) {
      return { canProceed: false, reason: 'CHECKOUT_VERSION_CONFLICT', message: 'This checkout changed at the front desk. Review the refreshed amount before charging.', balanceCents, version: detail.version };
    }
    const tip = opts.tip !== undefined ? computeTip(subtotalCents, opts.tip) : undefined;
    if (opts.tip !== undefined && tip && tip.ok) {
      const tipMeta = typeof opts.tip === 'object' && 'customCents' in opts.tip
        ? { tipType: 'custom' as const, tipAmountCents: tip.tipCents }
        : opts.tip === 'none'
        ? { tipType: 'custom' as const, tipAmountCents: 0 }
        : { tipType: 'percent' as const, tipPercent: typeof opts.tip === 'string' && opts.tip.startsWith('p') ? parseInt(opts.tip.slice(1), 10) : 0 };
      await this.checkout.applyTip(ctx as any, ticketId, { ...tipMeta, source: 'front_desk' }).catch(() => {});
      detail = await this.getTicketDetail(ctx, ticketId).catch(() => detail);
      balanceCents = detail.balanceDueCents;
      subtotalCents = detail.totals.subtotalCents;
    }
    const split = opts.segments !== undefined ? validateSplitPlan(opts.segments, balanceCents) : undefined;

    const decision = decideProceed({
      canTakePayment: readiness.canTakePayment,
      readinessOverall: readiness.overall,
      lockOwnedByCaller: lock.ownedByCaller,
      balanceCents, tip, split,
    });
    if (!decision.canProceed) return { ...decision, version: detail.version };
    // §184 high-value step-up: at or above the threshold the session must have re-proved itself recently
    const chargeCents = split ? split.totalCents : balanceCents;
    if (chargeCents >= stepUpThresholdCents() && this.x.stepUp && ctx.userId) {
      const fresh = await this.x.stepUp.isFresh((ctx as any).sessionId ?? null, ctx.userId, 300, ctx.tenantId).catch(() => false);
      if (!fresh) return { canProceed: false, reason: 'STEP_UP_REQUIRED', message: 'This amount needs you to confirm your password before charging.', balanceCents, version: detail.version, stepUpRequired: true };
    }

    return {
      ...decision,
      balanceCents,
      idempotencyKey: randomUUID(),
      attemptState: 'created',
      plannedTipCents: tip?.tipCents,
      plannedSplit: split && opts.segments ? { totalCents: split.totalCents, segments: opts.segments } : undefined,
      version: detail.version,
    };
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
      this.locks.getStatus(ctx.tenantId, ticketId, opts.sessionId, this.now()),
      this.getTicketDetail(ctx, ticketId),
      this.attempts.listForTicket(ctx, ticketId),
    ]);
    // Idempotent replay: an attempt already exists for this key — return it unchanged (it already reserved its slice,
    // so re-validating it against the remaining balance would wrongly reject the retry).
    const prior = existing.find((a) => a.idempotencyKey === opts.idempotencyKey);
    if (prior) return prior;
    if (!lock.ownedByCaller) throw new AttemptError('lock_not_held', 'Re-open the ticket to continue checkout.');
    await this.assertTapToPayOn();
    const dev = await this.assertDeviceTrusted(ctx, opts.deviceId);
    if (opts.expectedVersion && opts.expectedVersion !== detail.version) throw new AttemptError('CHECKOUT_VERSION_CONFLICT', 'This checkout changed at the front desk. Review the refreshed amount before charging.');
    // Partial / split-tender aware: a new attempt may charge up to the REMAINING balance — the ticket balance (what the
    // canonical payments do not cover) minus what in-flight attempts already reserve — and defaults to the whole
    // remaining when no amount is supplied. Never trust a client total: resolveAttemptAmount clamps against the server-derived remaining.
    const summary = summariseBalance(detail.totals.totalDueCents, existing, { paidCents: detail.paidCents });
    let amountCents: number;
    try { amountCents = resolveAttemptAmount(opts.amountCents, summary); }
    catch (e) { if (e instanceof PartialAmountError) throw new AttemptError(e.code === 'already_paid' ? 'PAYMENT_ALREADY_COMPLETED' : e.code, e.message); throw e; }
    const gateway = await Promise.resolve().then(() => this.gateways.resolve(ctx.tenantId, ctx.branchId || null)).catch(() => null);
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
    const { wasCreated: _w, ...view } = created; void _w;
    return view;
  }

  /**
   * §83–§84 split tender, cash part: record a cash tender on the canonical checkout (a payments row, 'partial' until the
   * ticket is covered). Idempotent on the client's key. The card part is its own PaymentIntent (§86). Permission: the
   * mobile split right plus the POS cash-payment right (one permission model, §10).
   */
  async recordCashTender(ctx: Ctx, ticketId: string, opts: { sessionId: string; idempotencyKey: string; amountCents: number; deviceId?: string }): Promise<RecordTenderResult> {
    if (!hasPermission(ctx as any, 'mobile_checkout.split_payment') || !hasPermission(ctx as any, 'pos.checkout.cash_payment')) throw new AttemptError('forbidden', 'Missing permission to take a cash tender on the mobile checkout.');
    if (!this.x.recorder) throw new AttemptError('unavailable', 'Tender recording is not available on this build.');
    if (!opts.idempotencyKey) throw new AttemptError('invalid', 'An idempotencyKey is required.');
    const amount = Math.round(Number(opts.amountCents));
    if (!Number.isInteger(amount) || amount <= 0) throw new AttemptError('invalid', 'Cash amount must be a positive whole number of cents.');
    const [lock, detail] = await Promise.all([this.locks.getStatus(ctx.tenantId, ticketId, opts.sessionId, this.now()), this.getTicketDetail(ctx, ticketId)]);
    if (!lock.ownedByCaller) throw new AttemptError('lock_not_held', 'Re-open the ticket to continue checkout.');
    if (detail.balanceDueCents <= 0) throw new AttemptError('PAYMENT_ALREADY_COMPLETED', 'This ticket is already paid in full.');
    if (amount > detail.balanceDueCents) throw new AttemptError('amount_exceeds_remaining', `Amount ${amount} exceeds the remaining balance ${detail.balanceDueCents}.`);
    const r = await this.x.recorder.recordTender(ctx, { ticketId, idempotencyKey: 'cash:' + opts.idempotencyKey, amountCents: amount, method: 'cash', surface: 'cash', deviceId: opts.deviceId ?? null });
    if (!r.duplicate) {
      this.audit(ctx, 'mobile_cash_tender_recorded', ticketId, { paymentId: r.paymentId, amountCents: amount, ticketPaid: r.ticketPaid, deviceId: opts.deviceId ?? null });
      await this.afterTenderRecorded(ctx, ticketId, r, 'cash');
    }
    return r;
  }

  /** The post-payment work + signals every recorded tender gets (the POS's afterPaid, the display, reports). */
  private async afterTenderRecorded(ctx: Ctx, ticketId: string, r: RecordTenderResult, method: 'card' | 'cash'): Promise<void> {
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
      return (rows as any[]).map((r) => ({ paymentId: r.id, method: String(r.method || ''), amountCents: Number(r.amount_cents || 0), tipCents: Number(r.tip_cents || 0), status: String(r.status || ''), createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

  // ── Refund / void (§112–§116, §165) ───────────────────────────────────────────────────────────────────────────────
  /**
   * Refund a captured payment. Delegates entirely to the canonical checkout refund engine (reason required, permission,
   * atomic cumulative-cap, audit log, §21 attribution reversal) — no refund logic is duplicated here. Full or partial
   * (amountCents). Errors from the engine propagate so the caller sees the real reason. Step-up for a large refund is
   * enforced at the controller (@RequireStepUp above the tenant's threshold is the refund approval rule's job).
   */
  refundPayment(ctx: Ctx, paymentId: string, body: { reason?: string; amountCents?: number; serviceLineIds?: string[]; tipRefunded?: boolean }) {
    // permission: the controller's @RequirePermission('pos.checkout.refund') and the engine's own need() — §165 DENIED
    // serviceLineIds / tipRefunded are passed THROUGH (Oct 1 2026): they were dropped here and in the controller, so the
    // Manager Pay refund panel's "commission on the selected services will be reversed" never reached the engine.
    this.audit(ctx, 'mobile_refund_requested', paymentId, { amountCents: body?.amountCents ?? null }, body?.reason ?? null);
    return this.checkout.refund(ctx as any, paymentId, {
      reason: String(body?.reason ?? ''), amountCents: body?.amountCents,
      ...(Array.isArray(body?.serviceLineIds) && body!.serviceLineIds!.length ? { serviceLineIds: body!.serviceLineIds!.map(String), tipRefunded: !!body?.tipRefunded } : {}),
    });
  }
  /** Functional Decision 20 — how a ticket-level refund would split across the ticket's original tenders. */
  async refundPreview(ctx: Ctx, ticketId: string, amountCents: number) {
    return this.checkout.refundAllocationPreview(ctx as any, ticketId, Number(amountCents));
  }

  /** Functional Decision 20 — refund an amount from a ticket; the canonical checkout engine splits it across tenders. */
  async refundTicket(ctx: Ctx, ticketId: string, body: { reason?: string; amountCents?: number }) {
    this.audit(ctx, 'mobile_refund_requested', ticketId, { amountCents: body?.amountCents ?? null, ticketLevel: true }, body?.reason ?? null);
    return this.checkout.refundTicket(ctx as any, ticketId, { reason: String(body?.reason ?? ''), amountCents: Number(body?.amountCents) } as any);
  }

  /** Void a captured payment via the canonical checkout void engine (reason required, permission, audit). §116: void stays
   *  separate from refund — the engine offers it only while the processor transaction is still voidable. */
  voidPayment(ctx: Ctx, paymentId: string, body: { reason?: string }) {
    this.audit(ctx, 'mobile_void_requested', paymentId, {}, body?.reason ?? null);
    return this.checkout.void(ctx as any, paymentId, { reason: String(body?.reason ?? '') });
  }

  // ── Attempt lifecycle (§69–§78, §130, §159–§160) ───────────────────────────────────────────────────────────────────
  /**
   * Backend-driven readiness step: created → readiness_checking → ready | failed, using the REAL readiness check. Drives
   * the attempt to 'ready' only when canTakePayment is true (all critical legs ok, Tap-to-Pay onboarded); otherwise
   * 'failed'. It never drives capture states (authorized/confirmed) — those require a real processor event from the
   * native Tap-to-Pay capture, which is not part of this layer.
   */
  async runReadinessStep(ctx: Ctx, idempotencyKey: string, deviceId?: string): Promise<MobileAttemptView> {
    const existing = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!existing) throw new AttemptError('not_found', 'Payment attempt not found.');
    const from = existing.status as PaymentAttemptState;
    if (from !== 'created') throw new AttemptError('invalid_state', `Readiness step requires a 'created' attempt (is '${from}').`);
    assertTransition('created', 'readiness_checking');
    const readiness = await this.getReadiness(ctx, deviceId ?? existing.deviceId ?? undefined);   // device approval gates the attempt-level readiness too
    const target: PaymentAttemptState = readiness.canTakePayment ? 'ready' : 'failed';
    assertTransition('readiness_checking', target);
    if (target === 'failed') {
      const first = readiness.checks.find((c) => c.critical && c.state !== 'ok');
      await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { lastErrorCode: first?.key === 'device' ? (readiness as any).deviceBlockReason ?? 'DEVICE_NOT_AUTHORIZED' : first?.key === 'tap_to_pay' ? 'TAP_TO_PAY_NOT_PROVISIONED' : first?.key === 'app_version' ? 'APP_UPDATE_REQUIRED' : 'TAP_TO_PAY_NOT_PROVISIONED' });
    }
    return (await this.attempts.updateStatus(ctx.tenantId, idempotencyKey, target))!;
  }

  /** Cancel an attempt (state-machine enforced: terminal attempts cannot be canceled again). §193: a cancel never marks paid. */
  async cancelAttempt(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView> {
    const existing = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!existing) throw new AttemptError('not_found', 'Payment attempt not found.');
    assertTransition(existing.status as PaymentAttemptState, 'canceled');
    const r = (await this.attempts.updateStatus(ctx.tenantId, idempotencyKey, 'canceled'))!;
    await this.attempts.setMeta(ctx.tenantId, idempotencyKey, { lastErrorCode: 'PAYMENT_CANCELED' });
    this.audit(ctx, 'mobile_payment_canceled', existing.ticketId, { idempotencyKey, from: existing.status });
    return r;
  }

  /** §130/§160 app-relaunch recovery: the attempt by its key (this tenant only) with the ticket it belongs to. */
  async getAttempt(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView & { terminal: boolean; recoverable: boolean }> {
    const a = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!a) throw new AttemptError('not_found', 'Payment attempt not found.');
    const s = a.status as PaymentAttemptState;
    return { ...a, terminal: isTerminal(s) || s === 'confirmed' || s === 'declined' || s === 'failed', recoverable: blocksNewAttempt(s) || s === 'created' };
  }

  /** Mobile payment attempts for a ticket (newest first) — feeds the History screen. */
  listAttempts(ctx: Ctx, ticketId: string): Promise<MobileAttemptView[]> {
    return this.attempts.listForTicket(ctx, ticketId);
  }

  /** Recent mobile payment attempts across all tickets (newest first) — feeds the History tab. */
  recentAttempts(ctx: Ctx, limit = 50, startDate?: string, endDate?: string): Promise<MobileAttemptView[]> {
    const s = normalizeStartIso(startDate);
    const e = normalizeEndIso(endDate);
    return this.attempts.listRecent(ctx, limit, s && e && s > e ? e : s, s && e && s > e ? s : e);
  }

  /** Aggregated ATTEMPT funnel for the Reports tab (attempted vs settled, outcomes, daily buckets) — §202 analytics. */
  async report(ctx: Ctx, period: ReportPeriod | string = '7d', startDate?: string, endDate?: string): Promise<AttemptReport> {
    const now = this.now();
    let since: string;
    let until: string | undefined;

    const s = normalizeStartIso(startDate);
    const e = normalizeEndIso(endDate);

    if (s) {
      if (e && s > e) {
        since = e;
        until = s;
      } else {
        since = s;
        until = e;
      }
    } else {
      const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
      since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const attempts = await this.attempts.listSince(ctx, since, until);
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);   // the branch's day (Oct 6 2026)
    return computeReport(
      attempts.map((a) => ({ status: a.status, amountCents: a.amountCents, createdAt: a.createdAt })),
      period as any,
      now,
      tz,
      until ? new Date(until) : undefined,
      s ? new Date(since) : undefined,
    );
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
    const fromIso = normalizeStartIso(f.from);
    const toIso = normalizeEndIso(f.to);
    if (fromIso) q = q.where('p.created_at', '>=', new Date(fromIso));
    if (toIso) q = q.where('p.created_at', '<=', new Date(toIso));
    if (f.method) q = q.where('p.method', '=', String(f.method));
    if (f.surface) q = q.where('p.payment_surface', '=', String(f.surface));
    if (f.employeeId) q = q.where('p.created_by_user_id', '=', String(f.employeeId));
    if (f.deviceId) q = q.where('p.device_id', '=', String(f.deviceId));
    const rows: any[] = await q.orderBy('p.created_at', 'desc').limit(limit).execute();
    const ids = rows.map((r) => String(r.id));
    const refunds = new Map<string, number>();
    if (ids.length) {
      const rr: any[] = await (this.db as any).selectFrom('payment_refunds').select(['payment_id', (eb: any) => eb.fn.sum('amount_cents').as('s')])
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
  async sendReceipt(ctx: Ctx, ticketId: string, channel: 'sms' | 'email' | 'app', destination?: string) {
    if (this.db && this.x.outbox) {
      try {
        await this.x.outbox.write(this.db as any, createDomainEvent({ eventType: DOMAIN_EVENTS.RECEIPT_REQUESTED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType: 'ticket', aggregateId: ticketId,
          actorId: ctx.userId ?? undefined, actorType: 'user', correlationId: `ticket:${ticketId}`, payload: { ticketId, channel, destination, requestedBy: ctx.userId ?? null, role: ctx.role ?? null, permissions: ['pos.receipts.send'], surface: TAP_TO_PAY_SURFACE } }));
        this.audit(ctx, 'mobile_receipt_requested', ticketId, { channel, destination });
        return { channel, configured: true, delivery: 'queued' as const, queued: true };
      } catch { /* fall through to inline delivery */ }
    }
    if (channel === 'email') return destination ? this.checkout.receiptEmail(ctx as any, ticketId, destination) : this.checkout.receiptEmail(ctx as any, ticketId);
    if (channel === 'app') return this.checkout.receiptApp(ctx as any, ticketId);
    return destination ? this.checkout.receiptSms(ctx as any, ticketId, destination) : this.checkout.receiptSms(ctx as any, ticketId);
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
    const existing = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!existing) throw new AttemptError('not_found', 'Payment attempt not found.');
    const from = existing.status as PaymentAttemptState;
    if (isTerminal(from)) throw new AttemptError('already_resolved', `This attempt is already ${from} and cannot receive a capture result.`);
    // §67/§154: the SDK callback repeated after we already confirmed — answer with the same result, charge nothing
    if (from === 'confirmed') return { idempotencyKey, from, to: 'confirmed', outcome: 'approved', paymentId: existing.paymentId ?? undefined, ticketPaid: undefined };

    if (!(await this.captureRailConfigured(ctx, deviceId ?? existing.deviceId))) throw new AttemptError('capture_not_configured', 'Tap to Pay is not configured on this device; a capture result cannot be recorded.');

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
    let capturedCents = result.capturedAmountCents ?? existing.amountCents;
    if (outcome === 'approved' && this.ttpSession?.isConfigured()) {
      let fin;
      try {
        fin = await this.ttpSession.finalizeTransaction({ tenantId: ctx.tenantId, idempotencyKey, processorRef, amountCents: capturedCents });
      } catch (e) {
        // §74/§129: the customer tapped and the provider did not answer — UNKNOWN, verified later; never a decline, never a retry
        if (e instanceof TapToPayNotConfiguredError || e instanceof TapToPayNotImplementedError) throw e;
        return this.markUnknown(ctx, existing, cur, 'PAYMENT_STATUS_UNKNOWN', processorRef);
      }
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
      if (!ok) throw new AttemptError('conflict', 'The attempt changed while the result was processed; reload and try again.');
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
    const existing = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!existing) throw new AttemptError('not_found', 'Payment attempt not found.');
    const from = existing.status as PaymentAttemptState;

    if (!(await this.captureRailConfigured(ctx, existing.deviceId))) throw new AttemptError('capture_not_configured', 'Tap to Pay is not configured on this device.');

    let target: PaymentAttemptState;
    try { target = finalStateOf(planReconciliation(from, resolution), from); }
    catch (e) { if (e instanceof InvalidTransitionError) throw new AttemptError('invalid_state', e.message); throw e; }

    let paymentId: string | undefined = existing.paymentId ?? undefined;
    if (resolution === 'confirmed' && !existing.paymentId && this.x.recorder) {
      const processorRef = meta.processorRef || existing.processorRef;
      if (!processorRef) throw new AttemptError('invalid', 'A processor reference is required to confirm a payment that was never verified.');
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
    const existing = await this.attempts.findByKey(ctx.tenantId, idempotencyKey);
    if (!existing) throw new AttemptError('not_found', 'Payment attempt not found.');
    const from = existing.status as PaymentAttemptState;
    if (!UNRESOLVED.includes(from)) return { status: from, decision: { action: 'wait', reason: 'nothing to verify in this state' } };
    let lookup: TapToPayLookup;
    try { lookup = await this.port().lookupTransaction({ tenantId: ctx.tenantId, idempotencyKey, processorRef: existing.processorRef, amountCents: existing.amountCents }); }
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
    if (!this.serving) throw new AttemptError('not_available', 'Retail catalog is not available on this build.');
    return this.serving.retailCatalog(ctx as never, search);
  }

  async addRetailToTicket(ctx: unknown, ticketId: string, body: { productId?: string; quantity?: number }) {
    if (!this.serving) throw new AttemptError('not_available', 'Retail sales are not available on this build.');
    return this.serving.addRetail(ctx as never, ticketId, { productId: body?.productId, quantity: body?.quantity });
  }

  async applyTicketDiscount(ctx: unknown, ticketId: string, body: { discountCents?: number; reason?: string; managerPin?: string }) {
    const r = await this.checkout.applyDiscount(ctx as never, ticketId, { discountCents: Number(body?.discountCents) || 0, reason: body?.reason, managerPin: body?.managerPin });
    this.audit(ctx as Ctx, 'mobile_discount_applied', ticketId, { discountCents: Number(body?.discountCents) || 0 }, body?.reason ?? null);
    return r;
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private async userNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    if (!this.db || !ids.length) return m;
    try {
      const rows: any[] = await (this.db as any).selectFrom('users').select(['id', 'full_name', 'first_name', 'last_name']).where('tenant_id', '=', tenantId).where('id', 'in', [...new Set(ids)]).execute();
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
