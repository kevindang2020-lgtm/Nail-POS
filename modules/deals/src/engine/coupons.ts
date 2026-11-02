// coupons.ts — BUILD_PLAN Phase 5: coupon codes are bearer secrets. They were stored in plaintext, one shared code per
// promotion (salon_promotions.code). Now a code is stored only as sha256(tenant ':' normalized code) plus its last four
// characters; bulk-generated codes are shown ONCE (at generation) and can never be read back; lookups that miss are
// counted and rate-limited per person (and per salon) so codes cannot be guessed at the register or over the API.
import { createHash, randomInt } from 'node:crypto';

/** Upper-case, letters and digits only ("spring-10 " → "SPRING10"). The same rule the migration used to backfill. */
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}
export function hashCode(tenantId: string, raw: unknown): string {
  return createHash('sha256').update(`${tenantId}:${normalizeCode(raw)}`, 'utf8').digest('hex');
}
export function codeHint(raw: unknown): string { return normalizeCode(raw).slice(-4); }

// no 0/O, 1/I/L — a code read aloud or typed from a receipt must not be ambiguous
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_BATCH = 10_000;
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 32;

/** `count` distinct random codes, `PREFIX-XXXX-XXXX` (prefix optional, 2–10 letters/digits). */
export function generateCodes(count: number, prefix?: string | null, groups = 2): string[] {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1 || n > MAX_BATCH) throw new RangeError(`Generate between 1 and ${MAX_BATCH} codes.`);
  const p = prefix ? normalizeCode(prefix) : '';
  if (prefix && (p.length < 2 || p.length > 10)) throw new RangeError('A prefix is 2–10 letters or digits.');
  const out = new Set<string>();
  while (out.size < n) {
    const body = Array.from({ length: groups }, () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''));
    out.add([p, ...body].filter(Boolean).join('-'));
  }
  return [...out];
}

/** A salon-chosen shared code ("SPRING10"): 4–32 letters/digits after normalizing. */
export function validateSharedCode(raw: unknown): string | null {
  const c = normalizeCode(raw);
  if (c.length < MIN_CODE_LENGTH || c.length > MAX_CODE_LENGTH) return `A code is ${MIN_CODE_LENGTH}–${MAX_CODE_LENGTH} letters or digits.`;
  return null;
}

/** Lookup rate limit: failed lookups per person, and per salon, in a rolling window. */
export const LOOKUP_WINDOW_MS = 15 * 60_000;
export const LOOKUP_FAILURES_PER_ACTOR = 8;
export const LOOKUP_FAILURES_PER_TENANT = 200;
export function lookupBlocked(actorFailures: number, tenantFailures: number): boolean {
  return actorFailures >= LOOKUP_FAILURES_PER_ACTOR || tenantFailures >= LOOKUP_FAILURES_PER_TENANT;
}

/** A wallet coupon's QR payload: a reference, never the code. Only the customer it belongs to can use it. */
export const WALLET_QR_PREFIX = 'APS-CPN:';
export function walletQrPayload(couponId: string): string { return WALLET_QR_PREFIX + couponId; }
export function parseWalletQr(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(WALLET_QR_PREFIX)) return null;
  const id = raw.slice(WALLET_QR_PREFIX.length).trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}
