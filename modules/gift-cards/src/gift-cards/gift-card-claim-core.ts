// gift-card-claim-core.ts — pure logic for gift-card CLAIM tokens (send-to-friend, spec §10). A sender mints a token to
// gift a card; the raw token travels in a shareable claim link; only its sha256 hash is stored. The recipient claims by
// presenting the token, which is re-hashed and looked up. Single-use (claimed_at), revocable, and expiring (~30 days).
import { randomBytes, createHash } from 'crypto';

export function hashClaimToken(token: string): string {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function mintClaimToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashClaimToken(token) };
}

export type ClaimRowState = { claimedAt: string | Date | null; revokedAt: string | Date | null; expiresAt: string | Date };

export function claimValidity(row: ClaimRowState | null, nowMs: number): { ok: boolean; reason?: 'not_found' | 'claimed' | 'revoked' | 'expired' } {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.claimedAt) return { ok: false, reason: 'claimed' };
  const exp = new Date(row.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// Days a claim link stays valid before it expires.
export const CLAIM_TTL_DAYS = 30;
