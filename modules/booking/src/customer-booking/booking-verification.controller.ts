// booking-verification.controller.ts — the send / resend / check surface.
//
// ── The security shape of these three routes ────────────────────────────────────────────────────────────
// They sit in front of an SMS sender, so they are an attacker's favourite kind of endpoint: free outbound
// messages, billed to someone else, aimed at anybody's phone. Every protection below exists because of that,
// not as ceremony.
//
//   • the TENANT is server-derived (req.ctx) — never taken from the body. A client that could name its own
//     tenant could send verification texts on any salon's Twilio account, at their expense.
//   • the BOOKING SESSION is server-issued — it is what binds a verification to ONE booking attempt, so a code
//     proven for one booking cannot be presented for another.
//   • the response is ENUMERATION-SAFE: the same generic text whether or not the number is already a customer.
//   • the resend COOLDOWN is enforced in the service (not here), so every caller gets it, including any future
//     channel that forgets to ask.
//   • the code NEVER appears in a response, a log line, or an error.
import { openBookingSession, sealBookingSession } from './booking-session-token';
import { clientIp } from '@aipowersalon/security';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Post, Req } from '@nestjs/common';

/**
 * Resolves the AUTHENTICATED customer's own phone number.
 *
 * This exists so the client does not have to send one — and, more importantly, so that it CANNOT. A
 * client-supplied phone would let a signed-in customer verify a DIFFERENT number from the one attached to their
 * booking: they verify a phone they control, then book against anyone's. That is precisely the fraud the
 * "changing the phone invalidates the verification" rule exists to stop, and it would walk straight back in
 * through a request body field.
 *
 * A GUEST booking has no customer record, so it must supply a phone — and the policy resolver treats it as a new
 * number every time.
 */
export interface CustomerPhoneLookup {
  phoneFor(tenantId: string, customerId: string): Promise<string | null>;
}

/** Velocity counters, read from the platform's existing rate limiter. */
export interface RiskCounters {
  read(tenantId: string, ip: string, device: string, phoneE164: string): Promise<Omit<RiskSignals, 'destination'>>;
  homeCountry?(tenantId: string): string;
  recordAlert?(tenantId: string, alert: { action: string; reasons: string[]; score: number; ip: string }): Promise<void>;
}
import { randomUUID } from 'node:crypto';
import { BookingVerificationService, type VerificationCtx } from './booking-verification.service';
import { BookingVerificationGuard } from './booking-verification-guard';
import { assessSendRisk, destinationRisk, type CaptchaVerifier, type RiskSignals } from './booking-verification-fraud';
import { captchaClientConfig } from './booking-verification-fraud.adapters';
import { normalizePhone } from '@aipowersalon/customers';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { VERIFICATION_CHECK_BODY, VERIFICATION_SEND_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
/** Resolves the signed-in user's customer record for THIS salon (customers.user_id). */
export interface SessionCustomerLookup { resolveCustomerId(ctx: { tenantId: string; userId: string }): Promise<string | null> }

/**
 * The verification context for the signed-in customer app.
 *
 * Phase 4 (audit bug 2): this used the USER id as the customer id — `req.ctx` has no customerId — so the phone lookup
 * missed, the client sent `phone: ''`, and the first send failed. The customer is now resolved from the user
 * (customers.user_id), the booking session is the one the 428 sealed for THIS user, and the channel is the app's.
 */
async function ctxOf(req: any, body: any, customers?: SessionCustomerLookup, svc?: BookingVerificationService): Promise<VerificationCtx & { sessionFromToken: boolean }> {
  const c = req?.ctx || {};
  const tenantId = String(c.tenantId ?? '');
  const userId = String(c.userId ?? '');
  const fromToken = openBookingSession(body?.bookingSessionId, { tenantId, customerId: userId || null });
  const customerId = customers && tenantId && userId ? await customers.resolveCustomerId({ tenantId, userId }).catch(() => null) : null;
  // The booking's location: the one the 428 opened the session for (a customer's own session has none).
  const sessionBranch = fromToken && svc ? await svc.sessionBranch(tenantId, fromToken) : null;
  return {
    sessionFromToken: !!fromToken,
    requestIp: clientIp(req),                       // Constitution 12 §50: never the raw X-Forwarded-For
    deviceId: String(req?.headers?.['x-device-id'] ?? '').slice(0, 200) || null,
    tenantId,
    branchId: sessionBranch || c.branchId || '',
    channel: 'customer_app',
    bookingSessionId: fromToken ?? randomUUID(),
    customerId,
    locale: String(req?.headers?.['accept-language'] ?? '') || null,
  };
}

export async function screenVerificationSend(deps: { counters?: RiskCounters; captcha?: CaptchaVerifier }, tenantId: string, req: any, phone: string, captchaToken?: string, deviceId?: string | null): Promise<void> {
  if (!deps.counters) return;

  const e164 = normalizePhone(String(phone ?? ''));
  const ip = clientIp(req) ?? 'unknown';          // Constitution 12 §50: never the raw X-Forwarded-For
  const device = String(deviceId || req?.headers?.['x-device-id'] || '').slice(0, 200) || ip;

  const signals: RiskSignals = {
    ...(await deps.counters.read(tenantId, ip, device, e164 ?? '')),
    destination: e164 ? destinationRisk(e164, deps.counters.homeCountry?.(tenantId) ?? '1') : 'elevated',
  };

  const risk = assessSendRisk(signals);

  if (risk.action === 'block') {
    // Recorded for the fraud console, and NEVER explained to the caller.
    await deps.counters.recordAlert?.(tenantId, { action: 'block', reasons: risk.reasons, score: risk.score, ip }).catch(() => undefined);
    throw new HttpException({ status: 'verification_failed', message: 'We could not send a verification code. Please contact the salon.' }, HttpStatus.FORBIDDEN);
  }

  if (risk.action === 'challenge') {
    // FAILS CLOSED. If we decided this request needs a human check and cannot perform one, we do not wave it
    // through — that would make the whole risk engine decorative.
    const ok = captchaToken && deps.captcha ? await deps.captcha.verify(String(captchaToken), ip).catch(() => false) : false;
    if (!ok) {
      throw new HttpException(
        { status: 'captcha_required', message: 'Please complete the verification challenge to continue.', reasons: risk.reasons },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
  }

  if (risk.action === 'slow') {
    // A second. Invisible to a person; ruinous to a script that is priced per request.
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// No @UseGuards here, deliberately and consistently with CustomerBookingController: the tenant, branch and user
// arrive on `req.ctx` from TenantContextMiddleware, which every /customer/* route already passes through. Adding
// a second, different auth mechanism for these three routes would be a second thing to get wrong — and the
// tenant is what matters here, since it is the tenant's Twilio account that pays for every message sent.
@Controller('customer/booking/verification')
export class BookingVerificationController {
  constructor(
    private readonly svc: BookingVerificationService,
    private readonly guard: BookingVerificationGuard,
    // Velocity counters, read from the platform's EXISTING rate limiter. Optional: with no limiter bound there
    // are no counters, so the risk engine sees a clean request and allows it — which is the same state as "not
    // deployed". The hard per-IP/per-device caps in BookingVerificationService.send apply regardless.
    @Optional() @Inject('BookingRiskCounters') private readonly counters?: RiskCounters,
    @Optional() @Inject('CaptchaVerifier') private readonly captcha?: CaptchaVerifier,
    @Optional() @Inject('CustomerPhoneLookup') private readonly phones?: CustomerPhoneLookup,
    @Optional() @Inject('BookingSessionCustomer') private readonly customers?: SessionCustomerLookup,
  ) {}

  /**
   * The number this verification is FOR.
   *
   * For a signed-in customer it is THEIRS, resolved from their record — the body is not consulted, so they cannot
   * verify one number and book with another. Only a guest (no customer record) may supply one.
   */
  private async resolvePhone(ctx: VerificationCtx): Promise<string> {
    // The customer app verifies the customer's OWN number — never one from the body (verify a number you control,
    // then book against another's). No customer record, or no number on it: nothing to verify.
    if (!ctx.customerId) throw new HttpException({ status: 'verification_failed', message: 'This account has no customer profile at this salon.' }, HttpStatus.FORBIDDEN);
    const own = this.phones ? await this.phones.phoneFor(ctx.tenantId, ctx.customerId).catch(() => null) : null;
    if (!own) throw new HttpException({ status: 'invalid_phone_number', message: 'Add a mobile number to your profile first.' }, HttpStatus.BAD_REQUEST);
    return own;
  }

  /**
   * Score the request, and act.
   *
   *   block      refuse. Reserved for what a real booking CANNOT produce — a premium-rate destination, a walk of
   *              a number list, sustained code guessing.
   *   challenge  demand a CAPTCHA. Costs a human three seconds; costs a script the whole attack.
   *   slow       a short delay. Bots are priced per request; a human does not notice a second.
   *   allow      send.
   *
   * The refusal message is deliberately the SAME for `block` as the generic send response. Telling an attacker
   * "you were blocked for spraying" hands them the threshold to tune against.
   */
  private screen(ctx: VerificationCtx, req: any, phone: string, captchaToken?: string): Promise<void> {
    return screenVerificationSend({ counters: this.counters, captcha: this.captcha }, ctx.tenantId, req, phone, captchaToken);
  }

  /**
   * "Will this booking need a code?" — a probe, not an enforcement. Lets a client show the verification step in
   * the right place instead of discovering it at the confirm button.
   */
  @Get('policy')
  async policy(@Req() r: any) {
    const ctx = await ctxOf(r, {}, this.customers);
    const phone = ctx.customerId && this.phones ? await this.phones.phoneFor(ctx.tenantId, ctx.customerId).catch(() => null) : null;
    const p = await this.guard.resolve({ tenantId: ctx.tenantId, branchId: ctx.branchId, channel: 'customer_app' }, { customerPhone: phone });
    // Deliberately NOT returning the whole policy object: it carries config versions and internal reasons that a
    // public client has no business seeing.
    return { required: p.mustVerify, blocked: p.blocked, decision: p.decision, message: p.message };
  }

  /** Phase 4: how to show the human check when a send is challenged (provider + public site key, or none). */
  @Get('captcha')
  captchaConfig() { return captchaClientConfig(); }

  /** Send a code. Also used for RESEND — the cooldown is in the service, so a resend cannot bypass it by using
   *  a different route. */
  @Post('send')
  async send(@Req() r: any, @Body(ValidatedBody(VERIFICATION_SEND_BODY)) body: any) {
    const ctx = await ctxOf(r, body, this.customers, this.svc);
    if (!ctx.tenantId) throw new HttpException('Not available.', HttpStatus.FORBIDDEN);

    const phone = await this.resolvePhone(ctx);

    // BEFORE the SMS. This endpoint spends the tenant's money on every call, so the screening has to happen while
    // that is still a decision rather than a receipt.
    await this.screen(ctx, r, phone, body?.captchaToken);

    const out = await this.svc.send(ctx, phone);

    switch (out.status) {
      case 'code_sent':
        // The message is the platform's existing enumeration-safe text. The MASK is returned so the client can
        // say "we sent a code to ••••4567" — never the full number, which the spec forbids echoing back.
        return { status: out.status, bookingSessionId: sealBookingSession(ctx.bookingSessionId, { tenantId: ctx.tenantId, customerId: String(r?.ctx?.userId ?? '') || null }), maskedPhone: out.maskedPhone, message: out.message };
      case 'already_verified':
        return { status: out.status, bookingSessionId: sealBookingSession(ctx.bookingSessionId, { tenantId: ctx.tenantId, customerId: String(r?.ctx?.userId ?? '') || null }), maskedPhone: out.maskedPhone, message: out.message };
      case 'too_many_attempts':
        throw new HttpException({ status: out.status, message: out.message }, HttpStatus.TOO_MANY_REQUESTS);
      case 'rate_limited':
        throw new HttpException({ status: out.status, message: out.message, retryAfterSeconds: out.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
      case 'twilio_not_configured':
        // 503, not 500: the salon has not connected a provider. It is a configuration state, not a crash — and
        // the message never says "Twilio", because that is our problem, not the customer's.
        throw new HttpException({ status: out.status, message: out.message }, HttpStatus.SERVICE_UNAVAILABLE);
      case 'invalid_phone_number':
        throw new HttpException({ status: out.status, message: out.message }, HttpStatus.BAD_REQUEST);
      default:
        throw new HttpException({ status: out.status, message: out.message }, HttpStatus.BAD_GATEWAY);
    }
  }

  /** Check a code. On success the phone is recorded as proven, and the booking may be retried. */
  @Post('check')
  async check(@Req() r: any, @Body(ValidatedBody(VERIFICATION_CHECK_BODY)) body: any) {
    const ctx = await ctxOf(r, body, this.customers, this.svc);
    if (!ctx.tenantId) throw new HttpException('Not available.', HttpStatus.FORBIDDEN);
    // a missing, raw, forged, expired or someone-else's session token is all the same answer
    if (!ctx.sessionFromToken) throw new HttpException({ status: 'verification_failed', message: 'This verification has expired. Request a new code.' }, HttpStatus.BAD_REQUEST);

    // Same resolution as send(): a signed-in customer checks the code against THEIR number, not one they typed.
    const out = await this.svc.check(ctx, await this.resolvePhone(ctx), String(body?.code ?? ''));

    if (out.status === 'phone_verified') return { status: out.status, message: out.message };

    // 429 for a lockout (a rate problem the customer can wait out), 400 for a bad or expired code. NOTHING here
    // reveals whether a valid code existed: `code_expired` is returned for expired, already-used, and unknown
    // sessions alike, exactly as the pure core decided.
    const status = out.status === 'too_many_attempts' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_REQUEST;
    throw new HttpException({ status: out.status, message: out.message }, status);
  }
}
