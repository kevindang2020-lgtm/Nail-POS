/**
 * password.ts — credential hashing & verification (dependency-free, Node crypto scrypt).
 *
 * This is the foundational primitive the login flow depends on: auth-flow.ts decides outcomes from facts, and one of
 * those facts (passwordValid) is produced here. Stored format is self-describing so cost parameters can evolve without
 * a migration: "scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>". Verification is constant-time (timingSafeEqual) and never
 * throws on malformed input — it returns false, so a corrupt/garbage hash can't crash the auth path.
 *
 * Cost: N=16384, r=8, p=1 (~16 MB, well under Node's default scrypt maxmem; we also raise maxmem for headroom).
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';

const ALGO = 'scrypt';
const N = 16384, R = 8, P = 1, KEYLEN = 64, SALT_BYTES = 16, MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
  });
}

/** Hash a plaintext password. Returns the self-describing encoded string to store in users.password_hash. */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) throw new Error('password required');
  const salt = randomBytes(SALT_BYTES);
  const dk = await scrypt(plain, salt, KEYLEN, N, R, P);
  return [ALGO, N, R, P, salt.toString('base64'), dk.toString('base64')].join('$');
}

/** Verify a plaintext password against a stored hash. Constant-time; returns false on any malformed/garbage input. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (typeof plain !== 'string' || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== ALGO) return false;
    const n = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
    if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await scrypt(plain, salt, expected.length, n, r, p);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash uses parameters weaker than current policy (caller may re-hash on next successful login). */
export function needsRehash(stored: string): boolean {
  const parts = (stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== ALGO) return true;
  const n = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  return !(n >= N && r >= R && p >= P);
}
