// customer-activation.service.ts — orchestrates first-time Customer App activation.
//
// It performs NO policy of its own: every security decision (normalization, OTP shape, enumeration-safety,
// resolution, expiry/attempts/cooldown) is delegated to the pure core. SMS goes through the EXISTING
// NotificationsService. OTPs are hashed with the platform's existing password hasher.
import { type EphemeralGrants, hashPassword, verifyPassword } from '@aipowersalon/auth';
import { normalizePhone, maskPhone, generateOtp, otpMessage, redactOtp, isWellFormedOtp, resolveMatches, decideVerify, canResend, GENERIC_REQUEST_RESPONSE, OTP_TTL_SECONDS, checkSource, type DirectoryMatch, type SalonChoice, MSG, OTP_MAX_ATTEMPTS } from '@aipowersalon/customers';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { secureToken } from '@aipowersalon/security';
import { destinationRisk } from '../customer-booking/booking-verification-fraud';
import type { ActivationRepo } from './customer-activation.repository';

/** The tenant messenger (NotificationsService implements it) — no second SMS implementation. Before Phase 2 this was
 *  NotificationsService.send() with an EMPTY tenant, which send() refuses: no activation code was ever texted. */
export type SmsSender = Pick<TenantMessenger, 'sendSms'>;

export interface ActivationAudit {
  record(action: string, meta: Record<string, unknown>): Promise<void>;
}

/** A short-lived ticket proving "this phone was just verified", so the salon-choice step can't be forged. */
export interface VerifiedTicketStore {
  issue(phone: string, matches: DirectoryMatch[]): Promise<string>;
  consume(ticket: string): Promise<{ phone: string; matches: DirectoryMatch[] } | null>;
}

export class ActivationError extends Error {
  constructor(public code: string, public status = 400, public extra?: any) { super(code); }
}

export type RequestCodeResult = { ok: true; message: string; maskedPhone?: string };

export type VerifyResult =
  | { outcome: 'SUCCESS'; userId: string; tenantId: string; salonName: string }
  | { outcome: 'SALON_SELECTION_REQUIRED'; ticket: string; choices: SalonChoice[] }
  | { outcome: 'NEW_CUSTOMER'; ticket: string }        // verified, but no salon profile — onboarding (spec §8)
  | { outcome: 'FAILED'; message: string };

export class CustomerActivationService {
  constructor(
    private readonly repo: ActivationRepo,
    private readonly sms: SmsSender | null,
    private readonly tickets: VerifiedTicketStore,
    private readonly audit?: ActivationAudit,
    /** Constitution 12 §115: premium-rate / high-cost destinations reported to the security-event store (optional). */
    private readonly onAbuse?: (e: { risk: string; maskedPhone: string; ip: string | null }) => void,
  ) {}

  /**
   * Step 1 — request a code.
   *
   * The response is IDENTICAL whether or not the phone matches a customer, and a code is sent either way.
   * That is not an accident: a "we don't know that number" reply would turn this endpoint into a tool for
   * testing whether a given person is a client of a salon.
   */
  async requestCode(input: { phone: string; ip?: string | null; deviceId?: string | null }): Promise<RequestCodeResult> {
    const e164 = normalizePhone(input.phone || '');
    if (!e164) throw new ActivationError('invalid_phone', 400, { message: 'Enter a valid mobile phone number.' });

    // Constitution 12 §115 (finding M10): WHERE the text is going. The source throttle below limits one IP or device;
    // a distributed pumping attack spreads across thousands of them, one request each, and every request is a "first".
    // A premium-rate number is premium-rate whoever asks. This reuses the booking-verification fraud module's own
    // classifier rather than a second list. `premium_rate` (international premium / satellite ranges no salon customer
    // uses) and `elevated` (not a normalizable number) are refused. `high_cost` — any non-home country — is SENT but
    // recorded: this flow has no challenge step to offer, and a US salon can have international customers; refusing
    // them all on a guess would be wrong. Booking verification, which does have a challenge, is stricter.
    const risk = destinationRisk(e164);
    if (risk === 'premium_rate' || risk === 'elevated') {
      await this.audit?.record('customer_activation.destination_refused', { maskedPhone: maskPhone(e164), risk });
      this.onAbuse?.({ risk, maskedPhone: maskPhone(e164), ip: input.ip ?? null });
      throw new ActivationError('invalid_phone', 400, { message: 'This phone number cannot receive verification codes.' });
    }
    if (risk === 'high_cost') this.onAbuse?.({ risk, maskedPhone: maskPhone(e164), ip: input.ip ?? null });

    // Source throttle FIRST. The per-phone cooldown alone would not stop a caller walking a list of numbers
    // (one code each, cooldown never triggered) — an SMS-cost attack and a way to blast texts at strangers.
    const src = checkSource(await this.repo.sourceCounts(input.ip ?? null, input.deviceId ?? null));
    if (!src.allowed) throw new ActivationError('too_many_requests', 429, { message: src.message });

    // Resend cooldown — stops SMS pumping and stops someone spraying codes at a victim's phone.
    const last = await this.repo.latestCode(e164);
    const cd = canResend(last?.createdAt ?? null);
    if (!cd.allowed) {
      throw new ActivationError('resend_cooldown', 429, {
        message: `Please wait ${cd.retryAfterSeconds} seconds before requesting another code.`,
        retryAfterSeconds: cd.retryAfterSeconds,
      });
    }

    const code = generateOtp();
    const codeHash = await hashPassword(code);          // only the HASH is stored
    await this.repo.invalidateOutstanding(e164);        // a new code retires the old one
    await this.repo.storeCode({ phone: e164, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000), ip: input.ip ?? null, deviceId: input.deviceId ?? null });

    // Send via the EXISTING notifications service. If SMS fails we say so honestly — we never claim delivery.
    let delivered = false;
    if (this.sms) {
      // A platform text: the customer has not chosen a salon yet. `sent: false` is a failed handoff, not a delivery.
      try {
        const r = await this.sms.sendSms({ tenantId: null, to: e164, body: otpMessage(code), purpose: 'account' });
        delivered = r.sent === true;
      } catch { delivered = false; }
    }
    // NOTE: the code is never logged, never returned, and is redacted from any audit metadata.
    await this.audit?.record('customer_activation.code_requested', {
      maskedPhone: maskPhone(e164), delivered, note: redactOtp(`code issued`),
    });

    // Sep 2026 merge: the developer's version PRINTED the activation code and the phone number to the server log when
    // SMS failed, and still told the customer it was sent — anyone with log access could take over that account.
    if (!delivered) {
      throw new ActivationError('sms_unavailable', 503, {
        message: 'We could not send a verification code right now. Please try again or contact support.',
      });
    }
    return { ok: true, message: GENERIC_REQUEST_RESPONSE, maskedPhone: maskPhone(e164) };
  }

  /**
   * Step 2 — verify the code. Only AFTER this may any customer information be resolved or returned.
   * The phone alone is never proof of identity.
   */
  async verifyCode(input: { phone: string; code: string }): Promise<VerifyResult> {
    const e164 = normalizePhone(input.phone || '');
    if (!e164 || !isWellFormedOtp(input.code || '')) {
      return { outcome: 'FAILED', message: 'The verification code is incorrect.' };
    }

    // Constitution 12 §112–114: the same race the Super Admin code had — read, slow compare, check a stale attempt
    // count, consume unconditionally — so two concurrent correct submissions both succeeded and parallel guesses
    // outran the limit. The snapshot still chooses the MESSAGE (expired / used / locked); the database decides the
    // OUTCOME: an attempt is claimed atomically before comparing, and consumption is won by exactly one caller.
    const stored = await this.repo.latestCode(e164);
    const pre = decideVerify(stored, true);             // everything except "is the code right"
    const fail = async (reason: string, message: string): Promise<VerifyResult> => {
      await this.audit?.record('customer_activation.verify_failed', { maskedPhone: maskPhone(e164), reason });
      return { outcome: 'FAILED', message };
    };
    if (!pre.ok) return fail(pre.reason, pre.message);
    if (!(await this.repo.claimAttempt(stored!.id, OTP_MAX_ATTEMPTS))) {
      // Lost a race since the snapshot: another request used the code or spent the last attempt. Report the state
      // it lost to, read fresh — never "incorrect", which would invite another try.
      const again = decideVerify(await this.repo.latestCode(e164), true);
      return again.ok ? fail('too_many_attempts', MSG.too_many_attempts) : fail(again.reason, again.message);
    }
    if (!(await verifyPassword(input.code.trim(), stored!.codeHash))) return fail('incorrect', MSG.incorrect);   // attempt already counted
    if (!(await this.repo.consumeOnce(stored!.id))) return fail('already_used', MSG.already_used);             // a concurrent correct submission won

    // Resolve the directory ONLY now that possession of the phone is proven.
    const found = await this.repo.findByPhone(e164);
    const res = resolveMatches(found);

    if (res.kind === 'none') {
      // Verified, but no salon profile. Do NOT fabricate one, and do NOT create a customer under any tenant
      // until the customer establishes a real relationship (spec §8).
      const ticket = await this.tickets.issue(e164, []);
      await this.audit?.record('customer_activation.verified_new_customer', { maskedPhone: maskPhone(e164) });
      return { outcome: 'NEW_CUSTOMER', ticket };
    }

    if (res.kind === 'choose') {
      // Several salons know this number. We do NOT pick one and we do NOT merge them. The customer chooses.
      const ticket = await this.tickets.issue(e164, res.matches);
      await this.audit?.record('customer_activation.salon_selection_required', { maskedPhone: maskPhone(e164), count: res.matches.length });
      return {
        outcome: 'SALON_SELECTION_REQUIRED',
        ticket,
        // Only a display name and an opaque index — no tenant ids, no customer ids, no profile data.
        choices: res.matches.map((m, i) => ({ choiceId: String(i), salonName: m.salonName })),
      };
    }

    return this.activate(e164, res.match);
  }

  /** Step 2b — the customer picked a salon. The ticket proves the phone was just verified. */
  async selectSalon(input: { ticket: string; choiceId: string }): Promise<VerifyResult> {
    const t = await this.tickets.consume(input.ticket);
    if (!t) return { outcome: 'FAILED', message: 'Unable to verify the code. Please try again.' };
    const idx = Number(input.choiceId);
    const match = t.matches[idx];
    if (!match) return { outcome: 'FAILED', message: 'Unable to verify the code. Please try again.' };
    return this.activate(t.phone, match);
  }

  /** Link the app account to the resolved salon profile. Never duplicates the customer record. */
  private async activate(e164: string, match: DirectoryMatch): Promise<VerifyResult> {
    const linked = await this.repo.linkAccount(match, e164);
    if (!linked) return { outcome: 'FAILED', message: 'Unable to verify the code. Please try again.' };
    await this.repo.markPhoneVerified(match);
    await this.audit?.record('customer_activation.linked', {
      maskedPhone: maskPhone(e164), tenantId: match.tenantId, createdAccount: linked.created,
    });
    return { outcome: 'SUCCESS', userId: linked.userId, tenantId: match.tenantId, salonName: match.salonName };
  }
}

/** In-memory verified-ticket store (short-lived, single use). */
export class InMemoryTicketStore implements VerifiedTicketStore {
  private readonly m = new Map<string, { phone: string; matches: DirectoryMatch[]; expires: number }>();
  private readonly TTL_MS = 5 * 60 * 1000;
  async issue(phone: string, matches: DirectoryMatch[]): Promise<string> {
    // H9: was `tkt-${++n}-${Math.random()…}` — a sequence counter plus a predictable generator, on the one value that
    // proves a phone was verified. 256 bits from node:crypto; no counter.
    const t = `tkt_${secureToken(32)}`;
    this.m.set(t, { phone, matches, expires: Date.now() + this.TTL_MS });
    return t;
  }
  async consume(ticket: string) {
    const v = this.m.get(ticket);
    if (!v) return null;
    this.m.delete(ticket);                    // single use
    if (Date.now() > v.expires) return null;
    return { phone: v.phone, matches: v.matches };
  }
}

/**
 * Durable tickets (migration 456): survive a deploy and work on any instance. The token is 256-bit (H9) and only its
 * SHA-256 is stored; take() is one atomic DELETE … RETURNING, so a ticket is redeemed exactly once.
 */
export class GrantTicketStore implements VerifiedTicketStore {
  constructor(private readonly grants: EphemeralGrants, private readonly ttlMs = 5 * 60 * 1000) {}
  async issue(phone: string, matches: DirectoryMatch[]): Promise<string> { return 'tkt_' + (await this.grants.put('activation_ticket', { phone, matches }, this.ttlMs)); }
  async consume(ticket: string) {
    const t = String(ticket || ''); if (!t.startsWith('tkt_')) return null;
    return this.grants.take<{ phone: string; matches: DirectoryMatch[] }>('activation_ticket', t.slice(4));
  }
}
