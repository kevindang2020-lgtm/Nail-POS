// secure-random.ts — Constitution 12 §47, §112 (finding H9): every security value from a CRYPTOGRAPHIC source.
//
// Math.random() in Node is xorshift128+: after a handful of observed outputs the rest are predictable, and an attacker
// can collect outputs freely (verify their own phone, redeem their own reward, onboard their own test salon). Phase-22
// follow-up found it generating: the customer-activation ticket (proof a phone was verified — redeeming it links that
// customer's account), the customer phone-verification code, loyalty redemption codes, and the temporary password given
// to every newly onboarded owner/staff account. All now come from node:crypto. A test fails the build if Math.random()
// reappears next to a security word.
import { randomBytes, randomInt } from 'node:crypto';

/** An unguessable bearer token: `bytes` of CSPRNG output, base64url (32 bytes = 256 bits). */
export function secureToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }

/** A numeric code of exactly `len` digits (leading digit 1–9), each digit uniformly random. */
export function secureDigits(len = 6): string {
  let s = String(randomInt(1, 10));
  for (let i = 1; i < len; i++) s += String(randomInt(0, 10));
  return s;
}

/** `len` characters drawn uniformly from `alphabet` (no modulo bias — randomInt is exact). */
export function secureString(len: number, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[randomInt(0, alphabet.length)];
  return s;
}

/** A temporary password: 16 characters, upper/lower/digit, ambiguous characters removed (~94 bits). */
export function secureTempPassword(): string {
  return 'Tmp-' + secureString(16, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789');
}
