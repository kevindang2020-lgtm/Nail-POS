// totp.ts — RFC 6238 TOTP (HMAC-SHA1, 30s period, 6 digits) + RFC 4648 base32. Pure/deterministic (time is injected),
// so it is unit-tested against the standard vectors. Used for real MFA verification in the login flow + enrollment.
import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = (s || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { const idx = B32.indexOf(ch); if (idx < 0) continue; value = (value << 5) | idx; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}

export interface TotpOpts { period?: number; digits?: number; }
function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (safe for the JS-integer range of UNIX/period values)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const dig = createHmac('sha1', key).update(buf).digest();
  const off = dig[dig.length - 1] & 0xf;
  const bin = ((dig[off] & 0x7f) << 24) | (dig[off + 1] << 16) | (dig[off + 2] << 8) | dig[off + 3];
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export function totpCode(secretB32: string, atMs: number, opts: TotpOpts = {}): string {
  const period = opts.period ?? 30, digits = opts.digits ?? 6;
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / period), digits);
}

// verify with a ±`window` step tolerance (default ±1 = ±30s) for clock drift.
export function verifyTotp(secretB32: string, code: string, atMs: number, opts: TotpOpts & { window?: number } = {}): boolean {
  const c = (code || '').replace(/\s+/g, '');
  const digits = opts.digits ?? 6;
  if (!secretB32 || !/^\d+$/.test(c) || c.length !== digits) return false;
  const period = opts.period ?? 30, window = opts.window ?? 1;
  const key = base32Decode(secretB32);
  const base = Math.floor(atMs / 1000 / period);
  for (let i = -window; i <= window; i++) { if (hotp(key, base + i, digits) === c) return true; }
  return false;
}

// Like verifyTotp, but returns the matched time-step (counter) so the caller can prevent replay by refusing a step that
// has already been consumed (RFC 6238 §5.2). Returns null when no code in the ±window matches.
export function matchedTotpStep(secretB32: string, code: string, atMs: number, opts: TotpOpts & { window?: number } = {}): number | null {
  const c = (code || '').replace(/\s+/g, '');
  const digits = opts.digits ?? 6;
  if (!secretB32 || !/^\d+$/.test(c) || c.length !== digits) return null;
  const period = opts.period ?? 30, window = opts.window ?? 1;
  const key = base32Decode(secretB32);
  const base = Math.floor(atMs / 1000 / period);
  for (let i = -window; i <= window; i++) { if (hotp(key, base + i, digits) === c) return base + i; }
  return null;
}

export function generateSecret(bytes = 20): string { return base32Encode(randomBytes(bytes)); }
export function otpauthUri(accountLabel: string, issuer: string, secretB32: string, opts: TotpOpts = {}): string {
  const period = opts.period ?? 30, digits = opts.digits ?? 6;
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(digits), period: String(period) });
  return `otpauth://totp/${label}?${q.toString()}`;
}
