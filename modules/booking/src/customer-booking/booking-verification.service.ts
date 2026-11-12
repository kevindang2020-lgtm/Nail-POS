import { branchOrNull } from '@aipowersalon/tenant-context';
import type { SmsPurpose } from '@aipowersalon/communications';
// booking-verification.service.ts — send a six-digit code, check it, and record that the phone is proven.
//
// ── This is the piece that makes the gate USABLE ────────────────────────────────────────────────────────
// The guard refuses a booking whose phone is not proven. Until something can actually PROVE a phone, that guard
// refuses everything — correct, but useless. This closes the loop:
//
//     refuse → send → check → record → retry → the resolver sees a fresh verification → the booking proceeds.
//
// The "record" step writes `booking_verified_phones`, which is the exact row the policy resolver reads. Nothing
// holds a session open to make that work, and nothing needs to.
//
// ── What is reused, not rewritten ───────────────────────────────────────────────────────────────────────
// `customer-activation-core` already owns: E.164 normalization, masking, cryptographically-secure 6-digit
// generation, expiry, attempt limits, resend cooldown, one-time use, and enumeration-safe responses. It is
// imported. A second OTP implementation would be a second thing to get wrong, and a second place to leak a code
// from.
import {
  normalizePhone, maskPhone, phoneKey, generateOtp, isWellFormedOtp,
  decideVerify, canResend, GENERIC_REQUEST_RESPONSE, OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS as MAX_VERIFY_ATTEMPTS, MAX_CODES_PER_IP_HOUR, MAX_CODES_PER_DEVICE_HOUR,
  type CodeState,
} from '@aipowersalon/customers';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { recordMessagingEvent } from '@aipowersalon/observability';   // wave 3 PAYI §105: verification attempts / successes / rate-limit hits
import type {
  TenantCredentialResolver, VerificationProvider, TenantTwilioCredentials,
} from './booking-verification-provider';
import type { BookingChannel } from './booking-verification-policy';

export interface VerificationCtx {
  /** The request's source. Recorded so the fraud engine can COUNT it — see booking-verification-fraud.ts. */
  requestIp?: string | null;
  deviceId?: string | null;
  tenantId: string;
  branchId: string;
  channel: BookingChannel;
  /** Server-issued. Never a client-supplied id — it is what binds a verification to ONE booking attempt. */
  bookingSessionId: string;
  customerId?: string | null;
  /** §17 billing purpose for the entitlement ledger. Callers that are NOT booking (the phone-change port) name
   *  their own; absent = BOOKING_VERIFICATION. */
  purpose?: SmsPurpose;
  /** Phase 4: the customer's language (Twilio Verify words the text in it; the code itself is just digits). */
  locale?: string | null;
}

/** The languages a salon's customers get their verification text in (Twilio Verify locales). Anything else: English. */
const VERIFY_LOCALES = new Set(['en', 'es', 'vi', 'zh', 'ko', 'fr', 'pt', 'ru', 'ar', 'hi', 'tl', 'ja', 'de', 'it', 'pl']);
export function verifyLocale(raw: string | null | undefined): string | undefined {
  const l = String(raw ?? '').trim().toLowerCase().split(/[-_,;]/)[0];
  return VERIFY_LOCALES.has(l) && l !== 'en' ? l : undefined;
}

export type SessionStatus = 'pending' | 'sent' | 'verified' | 'failed' | 'expired' | 'locked' | 'canceled';

/** The rows this service needs. Kysely-backed in production; faked in tests. */
export interface VerificationStore {
  /** The verification session for this booking session, if any (the latest). */
  findSession(tenantId: string, bookingSessionId: string): Promise<{
    id: string; phoneHash: string; codeHash: string | null; attempts: number;
    expiresAt: number; lastSentAt: number | null; resendCount: number; consumed: boolean;
    providerVerificationSid: string | null; provider: string;
    /** Phase 4. Absent in older fakes = treated as 'sent'. */
    status?: SessionStatus;
    /** Phase 4: the location the booking (and its hold) is for. */
    branchId?: string | null;
  } | null>;
  createSession(input: {
    tenantId: string; branchId: string; bookingSessionId: string; customerId: string | null;
    phoneHash: string; phoneMask: string; channel: string; provider: string;
    providerServiceSid: string | null; providerVerificationSid: string | null;
    codeHash: string | null; expiresAt: number;
    /** WHERE the request came from. Without these the fraud engine's two best signals — spray and scripted
     *  abuse — have nothing to count, and every IP-based rule is permanently 0. */
    requestIp?: string | null; deviceId?: string | null;
  }): Promise<{ id: string }>;
  /** Phase 4: before the provider is called — the session exists before any billed send (audit bug 11). */
  prepareSend?(sessionId: string, provider: string, providerServiceSid: string | null, from?: { requestIp: string | null; deviceId: string | null }): Promise<void>;
  markSent(sessionId: string, at: number, providerVerificationSid: string | null, codeHash?: string | null, expiresAt?: number): Promise<void>;
  markSendFailed?(sessionId: string, reason: string): Promise<void>;
  /** The number changed before anything was proven: start this session's verification over for the new number. */
  rebindPhone?(sessionId: string, phoneHash: string, phoneMask: string): Promise<void>;
  /**
   * Phase 4 (found by the real-Postgres race lane): take ONE attempt from the session's budget atomically, BEFORE the
   * code is compared. Returns the attempts used including this one, or null when none are left (or the session is no
   * longer open). Reading the count and bumping it afterwards let N simultaneous guesses each see "0 used" — an
   * unlimited brute force of a six-digit code.
   */
  reserveAttempt(sessionId: string, max: number): Promise<number | null>;
  /** The provider failed (not the customer): give the reserved attempt back. */
  refundAttempt?(sessionId: string): Promise<void>;
  /** Codes sent in the last hour from this IP / this device, across every salon (the hard caps). */
  sendsLastHour?(ip: string | null, deviceId: string | null): Promise<{ ip: number; device: number }>;
  /** The attempts ran out — lock, and give the held slot back. */
  lock?(sessionId: string): Promise<void>;
  /** true = this call verified it; false = it was no longer open (another check verified or locked it). void = legacy store (treated as true). */
  markVerified(sessionId: string, at: number): Promise<boolean | void>;
  markFailed(sessionId: string, reason: string): Promise<void>;
  /** The durable "this phone is proven for this tenant" record the POLICY reads. */
  recordVerifiedPhone(input: {
    tenantId: string; customerId: string | null; phoneHash: string; phoneMask: string;
    provider: string; channel: string; verifiedAt: number;
  }): Promise<void>;
}

export type SendOutcome =
  | { status: 'code_sent'; maskedPhone: string; message: string }
  | { status: 'invalid_phone_number'; message: string }
  | { status: 'twilio_not_configured'; message: string }
  | { status: 'code_send_failed'; message: string }
  | { status: 'rate_limited'; retryAfterSeconds: number; message: string }
  /** Phase 4: this booking session is already proven (finish the booking), or locked (start again). */
  | { status: 'already_verified'; maskedPhone: string; message: string }
  | { status: 'too_many_attempts'; message: string };

export type CheckOutcome =
  | { status: 'phone_verified'; message: string }
  | { status: 'incorrect_code'; message: string }
  | { status: 'code_expired'; message: string }
  | { status: 'too_many_attempts'; message: string }
  | { status: 'verification_failed'; message: string };

/** Never reveals whether a number is already a customer, or whether a session exists. */
const SAFE_SENT = GENERIC_REQUEST_RESPONSE;

export class BookingVerificationService {
  constructor(
    private readonly creds: TenantCredentialResolver,
    private readonly providers: { twilio_verify: VerificationProvider; internal_otp?: VerificationProvider },
    private readonly store: VerificationStore,
    /** Sends the internal-OTP SMS through the TENANT's own sender. Absent = no internal fallback available. */
    private readonly sendSms?: (creds: TenantTwilioCredentials, toE164: string, body: string) => Promise<{ sid: string }>,
    /** §14 entitlement gate (sms-packages). OPTIONAL by design: harnesses without it behave as the rollout-safe
     *  no-package path; the module always wires it in production. */
    private readonly entitlement?: { precheck(t: string, p: string): Promise<{ allowed: boolean; reason?: string }>; recordSubmission(t: string, p: string, i: Record<string, unknown>): Promise<unknown> },
  ) {}

  /**
   * Phase 4 (found by the live proof): the location a booking session belongs to. A signed-in customer's session
   * carries no branch, so the code request for the customer app's 428 had none — and was refused ("choose the salon
   * location first"). The session the refusal opened knows its branch; that is the one the code is for.
   */
  async sessionBranch(tenantId: string, bookingSessionId: string): Promise<string | null> {
    return (await this.store.findSession(tenantId, bookingSessionId).catch(() => null))?.branchId ?? null;
  }

  /**
   * Send (or resend) a code.
   *
   * Order matters, and each step exists to stop a specific abuse:
   *   1. normalize   — an unparseable number cannot be verified, and must not be treated as if it were
   *   2. resolve tenant credentials — FAIL CLOSED; no shared platform account (see the provider file)
   *   3. resend cooldown — stops SMS-pumping and stops someone spraying codes at a victim's phone
   *   4. send via the tenant's own Twilio
   */
  async send(ctx: VerificationCtx, rawPhone: string, now = Date.now()): Promise<SendOutcome> {
    const e164 = normalizePhone(String(rawPhone ?? ''));
    if (!e164) return { status: 'invalid_phone_number', message: 'That phone number does not look valid. Please check it and try again.' };
    // A code is only ever sent FOR a location: the session row's branch_id is a UUID NOT NULL. Refuse before anything
    // is sent (a billed code nobody could ever check).
    if (!branchOrNull(ctx.branchId)) return { status: 'code_send_failed', message: 'Choose the salon location for this booking first, then request a code.' };

    const resolution = await this.creds.resolve(ctx.tenantId, ctx.branchId);
    if (resolution.status !== 'configured' || !resolution.credentials) {
      // NOT a silent fallback to the platform's Twilio (billed to us, from a sender the customer never saw).
      return { status: 'twilio_not_configured', message: 'Online booking is temporarily unavailable. Please call the salon to book.' };
    }
    const credentials = resolution.credentials;
    const kind = resolution.kind ?? 'twilio_verify';
    if (kind === 'internal_otp' && !this.sendSms) return { status: 'twilio_not_configured', message: 'Online booking is temporarily unavailable. Please call the salon to book.' };

    const hash = phoneKey(e164);
    const mask = maskPhone(e164);
    let existing = await this.store.findSession(ctx.tenantId, ctx.bookingSessionId);

    // Phase 4: a session's state decides whether a code may go out at all.
    if (existing?.status === 'verified') return { status: 'already_verified', maskedPhone: mask, message: 'Your phone number is verified. Finish your booking.' };
    if (existing?.status === 'locked') return { status: 'too_many_attempts', message: 'Too many attempts. Please start your booking again.' };
    if (existing && (existing.status === 'expired' || existing.status === 'failed' || existing.status === 'canceled')) existing = null;   // a new attempt
    // The number changed before anything was proven: this session now verifies the NEW number (the proof binds to it).
    if (existing && existing.phoneHash !== hash) {
      if (!this.store.rebindPhone) return { status: 'invalid_phone_number', message: 'Start your booking again with this number.' };
      await this.store.rebindPhone(existing.id, hash, mask);
      existing = { ...existing, phoneHash: hash, lastSentAt: null, attempts: 0, codeHash: null };
    }

    // Resend cooldown: stops SMS pumping and spraying codes at a victim's phone.
    if (existing?.lastSentAt) {
      const rs = canResend(existing.lastSentAt, now);
      if (!rs.allowed) {
        recordMessagingEvent('rate_limited');
        return { status: 'rate_limited', retryAfterSeconds: rs.retryAfterSeconds, message: `Please wait ${rs.retryAfterSeconds}s before requesting another code.` };
      }
    }

    // Hard caps per IP and per device, across every salon (Phase 4). The risk engine scores and challenges; these
    // simply stop — one address cannot text a stream of numbers however good its CAPTCHA solver is.
    if (this.store.sendsLastHour && (ctx.requestIp || ctx.deviceId)) {
      const n = await this.store.sendsLastHour(ctx.requestIp ?? null, ctx.deviceId ?? null).catch(() => ({ ip: 0, device: 0 }));
      if ((ctx.requestIp && n.ip >= MAX_CODES_PER_IP_HOUR) || (ctx.deviceId && n.device >= MAX_CODES_PER_DEVICE_HOUR)) {
        recordMessagingEvent('rate_limited');
        return { status: 'rate_limited', retryAfterSeconds: 3600, message: 'Too many codes have been requested. Please try again later, or call the salon.' };
      }
    }

    if (this.entitlement) {
      const ent = await this.entitlement.precheck(ctx.tenantId, ctx.purpose ?? 'BOOKING_VERIFICATION');
      if (!ent.allowed) {
        // §15 hard limit: explicit and honest — the salon's allowance is spent and their package forbids overage.
        return { status: 'code_send_failed', message: 'This salon has reached its SMS verification limit for the billing period. Please call the salon to book, or try again after the limit resets.' };
      }
    }

    // The session exists BEFORE the provider is called (audit bug 11: a billed code with no session was lost).
    const sessionId = existing?.id ?? (await this.store.createSession({
      tenantId: ctx.tenantId, branchId: ctx.branchId, bookingSessionId: ctx.bookingSessionId,
      customerId: ctx.customerId ?? null, phoneHash: hash, phoneMask: mask, channel: ctx.channel,
      provider: kind, providerServiceSid: kind === 'twilio_verify' ? credentials.verifyServiceSid ?? null : null, providerVerificationSid: null,
      codeHash: null, expiresAt: now + OTP_TTL_SECONDS * 1000,
      requestIp: ctx.requestIp ?? null, deviceId: ctx.deviceId ?? null,
    })).id;
    if (existing) await this.store.prepareSend?.(sessionId, kind, kind === 'twilio_verify' ? credentials.verifyServiceSid ?? null : null, { requestIp: ctx.requestIp ?? null, deviceId: ctx.deviceId ?? null });
    const expiresAt = now + OTP_TTL_SECONDS * 1000;
    recordMessagingEvent('verification_attempt');

    if (kind === 'twilio_verify') {
      // Twilio generates, sends, expires and checks the code. WE NEVER SEE IT.
      const r = await this.providers.twilio_verify.send(credentials, e164, { locale: verifyLocale(ctx.locale) });
      if (!r.ok) {
        // the reason plus the provider's error CODE (never its text) so Provider Failure Triage can group it
        await this.store.markSendFailed?.(sessionId, String(r.reason ?? 'provider_error') + (r.providerCode ? ':' + r.providerCode : ''));
        return { status: 'code_send_failed', message: 'We could not send a verification code right now. Please try again shortly.' };
      }
      await this.store.markSent(sessionId, now, r.providerVerificationSid ?? null, undefined, expiresAt);
      if (this.entitlement) {
        await this.entitlement.recordSubmission(ctx.tenantId, ctx.purpose ?? 'BOOKING_VERIFICATION', {
          providerMessageId: r.providerVerificationSid ?? null, recipientMasked: mask, branchId: ctx.branchId ?? null,
        }).catch(() => {});   // billing must never break the customer's code delivery
      }
      return { status: 'code_sent', maskedPhone: mask, message: SAFE_SENT };
    }

    // ── the internal fallback: a salon with a sending number and no Verify Service ──
    // The code is generated securely, texted from the SALON's own number, and only its HASH is kept.
    const code = generateOtp();
    const codeHash = await hashPassword(code);
    const body = `Your verification code is ${code}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes. Do not share it.`;
    let sid: string | null = null;
    try { sid = (await this.sendSms!(credentials, e164, body)).sid ?? null; }
    catch {
      await this.store.markSendFailed?.(sessionId, 'provider_error');
      return { status: 'code_send_failed', message: 'We could not send a verification code right now. Please try again shortly.' };
    }
    await this.store.markSent(sessionId, now, sid, codeHash, expiresAt);
    if (this.entitlement) {
      await this.entitlement.recordSubmission(ctx.tenantId, ctx.purpose ?? 'BOOKING_VERIFICATION', { providerMessageId: sid, recipientMasked: mask, branchId: ctx.branchId ?? null }).catch(() => {});
    }
    return { status: 'code_sent', maskedPhone: mask, message: SAFE_SENT };
  }

  /**
   * Check a code, and — only on success — record that the phone is proven.
   *
   * The recording is what closes the loop: `booking_verified_phones` is exactly the row the policy resolver
   * reads, so the next booking attempt sees `recent_verification_accepted` and proceeds. Nothing else in the
   * system needs to know this happened.
   */
  async check(ctx: VerificationCtx, rawPhone: string, code: string, now = Date.now()): Promise<CheckOutcome> {
    const e164 = normalizePhone(String(rawPhone ?? ''));
    // A malformed code is rejected WITHOUT touching the provider or the store. It cannot be right, so spending a
    // Twilio call — or an attempt from the customer's limited budget — on it would be both wasteful and unfair.
    if (!e164 || !isWellFormedOtp(String(code ?? ''))) {
      return { status: 'incorrect_code', message: 'That code is incorrect.' };
    }

    const session = await this.store.findSession(ctx.tenantId, ctx.bookingSessionId);
    if (!session) return { status: 'code_expired', message: 'This verification has expired. Request a new code.' };
    // Phase 4: the session's state first. Locked stays locked; an expired, failed or canceled one cannot be proven.
    if (session.status === 'locked') return { status: 'too_many_attempts', message: 'Too many attempts. Please start your booking again.' };
    if (session.status === 'expired' || session.status === 'failed' || session.status === 'canceled') return { status: 'code_expired', message: 'This verification has expired. Request a new code.' };
    if (session.status === 'verified') return { status: 'phone_verified', message: 'Your phone number is verified.' };
    if (session.status === 'pending' || (session.status === undefined && !session.lastSentAt && !session.codeHash && !session.providerVerificationSid)) {
      return { status: 'code_expired', message: 'Request a code first.' };
    }

    // The verification is bound to the PHONE it was sent to. Changing the number after the code was sent, then
    // presenting the code, would verify a number that was never texted — the exact "changing the phone number
    // invalidates the verification" rule, enforced rather than documented.
    if (session.phoneHash !== phoneKey(e164)) {
      return { status: 'code_expired', message: 'This verification has expired. Request a new code.' };
    }

    // Expiry / attempts / one-time-use — the EXISTING pure decision function, not a second implementation.
    const state: CodeState = {
      attempts: session.attempts,
      expiresAt: session.expiresAt,
      consumed: session.consumed,
      createdAt: session.lastSentAt ?? now,
    };

    // Expiry / exhausted budget BEFORE anything is spent (no Twilio call for a locked-out session).
    const pre = decideVerify(state, true, now);
    if (!pre.ok) {
      // Booking Phone Verification guide §8 (found by the real-Postgres race, Oct 31 2026): the budget read here may be
      // used up by attempts still IN FLIGHT — one of which may be the correct code. Locking now beat that code's
      // verification and locked out a customer who typed the right number. The lock belongs to the attempt that spends the
      // LAST slot on a wrong code (below); this request only reports, after one re-read.
      if (pre.reason === 'too_many_attempts') return this.overBudget(ctx, session.id);
      return this.mapDecision(pre, session.id);
    }
    let resolution: Awaited<ReturnType<TenantCredentialResolver['resolve']>> | null = null;
    if (session.provider === 'twilio_verify') {
      resolution = await this.creds.resolve(ctx.tenantId, ctx.branchId);
      if (resolution.status !== 'configured' || !resolution.credentials) {
        return { status: 'verification_failed', message: 'We could not verify that code right now. Please try again shortly.' };
      }
    }

    // The attempt is TAKEN before the code is compared — atomically, so simultaneous guesses share one budget.
    const used = await this.store.reserveAttempt(session.id, MAX_VERIFY_ATTEMPTS);
    if (used == null) return this.overBudget(ctx, session.id);   // no lock here — see above

    let codeMatches = false;
    if (session.provider === 'twilio_verify') {
      const r = await this.providers.twilio_verify.check(resolution!.credentials!, e164, String(code));
      codeMatches = r.ok;
      if (!r.ok && r.reason === 'provider_error') {
        await this.store.refundAttempt?.(session.id);   // our failure, not the customer's guess
        return { status: 'verification_failed', message: 'We could not verify that code right now. Please try again shortly.' };
      }
    } else {
      codeMatches = session.codeHash ? await verifyPassword(String(code), session.codeHash) : false;
    }

    const decision = decideVerify({ ...state, attempts: used - 1 }, codeMatches, now);
    if (!decision.ok) {
      // This was the last attempt: lock the session and give the slot back.
      if (decision.reason === 'too_many_attempts' || (decision.reason === 'incorrect' && used >= MAX_VERIFY_ATTEMPTS)) {
        await this.store.lock?.(session.id);
        return { status: 'too_many_attempts', message: 'Too many attempts. Please start your booking again.' };
      }
      return this.mapDecision(decision, session.id);
    }

    const won = await this.store.markVerified(session.id, now);
    if (won === false) {
      // another request settled the session first: a concurrent correct code (→ verified) or the last wrong guess (→ locked)
      const after = await this.store.findSession(ctx.tenantId, ctx.bookingSessionId);
      if (after?.status !== 'verified') return { status: 'too_many_attempts', message: 'Too many attempts. Please start your booking again.' };
      return { status: 'phone_verified', message: 'Your phone number is verified.' };   // the winner recorded the phone
    }

    // ── close the loop ──
    // This row is what the policy resolver reads. Writing it is the ONLY thing that turns `mustVerify` off for
    // the next booking attempt. It is tenant-scoped by its unique key, so a phone proven at this salon proves
    // nothing at any other.
    await this.store.recordVerifiedPhone({
      tenantId: ctx.tenantId,
      customerId: ctx.customerId ?? null,
      phoneHash: phoneKey(e164),
      phoneMask: maskPhone(e164),
      provider: session.provider,
      channel: ctx.channel,
      verifiedAt: now,
    });
    recordMessagingEvent('verification_success');

    return { status: 'phone_verified', message: 'Your phone number is verified.' };
  }

  /** Over the attempt budget: no lock from here (an in-flight attempt may be the right code) — one re-read decides the answer. */
  private async overBudget(ctx: VerificationCtx, _sessionId: string): Promise<CheckOutcome> {
    const after = await this.store.findSession(ctx.tenantId, ctx.bookingSessionId);
    if (after?.status === 'verified') return { status: 'phone_verified', message: 'Your phone number is verified.' };
    return { status: 'too_many_attempts', message: 'Too many attempts. Please start your booking again.' };
  }

  private mapDecision(d: Exclude<ReturnType<typeof decideVerify>, { ok: true }>, _sessionId: string): CheckOutcome {
    switch (d.reason) {
      case 'too_many_attempts': return { status: 'too_many_attempts', message: d.message };
      // `expired`, `already_used` and `no_code` all return the SAME text from the core, on purpose: telling a
      // caller "that code was already used" confirms a valid code existed, which is an enumeration oracle.
      case 'expired':
      case 'already_used':
      case 'no_code': return { status: 'code_expired', message: d.message };
      default: return { status: 'incorrect_code', message: d.message };
    }
  }
}
