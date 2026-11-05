// customer-activation-core.ts — the pure, testable heart of first-time Customer App activation.
//
// Flow: phone → normalize → directory lookup → OTP → verify → link → session.
//
// Everything here is PURE (no I/O), because the security rules must be provable:
//   * ACCOUNT ENUMERATION. The response to "request a code" is IDENTICAL whether or not the phone matches a
//     customer. It must be — otherwise the endpoint becomes a free tool for testing whether someone is a client
//     of a salon. That means we also send a code (and burn the rate limit) for unknown numbers.
//   * THE OTP IS NOT A PASSWORD. Six digits, cryptographically random, hashed at rest, one use, short TTL,
//     attempt-capped. It grants a session, never a permanent credential.
//   * THE PHONE ALONE IS NOT IDENTITY. Possession of the number is proven by the OTP before any customer data
//     is returned or any profile is linked.
//   * NO SILENT MERGES. When one phone matches customers in several salons we do NOT pick one, and we do not
//     merge them. The customer chooses (mirroring the tenant app's existing branch-selection step), so tenant
//     isolation is preserved and no salon's record is quietly attached to another.
import { randomInt, createHash } from 'crypto';

// ── phone ──

/** Canonical E.164 normalization for the CUSTOMER identity family (customers / global_customers).
 *  KNOWN, PINNED divergence from the staff family (auth/security.normalizeIdentifier, which backs
 *  users.normalized_phone): a "+" followed by exactly 10 digits keeps its "+" here but is treated as US there.
 *  Each family must keep matching the values IT stored — do not unify the two functions without re-normalizing
 *  stored data (see src/auth/phone-normalization-parity.vitest.spec.ts, which fails on any NEW drift). */
export function normalizePhone(raw: string, defaultCountry = process.env.DEFAULT_PHONE_COUNTRY || '1'): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;      // not a plausible phone
  if (s.trim().startsWith('+')) return `+${digits}`;
  const effectiveCountry = (defaultCountry === '1' && process.env.DEFAULT_PHONE_COUNTRY) ? process.env.DEFAULT_PHONE_COUNTRY : defaultCountry;
  return digits.length === 10 ? `+${effectiveCountry}${digits}` : `+${digits}`;
}

/**
 * The ONE way to write `customers.normalized_phone` (Jul 28, 2026). Five customer-creation sites (POS create, Queue
 * walk-in, Check-In, Technician→customer, customers repo) each did `.replace(/[^\d+]/g,'')`, storing "5551234567"
 * where activation/identity store "+15551234567" — the same column, two shapes. No live mismatch resulted (the
 * go-check-in lookup compares the last 10 digits, and the identity layer re-normalizes from `phone_display` at read
 * time), but any future exact-match lookup on this column would silently miss half the rows.
 *
 * So: normalize to E.164 when the input is a plausible phone, and fall back to the historical strip-only value when
 * it isn't — never null out a number the salon typed just because it doesn't parse. Existing rows are NOT rewritten
 * (the original input is unrecoverable); readers must stay tolerant — see `phoneDigitsMatch`.
 */
export function toStoredCustomerPhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return normalizePhone(s) ?? (s.replace(/[^\d+]/g, '') || null);
}

/** Tolerant comparison for stored phone values of EITHER shape: last 10 digits, the go-check-in convention. */
export function phoneDigitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const d = (x: string | null | undefined) => String(x ?? '').replace(/\D/g, '').slice(-10);
  const da = d(a); const db = d(b);
  return da.length >= 7 && da === db;
}

/** The salon's readable rendering of an E.164 number — what `phone_display` holds (never the mask: Phase 3, audit E4,
 *  found the mask written there, so the POS list showed "••••0199" and caller-ID matched nothing). North American
 *  numbers read "(856) 555-0199"; others stay in E.164, which is unambiguous everywhere. */
export function displayPhone(e164: string): string {
  const d = (e164 || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return d ? `+${d}` : '';
}

/** The international calling code of an E.164 number ('1' for North America). Best effort: 1–3 digits. */
export function callingCode(e164: string): string | null {
  const d = (e164 || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('1') || d.startsWith('7')) return d[0];
  const two = ['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98'];
  return two.includes(d.slice(0, 2)) ? d.slice(0, 2) : d.slice(0, 3);
}

/** Last 4 digits, for the "code sent to ••••2020" message. Never echo the whole number back. */
export function maskPhone(e164: string): string {
  const d = (e164 || '').replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '••••';
}

// ── OTP ──

export const OTP_TTL_SECONDS = 10 * 60;      // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

/** Cryptographically secure six digits. `randomInt` is uniform — Math.random() would be predictable. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function isWellFormedOtp(code: string): boolean {
  return /^\d{6}$/.test((code || '').trim());
}

/** The SMS body. Explicitly a one-time code with an expiry — never described as a password. */
export function otpMessage(code: string): string {
  return `Your AI PowerSalon verification code is ${code}. It expires in 10 minutes. Do not share this code.`;
}

/** Redact a code from anything about to be logged. The full code must never reach a log or an API response. */
export function redactOtp(text: string): string {
  return (text || '').replace(/\b\d{6}\b/g, '••••••');
}

/** Fingerprint for rate-limit keys — never store or log the raw number alongside attempts. */
export function phoneKey(e164: string, salt = ''): string {
  return createHash('sha256').update(`${salt}:${e164}`).digest('hex').slice(0, 32);
}

// ── the generic, non-enumerating response ──

export const GENERIC_REQUEST_RESPONSE = 'If this phone number is eligible, a verification code will be sent shortly.';

// ── directory resolution ──

/** A customer row found in the directory by normalized phone. Tenant-scoped, as the schema is. */
export interface DirectoryMatch {
  customerId: string;
  tenantId: string;
  branchId: string | null;
  salonName: string;
  /** true when this salon record is not usable for sign-in (archived/merged/deleted). */
  inactive?: boolean;
}

export type Resolution =
  | { kind: 'none' }                                     // no profile — new verified customer path (spec §8)
  | { kind: 'single'; match: DirectoryMatch }            // exactly one salon → link it
  | { kind: 'choose'; matches: DirectoryMatch[] };       // several salons → the CUSTOMER picks. Never guess.

/**
 * Decide what a set of directory matches means. Deliberately never merges and never auto-selects:
 * picking "the first" salon would attach a customer to a salon they didn't choose, and would leak which salons
 * they belong to by side effect.
 */
export function resolveMatches(matches: DirectoryMatch[]): Resolution {
  const usable = (matches || []).filter((m) => !m.inactive);
  if (usable.length === 0) return { kind: 'none' };
  if (usable.length === 1) return { kind: 'single', match: usable[0] };
  return { kind: 'choose', matches: usable };
}

/** What the client may see about the salons to choose from — a display name and an opaque id. Nothing else:
 *  no customer ids, no tenant ids, no branch ids, no profile data. */
export interface SalonChoice { choiceId: string; salonName: string }

// ── attempt / cooldown decisions ──

export interface CodeState {
  attempts: number;
  expiresAt: number;        // epoch ms
  consumed: boolean;
  createdAt: number;        // epoch ms — for resend cooldown
}

export type VerifyDecision =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'too_many_attempts' | 'already_used' | 'incorrect' | 'no_code'; message: string };

export const MSG = {
  incorrect: 'The verification code is incorrect.',
  expired: 'This verification code has expired. Request a new code.',
  too_many_attempts: 'Too many attempts. Please wait before trying again.',
  already_used: 'This verification code has expired. Request a new code.',   // same text — never reveal reuse
  no_code: 'This verification code has expired. Request a new code.',
};

/** Pre-checks BEFORE the hash comparison. `codeMatches` is supplied by the caller (constant-time bcrypt compare). */
export function decideVerify(state: CodeState | null, codeMatches: boolean, now = Date.now()): VerifyDecision {
  if (!state) return { ok: false, reason: 'no_code', message: MSG.no_code };
  if (state.consumed) return { ok: false, reason: 'already_used', message: MSG.already_used };
  if (state.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts', message: MSG.too_many_attempts };
  if (now > state.expiresAt) return { ok: false, reason: 'expired', message: MSG.expired };
  if (!codeMatches) return { ok: false, reason: 'incorrect', message: MSG.incorrect };
  return { ok: true };
}

/** Resend cooldown — stops SMS-pumping and stops a caller from spraying codes at a victim's phone. */
export function canResend(lastSentAt: number | null, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (!lastSentAt) return { allowed: true, retryAfterSeconds: 0 };
  const elapsed = (now - lastSentAt) / 1000;
  if (elapsed >= RESEND_COOLDOWN_SECONDS) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
}


// ── abuse limits beyond the per-phone cooldown ──
//
// The per-phone cooldown stops someone spraying one victim. It does NOT stop a caller walking a list of numbers
// — one code each, no cooldown ever triggered — which is both an SMS-pumping cost attack and a way to blast
// verification texts at strangers. So the SOURCE is limited too.
export const MAX_CODES_PER_IP_HOUR = 10;
export const MAX_CODES_PER_DEVICE_HOUR = 5;

export interface SourceCounts { ipLastHour: number; deviceLastHour: number }

export type SourceDecision = { allowed: true } | { allowed: false; message: string };

export function checkSource(c: SourceCounts): SourceDecision {
  if (c.deviceLastHour >= MAX_CODES_PER_DEVICE_HOUR || c.ipLastHour >= MAX_CODES_PER_IP_HOUR) {
    // Deliberately the same message for both, and it says nothing about which limit or which number.
    return { allowed: false, message: 'Too many attempts. Please wait before trying again.' };
  }
  return { allowed: true };
}
