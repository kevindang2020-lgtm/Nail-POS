// customer-identity-phone.service.ts — changing the phone number a customer SIGNS IN WITH.
//
// ══ THIS ONE IS DIFFERENT, AND THE DIFFERENCE IS ACCOUNT TAKEOVER ═════════════════════════════════════════
//
// Every other phone in this system is a CONTACT NUMBER. This one is a CREDENTIAL:
//
//     auth-user.kysely.repository:  select * from customer_identities where normalized_phone = $1
//
// That is how a customer signs in. `customer_identities.normalized_phone` is NOT NULL UNIQUE, and changing it
// changes **who can log in as this person.**
//
// So the threat is not "a mistyped number" (which is what the tenant-side change risks). The threat is:
//
//     an attacker with a STOLEN SESSION — a borrowed phone, an unlocked laptop, a hijacked token — changes the
//     login phone to their own, and now they own the account. The real customer is locked out of their own
//     history, their bookings, and the recovery flow, and the attacker holds the number every future code goes to.
//
// A stolen session is EXACTLY the situation a "change my phone" endpoint is most likely to be used in by someone
// who should not be using it. Four controls, and each one closes a specific step of that attack:
//
//   1. REAUTHENTICATE.  A session is not enough. Prove the PASSWORD. A stolen session does not carry one.
//   2. VERIFY THE NEW NUMBER FIRST.  Nothing changes until an SMS arrives at the new handset and is answered.
//   3. ROTATE SESSIONS.  Every other session is revoked. If the attacker was riding one, it dies here — and if the
//      VICTIM was the attacker's target, the victim's session dying is how they notice.
//   4. NOTIFY THE OLD NUMBER.  The single most valuable control in the file. It is the only one an attacker cannot
//      suppress, and it is how a real customer finds out their account is being taken — while the old number is
//      still theirs.
//
// Control 4 is the reason the old number is notified BEFORE it is retired. Retire it first and the notification
// goes to a number we have just stopped believing in.
import type { AuditSink } from '@aipowersalon/audit';
import { normalizePhone, maskPhone, phoneKey } from '@aipowersalon/customers';

export class IdentityPhoneError extends Error {
  constructor(msg: string, readonly code: 'forbidden' | 'reauth_required' | 'invalid_phone' | 'in_use' | 'not_verified' | 'notify_unavailable') { super(msg); }
}

export interface IdentityStore {
  /** The signed-in customer's identity, and their current login phone. */
  identityFor(userId: string): Promise<{ identityId: string; normalizedPhone: string; passwordHash: string | null } | null>;
  /** Is this number already SOMEBODY ELSE's login? `customer_identities.normalized_phone` is UNIQUE. */
  phoneTakenByAnother(identityId: string, e164: string): Promise<boolean>;
  /** Move the login phone. */
  setIdentityPhone(identityId: string, e164: string): Promise<boolean>;
  /**
   * Did THIS signed-in customer prove this number by SMS, through the phone-change flow, within the last
   * `withinMinutes`? (Phase 3, audit E5: before, any valid number was accepted after the password check.)
   */
  provenRecently(userId: string, phoneHash: string, withinMinutes: number): Promise<boolean>;
}

export interface AuthPort {
  /** Reauthentication. A session is not proof; a password is. */
  verifyPassword(hash: string, password: string): Promise<boolean>;
  /** Kill every other session for this person. */
  revokeAllSessions(userId: string): Promise<void>;
}

export interface SecurityNotifier {
  /**
   * Told to the OLD number, while it is still theirs.
   *
   * Masked. It says THAT the login phone changed, never what it changed to — telling a victim the attacker's number
   * would be handing them a target, and telling an attacker the victim's number would be handing them a victim.
   */
  loginPhoneChanged(input: { userId: string; tenantId?: string | null; maskedOld: string; maskedNew: string; oldPhoneE164: string }): Promise<{ sent: boolean; simulated?: boolean } | void>;
}

/** How recent the SMS proof of the new number must be. */
export const LOGIN_PHONE_PROOF_MINUTES = 30;

export class CustomerIdentityPhoneService {
  constructor(
    private readonly store: IdentityStore,
    private readonly auth: AuthPort,
    private readonly notify: SecurityNotifier,
    private readonly audit?: AuditSink,
    /** production: a warning that was not really sent (simulated, or no provider) stops the change. */
    private readonly env: { production: boolean } = { production: process.env.NODE_ENV === 'production' },
  ) {}

  /** A fresh password check for this signed-in customer: ok, failed, or the account has no password to check. */
  async reauthenticate(userId: string, password: string): Promise<'ok' | 'failed' | 'no_password'> {
    const identity = await this.store.identityFor(userId);
    if (!identity) return 'failed';
    if (!identity.passwordHash) return 'no_password';
    const ok = await this.auth.verifyPassword(identity.passwordHash, String(password ?? ''));
    if (!ok) {
      await this.audit?.record({ userId, module: 'customer_identity', action: 'phone_change_reauth_failed', summary: 'Reauthentication failed before a phone change' }).catch(() => undefined);
    }
    return ok ? 'ok' : 'failed';
  }

  /**
   * Change the number this customer SIGNS IN WITH.
   *
   * `verifiedNewPhone` must already have been proved by SMS through the phone-update flow. This service does not
   * send a code and does not check one — it is the LAST step, and it refuses to run on a number nobody proved.
   * Splitting it that way means there is no path here that can move a login credential without a completed
   * verification somewhere upstream.
   */
  async changeLoginPhone(input: {
    userId: string;
    /** The salon the request came through — the warning goes out on ITS number (tenant Twilio). */
    tenantId?: string | null;
    /** REAUTHENTICATION. A stolen session does not carry a password. */
    currentPassword: string;
    /** Already SMS-verified upstream. */
    verifiedNewPhone: string;
  }): Promise<{ ok: true; maskedNew: string }> {
    const identity = await this.store.identityFor(input.userId);
    if (!identity) throw new IdentityPhoneError('Not a customer account.', 'forbidden');

    // ── 1. REAUTHENTICATE ──
    //
    // The session got them here. It does not get them THIS. A borrowed phone, an unlocked laptop, a hijacked token
    // — all of them carry a valid session and none of them carry the password.
    if (!identity.passwordHash) {
      throw new IdentityPhoneError('Set a password before changing your sign-in number.', 'reauth_required');
    }
    const ok = await this.auth.verifyPassword(identity.passwordHash, String(input.currentPassword ?? ''));
    if (!ok) {
      await this.audit?.record({
        userId: input.userId, module: 'customer_identity', action: 'login_phone_change_reauth_failed',
        // Recorded. Repeated failures here are somebody trying to take an account, and that is worth being able
        // to see.
        summary: 'Reauthentication failed while attempting to change the sign-in phone number',
      }).catch(() => undefined);
      throw new IdentityPhoneError('That password is not correct.', 'reauth_required');
    }

    const e164 = normalizePhone(String(input.verifiedNewPhone ?? ''));
    if (!e164) throw new IdentityPhoneError('That phone number does not look valid.', 'invalid_phone');

    // ── the number must not already BE somebody's login ──
    //
    // `customer_identities.normalized_phone` is UNIQUE precisely because two accounts on one login is an ambiguous
    // login. Refusing here is not a nicety — without it, the insert simply fails and the user sees a database
    // error instead of the truth.
    if (await this.store.phoneTakenByAnother(identity.identityId, e164)) {
      throw new IdentityPhoneError(
        'That number is already used to sign in to another account. If it is yours, sign in with it instead.',
        'in_use',
      );
    }

    // ── 2. VERIFY THE NEW NUMBER FIRST — and it must be THIS customer who verified it, just now ──
    //
    // Audit E5: this used to trust the caller's word that the number was "already verified upstream". Now the proof
    // is looked up: a completed SMS verification of this exact number, by this customer, in the app's phone-change
    // flow, within the last half hour.
    if (!(await this.store.provenRecently(input.userId, phoneKey(e164), LOGIN_PHONE_PROOF_MINUTES))) {
      throw new IdentityPhoneError('Verify the new number first: change your phone number in the app and enter the code we text you, then try again.', 'not_verified');
    }

    const maskedOld = maskPhone(identity.normalizedPhone);
    const maskedNew = maskPhone(e164);

    // ── 4. NOTIFY THE OLD NUMBER — BEFORE it is retired ──
    //
    // The order is the point. The old number is the ONLY channel an attacker cannot suppress, and it is how a real
    // customer finds out their account is being taken **while the number is still theirs.** Retire it first and the
    // warning goes to a number we have just stopped believing in.
    //
    // It is sent BEFORE the write for the same reason: if the write succeeds and the notification then fails, the
    // victim never hears. Better to warn and fail than to change and go quiet.
    // No mock in production: if the warning could not really be sent (no SMS provider, a simulated sender, a provider
    // failure), the change does not happen — a takeover nobody is warned about is exactly what this control prevents.
    let notified: { sent: boolean; simulated?: boolean } | null = null;
    try { notified = (await this.notify.loginPhoneChanged({ userId: input.userId, tenantId: input.tenantId ?? null, maskedOld, maskedNew, oldPhoneE164: identity.normalizedPhone })) || { sent: true }; }
    catch { notified = null; }
    if (this.env.production && (!notified || !notified.sent || notified.simulated)) {
      await this.audit?.record({
        userId: input.userId, module: 'customer_identity', action: 'login_phone_change_refused_no_warning',
        summary: 'Sign-in phone change refused: the security warning to the old number could not be sent',
        metadata: { maskedOld, maskedNew, simulated: !!notified?.simulated },
      }).catch(() => undefined);
      throw new IdentityPhoneError('We could not send the security notice to your current number, so your sign-in number was not changed. Please try again later or contact the salon.', 'notify_unavailable');
    }

    const moved = await this.store.setIdentityPhone(identity.identityId, e164);
    if (!moved) throw new IdentityPhoneError('We could not change your sign-in number. Please try again.', 'invalid_phone');

    // ── 3. ROTATE ──
    //
    // Every other session dies. If an attacker was riding one, it ends here. And if the account was ALREADY taken,
    // the victim's session dying is the thing that makes them look.
    await this.auth.revokeAllSessions(input.userId).catch(() => undefined);

    await this.audit?.record({
      userId: input.userId, module: 'customer_identity', action: 'login_phone_changed',
      summary: 'Customer changed the phone number they sign in with',
      // MASKED. A login credential in an audit message is a login credential in a log aggregator.
      metadata: { maskedOld, maskedNew, reauthenticated: true, sessionsRevoked: true, provenBySms: true, oldNumberWarned: !!notified?.sent, warningSimulated: !!notified?.simulated },
    }).catch(() => undefined);

    return { ok: true, maskedNew };
  }
}
