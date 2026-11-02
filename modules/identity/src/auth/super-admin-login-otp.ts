/*
 * super-admin-login-otp.ts — the mandatory SMS second factor for Super Admin login.
 *
 * Super Admin MFA is required (ROLE_MFA.SUPER_ADMIN = 'required'), so a login is never issued without a second
 * factor. When this port is wired (Twilio configured) and the Super Admin has a phone, that factor is a
 * backend-generated six-digit code, delivered by SMS and verified HERE — never on the client:
 *
 *   issueAndSend : CSPRNG 6-digit code → HASH stored (plaintext only ever leaves via SMS) → send to the phone.
 *   verify       : compare the submitted code to the stored hash; single-use, time-limited, attempt-capped.
 *
 * Reuses the password hasher (`password.ts`) and the existing `SmsSender` (`sms.service.ts`) — no new SMS stack,
 * no new hasher. The store is a port so the login path can run against Postgres in prod and an in-memory stub in
 * tests, with a MockSmsSender capturing the send.
 */
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import type { SmsSender } from '@aipowersalon/notifications';

const TTL_MS = 5 * 60_000;            // the code lives 5 minutes (matches the UI countdown)
const RESEND_COOLDOWN_MS = 30_000;    // a code sent < 30s ago is reused, not re-sent (double-submit / SMS-bomb guard)
const MAX_ATTEMPTS = 5;               // wrong-code tries before the challenge is locked (a fresh issue is required)

export interface SuperAdminOtpChallenge { codeHash: string; expiresAt: number; attempts: number; createdAt: number }

/** Persistence for the one live challenge per Super Admin. Keyed by the Super Admin's own user_id (a PK lookup). */
export interface SuperAdminOtpStore {
  put(userId: string, codeHash: string, expiresAt: number, createdAt: number): Promise<void>;
  /** The active (unconsumed, unexpired) challenge for this user, or null. */
  getActive(userId: string, now: number): Promise<SuperAdminOtpChallenge | null>;
  /** Increment the wrong-code counter; returns the new count. */
  incrementAttempts(userId: string): Promise<number>;
  /** Mark the challenge consumed (single use). */
  consume(userId: string, now: number): Promise<void>;
  /**
   * Constitution 12 §112–114: ATOMICALLY claim one attempt slot on the active challenge — succeeds only if it is
   * unconsumed, unexpired and under `max` attempts — and return its hash. One statement, so concurrent guesses cannot
   * all read "under the limit" before any increment lands.
   */
  claimAttempt(userId: string, now: number, max: number): Promise<{ codeHash: string } | null>;
  /** ATOMICALLY consume: true only for the ONE caller that flips it from unconsumed. */
  consumeOnce(userId: string, now: number): Promise<boolean>;
}

export interface SuperAdminOtpPort {
  /** Generate, store, and SMS a fresh code (rate-limited); returns the masked phone for the UI. */
  issueAndSend(userId: string, phoneE164: string): Promise<{ maskedPhone: string }>;
  /** True iff the submitted code is correct, unexpired, unconsumed, and within the attempt cap (consumes on success). */
  verify(userId: string, code: string): Promise<boolean>;
}

/** "(***) ***-4829" — only the last four digits are ever shown. */
export function maskPhone(phone: string): string {
  const last4 = (phone || '').replace(/\D/g, '').slice(-4);
  return `(***) ***-${last4 || '****'}`;
}

export function otpSmsBody(code: string): string {
  return `AI PowerSalon Security\nYour verification code is: ${code}\nThis code expires in 5 minutes. Never share this code. If you did not attempt to sign in, contact support immediately.`;
}

export class SuperAdminOtpService implements SuperAdminOtpPort {
  constructor(
    private readonly store: SuperAdminOtpStore,
    private readonly sms: SmsSender,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issueAndSend(userId: string, phoneE164: string): Promise<{ maskedPhone: string }> {
    const now = this.now();
    const active = await this.store.getActive(userId, now);
    // A code sent moments ago is reused rather than re-sent — double-submits and repeated taps must not fan out
    // into a burst of texts (nor let an attacker who knows the password bomb the phone).
    if (active && now - active.createdAt < RESEND_COOLDOWN_MS) return { maskedPhone: maskPhone(phoneE164) };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'); // CSPRNG, uniform over 000000–999999
    const codeHash = await hashPassword(code);
    await this.store.put(userId, codeHash, now + TTL_MS, now);
    await this.sms.send(phoneE164, otpSmsBody(code)); // plaintext code leaves ONLY here, over SMS
    return { maskedPhone: maskPhone(phoneE164) };
  }

  async verify(userId: string, code: string): Promise<boolean> {
    // Constitution 12 §112–114. This used to read → compare → consume unconditionally, and its comment promised "a
    // correct code can never be replayed". Under concurrency both halves failed (reproduced on the real schema): two
    // submissions inside the slow hash comparison both saw the code unused and BOTH succeeded — one code, two Super
    // Admin sessions — and twenty simultaneous wrong guesses all read "under the limit" before any increment landed.
    // Now the database decides: claim an attempt slot atomically BEFORE comparing (a correct code spends one of the
    // five too), then consume with a conditional update that exactly one caller can win.
    const now = this.now();
    const claim = await this.store.claimAttempt(userId, now, MAX_ATTEMPTS);
    if (!claim) return false;                           // no challenge, expired, already used, or out of attempts
    const ok = await verifyPassword((code || '').trim(), claim.codeHash);
    if (!ok) return false;                              // the attempt was already counted by the claim
    return this.store.consumeOnce(userId, now);         // exactly one concurrent correct submission wins
  }
}

/** In-memory store for tests and DB-less runs. */
export class InMemorySuperAdminOtpStore implements SuperAdminOtpStore {
  private readonly m = new Map<string, { codeHash: string; expiresAt: number; attempts: number; consumedAt: number | null; createdAt: number }>();
  async put(userId: string, codeHash: string, expiresAt: number, createdAt: number): Promise<void> {
    this.m.set(userId, { codeHash, expiresAt, attempts: 0, consumedAt: null, createdAt });
  }
  async getActive(userId: string, now: number): Promise<SuperAdminOtpChallenge | null> {
    const r = this.m.get(userId);
    if (!r || r.consumedAt !== null || r.expiresAt <= now) return null;
    return { codeHash: r.codeHash, expiresAt: r.expiresAt, attempts: r.attempts, createdAt: r.createdAt };
  }
  async incrementAttempts(userId: string): Promise<number> {
    const r = this.m.get(userId); if (!r) return 0; r.attempts += 1; return r.attempts;
  }
  async consume(userId: string, now: number): Promise<void> {
    const r = this.m.get(userId); if (r) r.consumedAt = now;
  }
  async claimAttempt(userId: string, now: number, max: number): Promise<{ codeHash: string } | null> {
    const r = this.m.get(userId);                       // single-threaded: check-and-increment is atomic here
    if (!r || r.consumedAt !== null || r.expiresAt <= now || r.attempts >= max) return null;
    r.attempts += 1; return { codeHash: r.codeHash };
  }
  async consumeOnce(userId: string, now: number): Promise<boolean> {
    const r = this.m.get(userId); if (!r || r.consumedAt !== null) return false; r.consumedAt = now; return true;
  }
}
