// clock-pin-hash.ts — the Clock PIN's own hash cost (M4-1, Kevin's decision Oct 26 2026: "lower the hash cost").
//
// A 4-digit PIN has 10,000 values. scrypt at the PASSWORD cost (N = 16384: ~34 ms, ~16 MB) adds no offline protection
// to it — 10,000 × 34 ms is six minutes for anyone holding the table — while it made every kiosk tap CPU-bound: 100
// technicians clocking in at once cost 3.4 of the API's 5.5 CPU-seconds on two cores (PERFORMANCE_REPORT.md, M5-2).
// What actually protects the PIN is the keyed lookup digest (CLOCK_PIN_LOOKUP_KEY, migration 683: a server-held HMAC key
// an attacker with the table does not have) and the attempt lockouts (per technician in clock-pin-core, per kiosk in the
// service). The hash stays — a stolen table still shows no PIN in clear, and a candidate still has to be verified — at a
// cost sized for a 4-digit secret: N = 2048, r = 8, p = 1 (~2 MB, ~4 ms on the pilot host: 8× cheaper).
//
// Versioned by the stored string itself. The format is the same self-describing "scrypt$<N>$<r>$<p>$<salt>$<hash>" the
// password hasher writes, so every PIN hashed before this (N = 16384) keeps verifying unchanged; `clockPinNeedsRehash`
// says a hash is not at the PIN cost, and the service re-hashes it on the next SUCCESSFUL clock-in (transparently — the
// technician types the same PIN). Verification is the shared constant-time verifier; it never throws on garbage.
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { verifyPassword } from '@aipowersalon/auth';

export const CLOCK_PIN_SCRYPT = { N: 2048, r: 8, p: 1, keylen: 32, saltBytes: 16, maxmem: 16 * 1024 * 1024 } as const;
const ALGO = 'scrypt';

function scrypt(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(pin, salt, CLOCK_PIN_SCRYPT.keylen, { N: CLOCK_PIN_SCRYPT.N, r: CLOCK_PIN_SCRYPT.r, p: CLOCK_PIN_SCRYPT.p, maxmem: CLOCK_PIN_SCRYPT.maxmem }, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
  });
}

/** Hash a Clock PIN at the PIN cost. The stored string carries its own parameters. */
export async function hashClockPin(pin: string): Promise<string> {
  if (typeof pin !== 'string' || pin.length === 0) throw new Error('pin required');
  const salt = randomBytes(CLOCK_PIN_SCRYPT.saltBytes);
  const dk = await scrypt(pin, salt);
  return [ALGO, CLOCK_PIN_SCRYPT.N, CLOCK_PIN_SCRYPT.r, CLOCK_PIN_SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$');
}

/** Verify a PIN against a stored hash of EITHER cost (the parameters are read from the string). Constant-time; false on garbage. */
export function verifyClockPin(pin: string, stored: string): Promise<boolean> {
  return verifyPassword(pin, stored);
}

/** The stored parameters of a hash, or null when it is not one of ours. */
export function clockPinHashParams(stored: string): { N: number; r: number; p: number } | null {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== ALGO) return null;
  const n = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  return [n, r, p].every((x) => Number.isInteger(x) && x > 0) ? { N: n, r, p } : null;
}

/** True when a stored hash is not at the Clock PIN cost (a password-cost hash from before M4-1, or an unknown format):
 *  the service writes a fresh PIN-cost hash after the next successful verification. */
export function clockPinNeedsRehash(stored: string): boolean {
  const p = clockPinHashParams(stored);
  return !p || p.N !== CLOCK_PIN_SCRYPT.N || p.r !== CLOCK_PIN_SCRYPT.r || p.p !== CLOCK_PIN_SCRYPT.p;
}
