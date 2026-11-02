// BUILD_PLAN Phase 12 round 2 (#27): sessions are revoked from any state and never revived; an invited account activates.
import { describe, it, expect } from 'vitest';
import { SESSION, USER_ACCOUNT } from './identity-lifecycles';

describe('identity lifecycles', () => {
  it('revoking is always allowed and idempotent; an ended session never comes back', () => {
    for (const s of SESSION.states) expect(SESSION.can(s, 'revoked'), s).toBe(true);
    for (const s of ['revoked', 'expired', 'completed', 'cancelled']) expect(SESSION.can(s, 'active'), s).toBe(false);
  });
  it('an invited account activates; only a Super Admin password reset moves an account back to invited (Phase 12 decision)', () => {
    expect(USER_ACCOUNT.can('invited', 'active')).toBe(true);
    // → invited exists for exactly one writer: the Super Admin password reset (a temporary password puts the account back
    // into the invited state until it is changed) — pinned so a new edge into invited cannot slip in unnoticed
    const intoInvited = USER_ACCOUNT.states.filter((s) => s !== 'invited' && USER_ACCOUNT.can(s, 'invited')).sort();
    expect(intoInvited).toEqual(['active', 'inactive', 'suspended']);
    expect(USER_ACCOUNT.states.slice().sort()).toEqual(['active', 'inactive', 'invited', 'suspended']);
  });
});

describe('Face ID device credential lifecycle (Phase 13)', () => {
  it('active → revoked only; a revoked credential is never re-activated (re-enrolling inserts a new row)', async () => {
    const { BIOMETRIC_CREDENTIAL } = await import('./identity-lifecycles');
    expect(BIOMETRIC_CREDENTIAL.can('active', 'revoked')).toBe(true);
    expect(BIOMETRIC_CREDENTIAL.can('revoked', 'active')).toBe(false);
    expect(BIOMETRIC_CREDENTIAL.sourcesOf('revoked')).toEqual(['active']);   // every revoke writes `where status = 'active'`
  });
});
