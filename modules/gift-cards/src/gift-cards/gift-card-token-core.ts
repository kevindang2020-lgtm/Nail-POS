// gift-card-token-core.ts — pure logic for gift-card PRESENTATION tokens (the rotating code a customer shows to redeem).
//
// Security properties enforced here + by the service:
//  - High-entropy secret: 24 random bytes, base64url. Not guessable.
//  - Stored hashed: only sha256(token:nonce) is persisted, so a DB leak yields no usable token.
//  - No value encoded: the payload carries no balance, card id, or PII — the server resolves the card from the hash.
//  - Short-lived: expires in ~90s (from settings), checked on validate.
//  - Single-use: the service marks the row used on the first successful validate; replays are rejected.
// The presented payload is `token.nonce`; the stored token_hash is sha256(`token:nonce`). Validation re-derives the hash
// from the presented payload, looks the row up by hash, then checks expiry/used/revoked.
import { randomBytes, createHash } from 'crypto';

export function hashTokenParts(token: string, nonce: string): string {
  return createHash('sha256').update(token + ':' + nonce).digest('hex');
}

export function mintTokenMaterial(): { token: string; nonce: string; tokenHash: string; payload: string } {
  const token = randomBytes(24).toString('base64url');
  const nonce = randomBytes(9).toString('base64url');
  const tokenHash = hashTokenParts(token, nonce);
  return { token, nonce, tokenHash, payload: token + '.' + nonce };
}

export function parsePayload(payload: string): { token: string; nonce: string } | null {
  const s = String(payload || '').trim();
  const i = s.indexOf('.');
  if (i <= 0 || i >= s.length - 1) return null; // must have a non-empty token and nonce
  return { token: s.slice(0, i), nonce: s.slice(i + 1) };
}

export function tokenHashFromPayload(payload: string): string | null {
  const p = parsePayload(payload);
  return p ? hashTokenParts(p.token, p.nonce) : null;
}

export type TokenRowState = { expiresAt: string | Date; usedAt: string | Date | null; revokedAt: string | Date | null };

// Reason codes are intentionally coarse so a scanner never learns why a token failed beyond "try again".
export function tokenValidity(row: TokenRowState | null, nowMs: number): { ok: boolean; reason?: 'not_found' | 'revoked' | 'used' | 'expired' } {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  const exp = new Date(row.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// Clamp the configured TTL to a safe window regardless of settings (defends against a mis-set 0 or a huge value).
export function clampTtlSeconds(ttlSeconds: number | undefined): number {
  const n = Math.round(Number(ttlSeconds));
  if (!Number.isFinite(n)) return 90;
  return Math.max(30, Math.min(300, n));
}
