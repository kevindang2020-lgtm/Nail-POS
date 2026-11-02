// mobile-checkout.controller.ts — Owner & Manager Payment App backend surface.
// Same guard stack as POS checkout: TenantAuthGuard populates req.ctx (server-derived tenant/branch/role/permissions),
// RolePermissionGuard enforces @RequirePermission. The PERMISSION gates access — never the job title.
import { Idempotent } from '@aipowersalon/database/nest';   // Constitution 5 §61–66
import { type Ctx } from '@aipowersalon/permissions';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import type { PaymentDeviceSecuritySummary } from '@aipowersalon/api-contracts';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';
import type { TapToPayCapabilityView, MobileHeartbeatResult, MobileDeviceStatusResult, MobileActiveClaim, MobilePaymentPhoneStatus, MobileSendToDeviceResult, LockResult as ContractLockResult, MobileCashTenderResult, MobileAttemptRecoveryView, MobileAttemptVerifyResult, MobilePaymentHistoryResult, MobilePaymentsReport, MobileDevicePairingResult, MobileDeviceBranchesResult, MobileDeviceActivity, MobileDeviceRenameResult, MobileDeviceAttestResult } from '@aipowersalon/api-contracts/tenant';   // the wire contracts (typing ratchet)
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MobileCheckoutService } from './mobile-checkout.service';
import type { MobileQueueFilter, MobileQueueSort } from './mobile-checkout-queue';
import { LockHeldElsewhereError, LockNotHeldError } from '../checkout-lock/checkout-lock.service';
import { AttemptError } from './mobile-checkout.service';
import { InvalidTransitionError } from './payment-attempt-state';
import { ValidationError } from '../checkout/checkout.service';
import { TapToPayNotConfiguredError, TapToPayNotImplementedError } from './tap-to-pay-session';
import { ListQueries } from '@aipowersalon/database';
import { MobileCheckoutControllerListQueries } from './mobile-checkout.list-queries';
import { DeviceProofGuard } from './device-proof.guard';

import { MC_ADD_RETAIL_BODY, MC_CAPTURE_RESULT_BODY, MC_CASH_TENDER_BODY, MC_CREATE_ATTEMPT_BODY, MC_DEVICE_BODY, MC_DEVICE_ATTEST_BODY, MC_DEVICE_BRANCHES_BODY, MC_DEVICE_RENAME_BODY, MC_PAIRING_BODY, MC_DEVICE_REBIND_BODY, MC_DEVICE_STATUS_BODY, MC_DISCOUNT_BODY, MC_HEARTBEAT_BODY, MC_LOCK_BODY, MC_PROCEED_BODY, MC_RECEIPT_BODY, MC_RECONCILE_BODY, MC_REFUND_PAYMENT_BODY, MC_REFUND_TICKET_BODY, MC_REGISTER_DEVICE_BODY, MC_TAKEOVER_BODY, MC_VERIFY_BODY, MC_VOID_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): Ctx & { sessionId?: string | null; verifiedDeviceId?: string | null } {
  const c = req?.ctx || {};
  // verifiedDeviceId: set ONLY by DeviceProofGuard after it verified the device's signature on this request (never a header copy)
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], sessionId: req?.sessionId ?? c.sessionId ?? null, verifiedDeviceId: req?.verifiedDeviceId ?? null };
}

// Map lock + attempt domain errors to HTTP.
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    // mandate §190–§191: the claim is held elsewhere — CHECKOUT_ALREADY_CLAIMED with the friendly sentence (source kept for the screen)
    if (e instanceof LockHeldElsewhereError) throw new HttpException({ error: 'locked_elsewhere', code: 'CHECKOUT_ALREADY_CLAIMED', message: e.message, source: e.heldBy.source, expiresAt: e.heldBy.expiresAt }, HttpStatus.CONFLICT);
    if (e instanceof LockNotHeldError) throw new HttpException({ error: 'lock_not_held', message: e.message }, HttpStatus.CONFLICT);
    if (e instanceof InvalidTransitionError) throw new HttpException({ error: 'invalid_transition', message: e.message }, HttpStatus.CONFLICT);
    if (e instanceof ValidationError) throw new HttpException({ error: 'validation', message: e.message, ...(e.code ? { code: e.code } : {}), ...(e.params ? { details: e.params } : {}) }, HttpStatus.BAD_REQUEST);
    // M6-6 §57: the registry code beside the legacy `error` (clients read `code`)
    if (e instanceof TapToPayNotConfiguredError) throw new HttpException({ error: e.code, code: 'TAP_TO_PAY_NOT_AVAILABLE', message: e.message }, HttpStatus.SERVICE_UNAVAILABLE);
    if (e instanceof TapToPayNotImplementedError) throw new HttpException({ error: e.code, message: e.message }, HttpStatus.NOT_IMPLEMENTED);
    if (e instanceof AttemptError) {
      // §190 taxonomy codes carry their own status (409 / 403 / 426 / 503 …) and the registry's friendly sentence
      if (isRegisteredCode(e.code)) throw new HttpException({ error: e.code, code: e.code, message: e.message || ERROR_REGISTRY[e.code].message }, ERROR_REGISTRY[e.code].status);
      const status = e.code === 'not_found' ? HttpStatus.NOT_FOUND
        : e.code === 'forbidden' ? HttpStatus.FORBIDDEN
        : e.code === 'invalid' ? HttpStatus.BAD_REQUEST
        : e.code === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.CONFLICT;
      throw new HttpException({ error: e.code, message: e.message }, status);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard, DeviceProofGuard)   // Secure Tap to Pay §4 / §16: the device proof + immediate revocation
@ListQueries(MobileCheckoutControllerListQueries)
@Controller('mobile-checkout')
export class MobileCheckoutController {
  constructor(private readonly svc: MobileCheckoutService) {}

  /** Truthful payment-readiness checklist for this device/branch. Never reports ready when a critical leg is unavailable. */
  @Get('readiness')
  @RequirePermission('mobile_checkout.login')
  readiness(@Req() req: any, @Query('deviceId') deviceId?: string) {
    return this.svc.getReadiness(ctxFrom(req), typeof deviceId === 'string' ? deviceId : undefined);
  }

  /** §19/§28: what the Tap to Pay button may say — Ready / Setup Required / Unavailable / switched off — and the provider's real capabilities. */
  @Get('capability')
  @RequirePermission('mobile_checkout.login')
  capability(@Req() req: any, @Query('deviceId') deviceId?: string): Promise<TapToPayCapabilityView> {
    return run(() => this.svc.getCapability(ctxFrom(req), typeof deviceId === 'string' ? deviceId : undefined));
  }

  /** §149: the phone reports it is alive (last_seen) — the POS Mobile Payments card shows ● Online. */
  @Post('device/heartbeat')
  @RequirePermission('mobile_checkout.login')
  heartbeat(@Req() req: any, @Body(ValidatedBody(MC_HEARTBEAT_BODY, { strict: true })) body: any): Promise<MobileHeartbeatResult> {
    return run(() => this.svc.heartbeat(ctxFrom(req), String(body?.deviceId || ''), typeof body?.appVersion === 'string' ? body.appVersion : null));
  }

  /** The app registers its stable per-install device id on sign-in. Lands 'pending' — an owner/Super Admin approves it. */
  @Post('device/register')
  @RequirePermission('mobile_checkout.login')
  registerDevice(@Req() req: any, @Body(ValidatedBody(MC_REGISTER_DEVICE_BODY, { strict: true })) body: any) {
    return run(() => this.svc.registerDevice(ctxFrom(req), {
      deviceId: String(body?.deviceId || ''),
      label: typeof body?.label === 'string' ? body.label : null,
      platform: body?.platform,
      osVersion: typeof body?.osVersion === 'string' ? body.osVersion : null,
      appVersion: typeof body?.appVersion === 'string' ? body.appVersion : null,
      tapToPayCapable: !!body?.tapToPayCapable,
      publicKey: typeof body?.publicKey === 'string' ? body.publicKey : null,
      pairingCode: typeof body?.pairingCode === 'string' ? body.pairingCode : null,
    }));
  }

  /** Secure Tap to Pay §5: the phone's attestation evidence, signed by its own payment key → the verifier's verdict is stored
   *  (attestation_status); without a configured verifier nothing is stored and the answer says so. */
  @Post('device/attest')
  @RequirePermission('mobile_checkout.login')
  attestDevice(@Req() req: any, @Body(ValidatedBody(MC_DEVICE_ATTEST_BODY, { strict: true })) b: any): Promise<MobileDeviceAttestResult> {
    return run(() => this.svc.attestDevice(ctxFrom(req), String(b?.deviceId || ''), { format: b?.format, evidence: b?.evidence, keyId: b?.keyId }));
  }

  /** Secure Tap to Pay §7: a single-use, 5-minute pairing code (QR) for a NEW phone in this location. Owner + fresh step-up. */
  @RequireStepUp()
  @Post('devices/pairings')
  @RequirePermission('pos.devices.manage')
  createPairing(@Req() req: any, @Body(ValidatedBody(MC_PAIRING_BODY, { strict: true })) b: any): Promise<MobileDevicePairingResult> {
    return run(() => this.svc.createDevicePairing(ctxFrom(req), { label: typeof b?.label === 'string' ? b.label : null, shared: b?.shared === true || b?.shared === 'true' }));
  }

  /** Secure Tap to Pay §9: the locations a phone may take payments in (effective = the employee's ∩ the phone's). Step-up. */
  @RequireStepUp()
  @Post('devices/:deviceId/branches')
  @RequirePermission('pos.devices.manage')
  setDeviceBranches(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_BRANCHES_BODY, { strict: true })) b: any): Promise<MobileDeviceBranchesResult> {
    return run(() => this.svc.setDeviceBranches(ctxFrom(req), deviceId, Array.isArray(b?.branchIds) ? b.branchIds : []));
  }

  /** Secure Tap to Pay §15: the owner renames a phone (the name the POS, reports and the device dashboard show). Step-up. */
  @RequireStepUp()
  @Post('devices/:deviceId/rename')
  @RequirePermission('pos.devices.manage')
  renameDevice(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_RENAME_BODY, { strict: true })) b: any): Promise<MobileDeviceRenameResult> {
    return run(async () => { const r = await this.svc.renameDevice(ctxFrom(req), deviceId, b?.label); return { deviceId: r.deviceId, label: r.label ?? null, status: r.status }; });
  }

  /** The signed-in salon's registered Tap to Pay devices (owner device management). */
  @Get('devices')
  @RequirePermission('mobile_checkout.login')
  myDevices(@Req() req: any) {
    return run(() => this.svc.listMyDevices(ctxFrom(req)));
  }

  /** Secure Tap to Pay §51 (Oct 27): this salon's payment-phone security counts — registrations, revocations, claim conflicts,
   *  key-mismatch / revoked-phone / unusual-registration alerts, app versions (owner device dashboard panel). */
  @Get('devices/security-summary')
  @RequirePermission('pos.devices.manage')
  deviceSecuritySummary(@Req() req: any): Promise<PaymentDeviceSecuritySummary> {
    return run(() => this.svc.deviceSecuritySummary(ctxFrom(req)));
  }

  /** Secure Tap to Pay §15 / §62 (M6-6): one phone's sign-ins and audit history — the owner's device dashboard. */
  @Get('devices/:deviceId/activity')
  @RequirePermission('pos.devices.manage')
  deviceActivity(@Req() req: any, @Param('deviceId') deviceId: string): Promise<MobileDeviceActivity> {
    return run(() => this.svc.deviceActivity(ctxFrom(req), deviceId));
  }

  /** Owner self-service: approve a registered device in their OWN salon → 'active'. (Owner-only; enforced in service.) */
  @RequireStepUp()   // Secure Tap to Pay §13: device trust decisions need a fresh step-up
  @Post('devices/:deviceId/approve')
  @RequirePermission('mobile_checkout.login')
  approveMyDevice(@Req() req: any, @Param('deviceId') deviceId: string) {
    return run(() => this.svc.setMyDeviceStatus(ctxFrom(req), deviceId, 'active'));
  }

  /** Owner self-service: revoke a device in their OWN salon → 'revoked' (blocks it immediately, §138–§139). Reason kept. */
  @RequireStepUp()   // Secure Tap to Pay §13: device trust decisions need a fresh step-up
  @Post('devices/:deviceId/revoke')
  @RequirePermission('mobile_checkout.login')
  revokeMyDevice(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_STATUS_BODY, { strict: true })) b: any) {
    return run(() => this.svc.setMyDeviceStatus(ctxFrom(req), deviceId, 'revoked', typeof b?.reason === 'string' ? b.reason : null));
  }

  /** §13: owner switches a phone off without revoking it (may be re-approved later). */
  @RequireStepUp()   // Secure Tap to Pay §13: device trust decisions need a fresh step-up
  @Post('devices/:deviceId/disable')
  @RequirePermission('mobile_checkout.login')
  disableMyDevice(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_STATUS_BODY, { strict: true })) b: any): Promise<MobileDeviceStatusResult> {
    return run(() => this.svc.setMyDeviceStatus(ctxFrom(req), deviceId, 'disabled', typeof b?.reason === 'string' ? b.reason : null));
  }

  /** §137: mark a phone compromised (risk signal) — it must be revoked and re-registered, never re-activated in place. */
  @RequireStepUp()   // Secure Tap to Pay §13: device trust decisions need a fresh step-up
  @Post('devices/:deviceId/compromised')
  @RequirePermission('mobile_checkout.login')
  compromisedMyDevice(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_STATUS_BODY, { strict: true })) b: any): Promise<MobileDeviceStatusResult> {
    return run(() => this.svc.setMyDeviceStatus(ctxFrom(req), deviceId, 'compromised', typeof b?.reason === 'string' ? b.reason : null));
  }

  /** §17 device reassignment is a step-up action: rebind the phone to another user of this salon (back to 'pending'). */
  @RequireStepUp()
  @Post('devices/:deviceId/reassign')
  @RequirePermission('mobile_checkout.login')
  reassignMyDevice(@Req() req: any, @Param('deviceId') deviceId: string, @Body(ValidatedBody(MC_DEVICE_REBIND_BODY, { strict: true })) b: any): Promise<MobileDeviceStatusResult> {
    return run(() => this.svc.rebindMyDevice(ctxFrom(req), deviceId, String(b?.userId || '')));
  }

  /** This tenant's Tap to Pay onboarding status (Apple entitlement + CommerceHub) — the state driving the readiness flip. */
  @Get('tap-to-pay/onboarding')
  @RequirePermission('mobile_checkout.login')
  tapToPayOnboarding(@Req() req: any) {
    return run(() => this.svc.getTapToPayOnboarding(ctxFrom(req)));
  }

  /** §45 POS: every active mobile claim in this branch ("Payment in progress · Manager · Device"). */
  @Get('claims')
  @RequirePermission('pos.checkout.view')
  claims(@Req() req: any): Promise<MobileActiveClaim[]> {
    return run(() => this.svc.activeClaims(ctxFrom(req)));
  }

  /** §149 POS "Mobile Payments" card: the branch's active payment phones (online / Tap to Pay ready). */
  @Get('devices/status')
  @RequirePermission('pos.checkout.view')
  deviceStatus(@Req() req: any): Promise<MobilePaymentPhoneStatus[]> {
    return run(() => this.svc.deviceStatusForPos(ctxFrom(req)));
  }

  /** §150 POS "Send Checkout To → Kevin's iPhone": a push to the phone's user + the realtime nudge (the phone still claims it). */
  @Post('tickets/:ticketId/send-to-device')
  @RequirePermission('pos.checkout.take_payment')
  sendToDevice(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_DEVICE_BODY, { strict: true })) b: any): Promise<MobileSendToDeviceResult> {
    return run(() => this.svc.sendToDevice(ctxFrom(req), ticketId, String(b?.deviceId || '')));
  }

  /** Checkout Queue — the same canonical POS tickets ready for payment, scoped to this caller's branch. */
  @Get('queue')
  @RequirePermission('mobile_checkout.view_queue')
  queue(@Req() req: any, @Query() q: any) {
    return this.svc.getQueue(ctxFrom(req), {
      search: typeof q?.search === 'string' ? q.search : undefined,
      status: (q?.status as MobileQueueFilter) || undefined,
      sort: (q?.sort as MobileQueueSort) || undefined,
    });
  }

  /** Ticket detail — the same canonical services/totals/customer the POS shows (phone masked). Read-only; lock is next. */
  @Get('retail-catalog')
  @RequirePermission('mobile_checkout.open_ticket')
  retailCatalog(@Req() r: any, @Query('search') search?: string) { return run(() => this.svc.retailCatalog(ctxFrom(r), search)); }

  @Post('tickets/:ticketId/retail')
  @RequirePermission('mobile_checkout.open_ticket')
  addRetail(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(MC_ADD_RETAIL_BODY, { strict: true })) b: any) { return run(() => this.svc.addRetailToTicket(ctxFrom(r), id, b ?? {})); }

  @Post('tickets/:ticketId/discount')
  @RequirePermission('mobile_checkout.open_ticket')
  applyDiscount(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(MC_DISCOUNT_BODY, { strict: true })) b: any) { return run(() => this.svc.applyTicketDiscount(ctxFrom(r), id, b ?? {})); }

  @Get('tickets/:ticketId')
  @RequirePermission('mobile_checkout.open_ticket')
  ticket(@Req() req: any, @Param('ticketId') ticketId: string, @Query('sessionId') sessionId?: string) {
    // Phase 14 (live IDOR run): another salon's ticket id is "Ticket not found" — a client error, not a 500
    return run(() => this.svc.getTicketDetail(ctxFrom(req), ticketId, typeof sessionId === 'string' ? sessionId : undefined));
  }

  /** Acquire the checkout-session lock (open the ticket on this device). 409 if the POS/another device holds it. */
  @Post('tickets/:ticketId/lock')
  @RequirePermission('mobile_checkout.open_ticket')
  acquireLock(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_LOCK_BODY, { strict: true })) b: any) {
    return run(() => this.svc.acquireLock(ctxFrom(req), ticketId, b?.deviceId, String(b?.sessionId || '')));
  }

  /** Heartbeat: extend the lock while the ticket stays open. */
  @Post('tickets/:ticketId/lock/refresh')
  @RequirePermission('mobile_checkout.open_ticket')
  refreshLock(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_LOCK_BODY, { strict: true })) b: any) {
    return run(() => this.svc.refreshLock(ctxFrom(req), ticketId, String(b?.sessionId || '')));
  }

  /** Release the lock (on done, cancel, logout, or leaving the ticket). */
  @Post('tickets/:ticketId/lock/release')
  @RequirePermission('mobile_checkout.open_ticket')
  releaseLock(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_LOCK_BODY, { strict: true })) b: any) {
    return run(() => this.svc.releaseLock(ctxFrom(req), ticketId, String(b?.sessionId || ''), b?.reason));
  }

  /** §46 authorized takeover of a claim held at the POS / another phone (manager override permission, a reason, no in-flight charge). */
  @Post('tickets/:ticketId/lock/takeover')
  @RequirePermission('mobile_checkout.open_ticket')
  takeoverLock(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_TAKEOVER_BODY, { strict: true })) b: any): Promise<ContractLockResult> {
    return run(() => this.svc.takeoverLock(ctxFrom(req), ticketId, typeof b?.deviceId === 'string' ? b.deviceId : undefined, String(b?.sessionId || ''), String(b?.reason || '')));
  }

  /** Lock status for a ticket (who holds it, if anyone). */
  @Get('tickets/:ticketId/lock')
  @RequirePermission('mobile_checkout.open_ticket')
  lockStatus(@Req() req: any, @Param('ticketId') ticketId: string, @Query() q: any) {
    return this.svc.lockStatus(ctxFrom(req), ticketId, typeof q?.sessionId === 'string' ? q.sessionId : undefined);
  }

  /**
   * "Proceed to payment" gate. Returns whether the checkout can proceed (and, if so, a replay-safe idempotency key) or a
   * precise reason it cannot — e.g. Tap to Pay not set up, lock not held, already paid, invalid tip/split. No charge.
   */
  @Post('tickets/:ticketId/proceed-to-payment')
  @RequirePermission('mobile_checkout.tap_to_pay')
  proceed(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_PROCEED_BODY, { strict: true })) b: any) {
    return this.svc.evaluateProceed(ctxFrom(req), ticketId, {
      sessionId: String(b?.sessionId || ''),
      deviceId: typeof b?.deviceId === 'string' ? b.deviceId : undefined,
      tip: b?.tip,
      segments: Array.isArray(b?.segments) ? b.segments : undefined,
      expectedVersion: typeof b?.expectedVersion === 'string' ? b.expectedVersion : undefined,
    });
  }

  /** Idempotently record a payment attempt (state 'created'). Re-posting the same idempotencyKey returns the same attempt.
   *  Secure Tap to Pay M6-6 (§30): also route-level @Idempotent — an HTTP retry carrying the same Idempotency-Key gets the
   *  stored answer. It composes with the device proof: guards run first, so a retry must be re-signed with a fresh nonce
   *  (a byte-for-byte replay of the signed request is DEVICE_REQUEST_REPLAYED before anything runs). */
  @Idempotent()
  @Post('tickets/:ticketId/payment-attempts')
  @RequirePermission('mobile_checkout.tap_to_pay')
  createAttempt(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_CREATE_ATTEMPT_BODY, { strict: true })) b: any) {
    return run(() => this.svc.createAttempt(ctxFrom(req), ticketId, {
      sessionId: String(b?.sessionId || ''),
      idempotencyKey: String(b?.idempotencyKey || ''),
      amountCents: b?.amountCents != null ? Number(b.amountCents) : undefined,
      deviceId: typeof b?.deviceId === 'string' ? b.deviceId : undefined,
      expectedVersion: typeof b?.expectedVersion === 'string' ? b.expectedVersion : undefined,
    }));
  }

  /** §83–§84 split tender, cash part: a cash payment recorded on the canonical checkout ('partial' until covered). Idempotent on the key
   *  (the body's key → 'cash:<key>' on the payments row) and, M6-6, on the route's Idempotency-Key. */
  @Idempotent()
  @Post('tickets/:ticketId/cash-tender')
  @RequirePermission('mobile_checkout.split_payment')
  cashTender(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_CASH_TENDER_BODY, { strict: true })) b: any): Promise<MobileCashTenderResult> {
    return run(() => this.svc.recordCashTender(ctxFrom(req), ticketId, { sessionId: String(b?.sessionId || ''), idempotencyKey: String(b?.idempotencyKey || ''), amountCents: Number(b?.amountCents), deviceId: typeof b?.deviceId === 'string' ? b.deviceId : undefined }));
  }

  /** Remaining-balance summary for a ticket (confirmed / in-flight / remaining) — drives partial & split tender. */
  @Get('tickets/:ticketId/balance')
  @RequirePermission('mobile_checkout.tap_to_pay')
  ticketBalance(@Req() req: any, @Param('ticketId') ticketId: string) {
    return run(() => this.svc.getBalanceSummary(ctxFrom(req), ticketId));
  }

  /** The ticket's captured payments (approved/partial) — what a refund or void can act on. */
  @Get('tickets/:ticketId/payments')
  @RequirePermission('mobile_checkout.open_ticket')
  ticketPayments(@Req() req: any, @Param('ticketId') ticketId: string) {
    return run(() => this.svc.listTicketPayments(ctxFrom(req), ticketId));
  }

  /** Refund a captured payment (full or partial). Reuses the canonical checkout refund engine; a reason is required. */
  // Security Deep Scan C7: server-enforced step-up
  @Idempotent() @RequireStepUp() @Post('payments/:paymentId/refund')
  @RequirePermission('pos.checkout.refund')
  refundPayment(@Req() req: any, @Param('paymentId') paymentId: string, @Body(ValidatedBody(MC_REFUND_PAYMENT_BODY, { strict: true })) b: any) {
    return run(() => this.svc.refundPayment(ctxFrom(req), paymentId, { reason: b?.reason, amountCents: b?.amountCents, serviceLineIds: b?.serviceLineIds, tipRefunded: b?.tipRefunded }));
  }

  /** Functional Decision 20 — preview how a refund amount splits across the ticket's original payments. */
  @Get('tickets/:ticketId/refund-preview')
  @RequirePermission('pos.checkout.refund')
  previewRefundSplit(@Req() req: any, @Param('ticketId') ticketId: string, @Query('amountCents') amountCents: string) {   // read-only; named so the CSRF guard (no mutation-named GET) holds
    return run(() => this.svc.refundPreview(ctxFrom(req), ticketId, Number(amountCents)));
  }

  /** Functional Decision 20 — refund an amount from the ticket; split proportionally, each part to its own method. */
  @Idempotent() @RequireStepUp() @Post('tickets/:ticketId/refund')
  @RequirePermission('pos.checkout.refund')
  refundTicket(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_REFUND_TICKET_BODY, { strict: true })) b: any) {
    return run(() => this.svc.refundTicket(ctxFrom(req), ticketId, { reason: b?.reason, amountCents: b?.amountCents }));
  }

  /** Void a captured payment. Reuses the canonical checkout void engine; a reason is required. */
  @Idempotent() @RequireStepUp() @Post('payments/:paymentId/void')
  @RequirePermission('pos.checkout.void')
  voidPayment(@Req() req: any, @Param('paymentId') paymentId: string, @Body(ValidatedBody(MC_VOID_BODY, { strict: true })) b: any) {
    return run(() => this.svc.voidPayment(ctxFrom(req), paymentId, { reason: b?.reason }));
  }

  /** Backend readiness step: advances the attempt to 'ready' (if payment is truly possible) or 'failed'. */
  @Post('payment-attempts/:idempotencyKey/readiness')
  @RequirePermission('mobile_checkout.tap_to_pay')
  attemptReadiness(@Req() req: any, @Param('idempotencyKey') key: string, @Body(ValidatedBody(MC_DEVICE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.runReadinessStep(ctxFrom(req), key, typeof b?.deviceId === 'string' ? b.deviceId : undefined));
  }

  /** Mint a Tap to Pay device session for a 'ready' attempt (spec §14 step 2). Honest 503 when Tap to Pay isn't
   *  configured / onboarded — the on-device SDK never receives a fabricated token. */
  @Post('payment-attempts/:idempotencyKey/device-session')
  @RequirePermission('mobile_checkout.tap_to_pay')
  deviceSession(@Req() req: any, @Param('idempotencyKey') key: string, @Body(ValidatedBody(MC_DEVICE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.mintDeviceSession(ctxFrom(req), key, typeof b?.deviceId === 'string' ? b.deviceId : undefined));
  }

  /** §130/§160 app-relaunch recovery: the attempt by key — the app restores / verifies it, never starts a new charge. */
  @Get('payment-attempts/:idempotencyKey')
  @RequirePermission('mobile_checkout.tap_to_pay')
  getAttempt(@Req() req: any, @Param('idempotencyKey') key: string): Promise<MobileAttemptRecoveryView> {
    return run(() => this.svc.getAttempt(ctxFrom(req), key));
  }

  /** §76 verify: ask the provider what became of an unresolved attempt and act only on its answer (never a new charge). */
  @Post('payment-attempts/:idempotencyKey/verify')
  @RequirePermission('mobile_checkout.tap_to_pay')
  verifyAttempt(@Req() req: any, @Param('idempotencyKey') key: string, @Body(ValidatedBody(MC_VERIFY_BODY, { strict: true })) _b: any): Promise<MobileAttemptVerifyResult> {
    return run(() => this.svc.verifyAttempt(ctxFrom(req), key));
  }

  /** Cancel an attempt (state-machine enforced). */
  @Post('payment-attempts/:idempotencyKey/cancel')
  @RequirePermission('mobile_checkout.tap_to_pay')
  cancelAttempt(@Req() req: any, @Param('idempotencyKey') key: string) {
    return run(() => this.svc.cancelAttempt(ctxFrom(req), key));
  }

  /**
   * §5 server bridge — apply a native Tap-to-Pay capture result, advancing the attempt lifecycle. Refused unless the
   * Tap-to-Pay rail is configured (no capture can be recorded otherwise). Body: { outcome, processorRef?, ... }.
   */
  @Idempotent()   // M6-6 §30: a repeated delivery of the SAME result with the same Idempotency-Key answers from the store
  @Post('payment-attempts/:idempotencyKey/capture-result')
  @RequirePermission('mobile_checkout.tap_to_pay')
  captureResult(@Req() req: any, @Param('idempotencyKey') key: string, @Body(ValidatedBody(MC_CAPTURE_RESULT_BODY, { strict: true })) b: any) {
    const outcome = ['approved', 'declined', 'timeout', 'unknown'].includes(b?.outcome) ? b.outcome : 'unknown';
    return run(() => this.svc.applyCaptureResult(ctxFrom(req), key, {
      outcome, processorRef: b?.processorRef, authCode: b?.authCode, brand: b?.brand, last4: b?.last4,
      capturedAmountCents: Number.isFinite(b?.capturedAmountCents) ? Number(b.capturedAmountCents) : undefined,
    }, typeof b?.deviceId === 'string' ? b.deviceId : undefined));
  }

  /**
   * §5 reconciliation from the phone. Secure Tap to Pay §29 / §37 (Oct 23 2026): the phone may ASK for reconciliation, but it
   * never states the outcome — this used to accept { resolution: 'confirmed', processorRef, capturedAmountCents } from the
   * client and record money on that word. Now it asks the PROVIDER (the same path as Verify and the recovery worker) and
   * acts only on its answer; a client-sent resolution / reference / amount is ignored. Never a new charge.
   */
  @Idempotent()   // M6-6: an HTTP retry of one reconcile tap gets the same answer (a NEW tap sends a new key: it asks the provider again)
  @Post('payment-attempts/:idempotencyKey/reconcile')
  @RequirePermission('mobile_checkout.tap_to_pay')
  reconcile(@Req() req: any, @Param('idempotencyKey') key: string, @Body(ValidatedBody(MC_RECONCILE_BODY, { strict: true })) _b: any): Promise<MobileAttemptVerifyResult> {
    return run(() => this.svc.verifyAttempt(ctxFrom(req), key));
  }

  /** Payment-attempt history for a ticket. */
  @Get('tickets/:ticketId/payment-attempts')
  @RequirePermission('mobile_checkout.view_history')
  listAttempts(@Req() req: any, @Param('ticketId') ticketId: string) {
    return this.svc.listAttempts(ctxFrom(req), ticketId);
  }

  // (GET payment-attempts — the attempt-only History list — retired Oct 13 2026: History reads the canonical payments, §103)

  /** §103–§106 Payment History from the canonical payments (filters: date, status, method, employee, device, branch, surface). */
  @Get('payments')
  @RequirePermission('mobile_checkout.view_history')
  payments(@Req() req: any, @Query() q: any): Promise<MobilePaymentHistoryResult> {
    const s = (k: string) => (typeof q?.[k] === 'string' && q[k] ? String(q[k]) : undefined);
    return run(() => this.svc.paymentHistory(ctxFrom(req), { from: s('from'), to: s('to'), status: s('status'), method: s('method'), employeeId: s('employeeId'), deviceId: s('deviceId'), branchId: s('branchId'), surface: s('surface'), limit: Number(q?.limit) || undefined }));
  }

  /** Aggregated ATTEMPT funnel (Reports tab, §202 analytics). */
  @Get('reports')
  @RequirePermission('mobile_checkout.view_reports')
  reports(@Req() req: any, @Query() q: any) {
    const period = q?.period === 'today' || q?.period === '30d' ? q.period : '7d';
    return this.svc.report(ctxFrom(req), period);
  }

  /** §107–§110 the sales report from the canonical payments — gross sales, never labelled payout. */
  @Get('reports/sales')
  @RequirePermission('mobile_checkout.view_reports')
  salesReport(@Req() req: any, @Query() q: any): Promise<MobilePaymentsReport> {
    const period = q?.period === 'today' || q?.period === '30d' ? q.period : '7d';
    return run(() => this.svc.paymentsReport(ctxFrom(req), period));
  }

  /** Send a receipt for a ticket, via the canonical receipt system (honest about unconfigured channels). */
  @Post('tickets/:ticketId/receipt')
  @RequirePermission('pos.receipts.send')
  sendReceipt(@Req() req: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(MC_RECEIPT_BODY, { strict: true })) b: any) {
    const channel: 'sms' | 'email' | 'app' = b?.channel === 'email' ? 'email' : b?.channel === 'app' ? 'app' : 'sms';
    return run(() => this.svc.sendReceipt(ctxFrom(req), ticketId, channel));
  }
}
