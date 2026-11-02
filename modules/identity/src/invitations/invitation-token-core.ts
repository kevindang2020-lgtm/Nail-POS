// invitation-token-core.ts — pure logic for the secure invitation lifecycle (§23). Tokens are random and only their
// sha-256 hash is ever stored; the raw token is shown exactly once at create/resend (delivered to the invitee, or
// surfaced to the admin for manual delivery when no notifier is connected). All transition rules are pure → unit-tested.
import { randomBytes, createHash } from 'node:crypto';

export const INVITATION_TTL_DAYS = 7;

export interface MintedToken { token: string; tokenHash: string; tokenPrefix: string }

/** Mint a fresh single-use token: 32 random bytes, base64url. Returns the raw token (show once), its sha-256 hash
 *  (the only thing persisted), and a short non-secret prefix used as a display hint. */
export function mintInvitationToken(): MintedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token), tokenPrefix: token.slice(0, 8) };
}

/** Deterministic sha-256 hex of a token — used to look up / verify without ever storing the raw token. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Expiry instant for a freshly minted/rotated invitation. */
export function invitationExpiry(now: Date = new Date(), days: number = INVITATION_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= now.getTime();
}

export type AcceptDecision = { ok: true } | { ok: false; reason: 'not_found' | 'cancelled' | 'already_accepted' | 'expired' };

/** Pure guard for redeeming an invitation. Single-use: only a still-pending, unexpired invitation may be accepted;
 *  everything else is rejected with a specific reason (drives replay protection at the repo layer). */
export function decideAccept(inv: { status: string; expiresAt: Date | string | null } | null, now: Date = new Date()): AcceptDecision {
  if (!inv) return { ok: false, reason: 'not_found' };
  if (inv.status === 'accepted') return { ok: false, reason: 'already_accepted' };
  if (inv.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (inv.status === 'expired' || isExpired(inv.expiresAt, now)) return { ok: false, reason: 'expired' };
  if (inv.status !== 'pending') return { ok: false, reason: 'not_found' };
  return { ok: true };
}

/** Build the invitee accept URL (used by the notifier, or surfaced for manual delivery). */
export function acceptUrl(baseUrl: string, token: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}
