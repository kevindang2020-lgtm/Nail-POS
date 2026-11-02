// invitation-token-core.vitest.spec.ts — the secure-token primitives. Tokens must be unguessable and never stored
// raw; only the deterministic hash is persisted. The accept guard is single-use: only a pending, unexpired
// invitation may be redeemed — every other state yields a specific, honest rejection reason.
import { describe, it, expect } from 'vitest';
import { mintInvitationToken, hashInvitationToken, invitationExpiry, isExpired, decideAccept, acceptUrl, INVITATION_TTL_DAYS } from './invitation-token-core';

describe('mintInvitationToken', () => {
  it('mints a high-entropy token, a matching hash, and a non-secret prefix', () => {
    const a = mintInvitationToken();
    expect(a.token.length).toBeGreaterThanOrEqual(40);                 // 32 bytes base64url
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);                     // sha-256 hex
    expect(a.tokenHash).toBe(hashInvitationToken(a.token));            // hash corresponds to the raw token
    expect(a.tokenPrefix).toBe(a.token.slice(0, 8));
  });
  it('is unique across mints', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintInvitationToken().token));
    expect(seen.size).toBe(200);
  });
});

describe('hashInvitationToken', () => {
  it('is deterministic and not the raw token', () => {
    expect(hashInvitationToken('abc')).toBe(hashInvitationToken('abc'));
    expect(hashInvitationToken('abc')).not.toBe('abc');
    expect(hashInvitationToken('abc')).not.toBe(hashInvitationToken('abd'));
  });
});

describe('expiry', () => {
  it('default TTL is 7 days out', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(invitationExpiry(now).toISOString()).toBe(new Date(now.getTime() + INVITATION_TTL_DAYS * 86400000).toISOString());
  });
  it('isExpired: past → true, future → false, null → true', () => {
    const now = new Date('2026-06-10T00:00:00Z');
    expect(isExpired('2026-06-09T00:00:00Z', now)).toBe(true);
    expect(isExpired('2026-06-11T00:00:00Z', now)).toBe(false);
    expect(isExpired(null, now)).toBe(true);
  });
});

describe('decideAccept (single-use guard)', () => {
  const future = '2026-12-31T00:00:00Z', past = '2000-01-01T00:00:00Z';
  it('accepts a pending, unexpired invitation', () => { expect(decideAccept({ status: 'pending', expiresAt: future })).toEqual({ ok: true }); });
  it('rejects missing / accepted / cancelled / expired with specific reasons', () => {
    expect(decideAccept(null)).toEqual({ ok: false, reason: 'not_found' });
    expect(decideAccept({ status: 'accepted', expiresAt: future })).toEqual({ ok: false, reason: 'already_accepted' });
    expect(decideAccept({ status: 'cancelled', expiresAt: future })).toEqual({ ok: false, reason: 'cancelled' });
    expect(decideAccept({ status: 'expired', expiresAt: future })).toEqual({ ok: false, reason: 'expired' });
    expect(decideAccept({ status: 'pending', expiresAt: past })).toEqual({ ok: false, reason: 'expired' }); // pending but past expiry
  });
});

describe('acceptUrl', () => {
  it('builds a clean accept link with the token query param', () => {
    expect(acceptUrl('https://app.example.com/', 'tok 123')).toBe('https://app.example.com/accept-invite?token=tok%20123');
  });
});
