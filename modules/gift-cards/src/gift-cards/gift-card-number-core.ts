// gift-card-number-core.ts — pure logic for the human-facing 16-digit gift card number (spec §3).
//
// Requirements met here:
//  - Exactly 16 numeric digits, generated with cryptographically-secure randomness (crypto.randomInt).
//  - Non-sequential and not derived from phone / tenant / timestamp — every digit is independently random.
//  - First digit is 1–9 so the value is always a full 16-digit number (no leading-zero ambiguity on entry).
//  - Masking for display (reveal only the last 4); grouped formatting for readability; tolerant normalization on entry.
// Uniqueness is enforced at the database (partial unique index on card_number); callers regenerate on the (astronomically
// rare) collision.
import { randomInt, createHash } from 'crypto';

export function generateCardNumber(): string {
  let n = String(randomInt(1, 10)); // first digit 1–9
  for (let i = 1; i < 16; i++) n += String(randomInt(0, 10));
  return n;
}

// Strip spaces and any non-digit so scanned/typed input ("4827 1936 5502 8411", "4827-1936-…") normalizes cleanly.
export function normalizeCardNumber(input: string): string {
  return String(input || '').replace(/\D+/g, '');
}

export function isValidCardNumber(input: string): boolean {
  return /^\d{16}$/.test(normalizeCardNumber(input));
}

// "4827193655028411" -> "4827 1936 5502 8411"
export function formatCardNumber(input: string): string {
  const n = normalizeCardNumber(input);
  return n.replace(/(.{4})/g, '$1 ').trim();
}

// "4827193655028411" -> "•••• •••• •••• 8411" (reveal only the last 4)
export function maskCardNumber(input: string): string {
  const n = normalizeCardNumber(input);
  if (n.length < 4) return '•••• •••• •••• ••••';
  return '•••• •••• •••• ' + n.slice(-4);
}

export function lastFour(input: string): string {
  const n = normalizeCardNumber(input);
  return n.length >= 4 ? n.slice(-4) : n;
}

// Deterministic sha256 (hex) of the normalized digits. Lets us store/look up a card by its number WITHOUT keeping the
// number itself at rest (spec §3/§12/§32). Matches Postgres `encode(digest(card_number,'sha256'),'hex')` computed over
// the stored normalized value, so an at-rest backfill and an app-side lookup resolve to the same hash.
export function hashCardNumber(input: string): string {
  return createHash('sha256').update(normalizeCardNumber(input)).digest('hex');}

// Hash a physical-card PIN bound to the card's code, so a short PIN can't be attacked with a generic rainbow table and
// the same PIN on two cards yields different hashes. Verification is app-side (matches nothing stored in Postgres).
export function hashCardPin(code: string, pin: string): string {
  return createHash('sha256').update(String(code) + ':' + String(pin).replace(/\s+/g, '')).digest('hex');
}

// Masked display built straight from a stored last-4, for when the full number is no longer available at rest.
export function maskFromLast4(last4: string | null | undefined): string {
  const d = String(last4 || '').replace(/\D+/g, '').slice(-4);
  return d.length === 4 ? '•••• •••• •••• ' + d : '•••• •••• •••• ••••';
}
