// booking-verification-guard.ts — ONE gate, used by every remote booking channel.
//
// ── Why this file exists at all ─────────────────────────────────────────────────────────────────────────
// There are three places an appointment can be created remotely, and they are three different services:
//
//   • customer app        → CustomerBookingService.book()
//   • public booking page → AiBookingMutationService.createAppointment()   (unauthenticated, signed-token)
//   • AI receptionist     → VoiceBookingWriteService.createAppointment()
//
// If each one enforced verification its own way, they would drift — and the fraud would simply move to
// whichever channel drifted first. That is not hypothetical: the whole reason booking abuse works is that
// attackers probe every entrance until one of them is unlocked. So all three call THIS, and there is exactly
// one implementation of "may this appointment exist yet".
//
// ── PURE core, injected edges ───────────────────────────────────────────────────────────────────────────
// The decision is made by `resolveBookingVerificationPolicy` (pure). This service only fetches the inputs the
// resolver needs — tenant/branch/platform config, provider health, and whether THIS phone is already verified
// FOR THIS TENANT — and turns a refusal into a typed error each channel maps to its own transport.
import { normalizePhone, phoneKey, maskPhone } from '@aipowersalon/customers';
import {
  resolveBookingVerificationPolicy,
  type BookingChannel, type PolicyResult, type PlatformPolicy, type TenantPolicy, type BranchPolicy,
  type ProviderStatus, type VerificationHistory, type BookingRisk,
} from './booking-verification-policy';

/** Refused: the phone behind this booking has not been proven. The appointment was NOT created. */
export class BookingPhoneNotVerifiedError extends Error {
  readonly code = 'PHONE_VERIFICATION_REQUIRED';
  /** Phase 4: the booking session the code is sent for (raw; each channel seals it for its own transport), and how
   *  long the slot is held for it (null when no slot was held). */
  readonly bookingSessionId: string | null;
  readonly holdExpiresAt: number | null;
  constructor(msg: string, readonly maskedPhone: string, readonly policyReason: string, extra: { bookingSessionId?: string | null; holdExpiresAt?: number | null } = {}) {
    super(msg);
    this.bookingSessionId = extra.bookingSessionId ?? null;
    this.holdExpiresAt = extra.holdExpiresAt ?? null;
  }
}

/** Refused: verification is required and we cannot perform it. The appointment was NOT created. */
export class BookingVerificationUnavailableError extends Error {
  readonly code = 'PHONE_VERIFICATION_UNAVAILABLE';
  constructor(msg: string, readonly policyReason: string) { super(msg); }
}

/** Refused: the number is not a number we can send to. */
export class BookingPhoneInvalidError extends Error {
  readonly code = 'INVALID_PHONE_NUMBER';
  constructor(msg = 'That phone number does not look valid. Please check it and try again.') { super(msg); }
}

/** Everything the guard needs to look up. Implemented over Kysely; faked in tests. */
export interface BookingVerificationConfigPort {
  platform(tenantId: string): Promise<PlatformPolicy>;
  tenant(tenantId: string): Promise<TenantPolicy>;
  branch(tenantId: string, branchId: string): Promise<BranchPolicy | null>;
  /** Provider status for THIS tenant (and branch, when the branch overrides the tenant's Twilio). */
  provider(tenantId: string, branchId: string): Promise<ProviderStatus>;
  /**
   * Has this phone been proven FOR THIS TENANT, and when?
   *
   * `phoneHash` — never the raw number. The lookup is tenant-scoped by the caller AND by the table's
   * `UNIQUE (tenant_id, phone_hash)`, so "verified at tenant A" can never satisfy a booking at tenant B. That
   * is the spec's default and it is enforced in two places on purpose.
   */
  lastVerified(tenantId: string, phoneHash: string): Promise<{ verifiedAt: number; revoked?: boolean } | null>;
  /**
   * Phase 4 (audit: "session binding"): the last time THIS phone was proven by SMS from THIS device, for this tenant.
   * The anonymous public link trusts a recent verification only from the same device — otherwise anybody who knew a
   * recently verified number could book in that person's name without a code.
   */
  lastVerifiedOnDevice?(tenantId: string, phoneHash: string, deviceId: string): Promise<number | null>;
}

/**
 * Whose earlier verification may excuse this booking (Phase 4, session binding):
 *   customer_app     the account's own number (resolved server-side) — the account is the binding;
 *   online           the same device only (the public link has no account);
 *   kiosk            never — a shared device in the salon;
 *   ai_receptionist  never — caller ID is trivially spoofed;
 *   front_desk / walk_in  staff channels (the account rule).
 */
export type TrustScope = 'account' | 'device' | 'none';
export function trustScopeFor(channel: BookingChannel): TrustScope {
  if (channel === 'online') return 'device';
  if (channel === 'kiosk' || channel === 'ai_receptionist') return 'none';
  return 'account';
}

export interface GuardCtx {
  tenantId: string;
  branchId: string;
  channel: BookingChannel;
}

export interface GuardInput {
  /** The phone the CUSTOMER gave for this booking. Raw; normalized here. */
  customerPhone?: string | null;
  /** The requesting device (public link): an earlier verification counts only from the same device. */
  deviceId?: string | null;
  risk?: BookingRisk | null;
  now?: number;
}

export class BookingVerificationGuard {
  constructor(private readonly cfg: BookingVerificationConfigPort) {}

  /** Resolve the policy without enforcing it — for a "do I need to verify?" probe from a client. */
  async resolve(ctx: GuardCtx, input: GuardInput): Promise<PolicyResult> {
    const now = input.now ?? Date.now();
    const e164 = input.customerPhone ? normalizePhone(String(input.customerPhone)) : null;

    const [platform, tenant, branch, provider] = await Promise.all([
      this.cfg.platform(ctx.tenantId),
      this.cfg.tenant(ctx.tenantId),
      this.cfg.branch(ctx.tenantId, ctx.branchId),
      this.cfg.provider(ctx.tenantId, ctx.branchId),
    ]);

    // History is only consulted for a phone we could actually normalize. An unparseable number has no history,
    // which means it cannot inherit anybody else's trust either.
    let history: VerificationHistory | null = null;
    if (e164) {
      const last = await this.cfg.lastVerified(ctx.tenantId, phoneKey(e164));
      // Phase 3 (audit E7): this was hard-coded `phoneChanged: false`. A number whose verification was revoked —
      // retired from a customer's record — is a CHANGED phone: it always re-verifies, and its old trust never counts.
      if (last?.revoked) history = { lastVerifiedAt: null, phoneChanged: true };
      else {
        // Phase 4: which earlier verification may count depends on who is asking (trustScopeFor above).
        const scope = trustScopeFor(ctx.channel);
        let at: number | null = null;
        if (scope === 'account') at = last?.verifiedAt ?? null;
        else if (scope === 'device' && input.deviceId && this.cfg.lastVerifiedOnDevice) at = await this.cfg.lastVerifiedOnDevice(ctx.tenantId, phoneKey(e164), String(input.deviceId));
        history = { lastVerifiedAt: at, phoneChanged: false };
      }
    }

    return resolveBookingVerificationPolicy({
      channel: ctx.channel, platform, tenant, branch, provider, history, risk: input.risk ?? null, now,
    });
  }

  /**
   * ENFORCE. Throws unless this appointment is allowed to exist.
   *
   * Call this BEFORE creating the appointment, in every remote channel. Returning normally is the ONLY thing
   * that may be read as permission — a caller that catches and continues has defeated the module.
   */
  async assertMayBook(ctx: GuardCtx, input: GuardInput): Promise<PolicyResult> {
    const policy = await this.resolve(ctx, input);

    // Required, but we cannot do it. REFUSE. Letting the booking through here — "the provider is down, so skip
    // the check" — switches the feature off during precisely the incident it exists for, and it is the single
    // easiest way to ship a verification system that verifies nothing.
    if (policy.blocked) {
      throw new BookingVerificationUnavailableError(policy.message, policy.reason);
    }
    if (!policy.mustVerify) return policy;               // disabled / not required / recent verification accepted

    // From here, verification IS required for this booking.
    const raw = input.customerPhone ? String(input.customerPhone) : '';
    const e164 = raw ? normalizePhone(raw) : null;
    // No number, or a number we cannot even parse into E.164, cannot be verified — so the booking cannot
    // proceed. Refusing is the honest outcome; accepting an unparseable number and skipping the check would let
    // an attacker opt out of verification simply by typing rubbish.
    if (!e164) throw new BookingPhoneInvalidError();

    // Refuse — and note what "verified" actually means here, because it is the whole loop:
    //
    //   the resolver ALREADY read this phone's verification history and applied the tenant's re-verification
    //   window to it. So `mustVerify === true` means precisely "no acceptable prior verification exists for this
    //   phone, under this tenant, right now". Re-reading the history at this point would decide nothing, and a
    //   second opinion that could disagree with the resolver is exactly how a channel drifts.
    //
    // The loop is: refuse → the customer proves the phone → we write `booking_verified_phones` → the customer
    // retries → the resolver now sees a fresh verification and returns `recent_verification_accepted` →
    // `mustVerify` is false → the booking proceeds. Nothing here needs to hold a session open to make that work.
    throw new BookingPhoneNotVerifiedError(policy.message, maskPhone(e164), policy.reason);
  }
}
