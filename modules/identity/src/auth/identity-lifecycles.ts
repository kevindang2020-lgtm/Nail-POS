// identity-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the identity lifecycles as state machines (ONE per table.column;
// other modules that write these columns import them from @aipowersalon/identity).
import { defineStateMachine } from '@aipowersalon/database';

/** sessions.status — a session is live (active, or held: locked / suspended / inactive) until it ends. Revoking is always
 *  allowed and idempotent (every sign-out / password reset / "not me" path revokes regardless of the current state); an
 *  ENDED session (revoked / expired / completed / cancelled) is never brought back to active. */
export const SESSION = defineStateMachine({
  name: 'session', table: 'sessions', column: 'status',
  states: ['active', 'inactive', 'locked', 'suspended', 'expired', 'completed', 'cancelled', 'revoked'],
  transitions: {
    active: ['active', 'inactive', 'locked', 'suspended', 'expired', 'completed', 'cancelled', 'revoked'],
    inactive: ['active', 'inactive', 'locked', 'suspended', 'expired', 'revoked'],
    locked: ['active', 'locked', 'suspended', 'expired', 'revoked'],
    suspended: ['active', 'locked', 'suspended', 'expired', 'revoked'],
    expired: ['expired', 'revoked'], completed: ['completed', 'revoked'], cancelled: ['cancelled', 'revoked'], revoked: ['revoked'],
  },
  initial: ['active'],
});

/** users.status — an invited account is activated on first sign-in; staff accounts are flags an admin toggles
 *  (active / inactive / suspended). Nothing moves an account back to invited. */
export const USER_ACCOUNT = defineStateMachine({
  name: 'user_account', table: 'users', column: 'status',
  states: ['invited', 'active', 'inactive', 'suspended'],
  transitions: {
    invited: ['invited', 'active', 'inactive', 'suspended'],
    // → invited: a Super Admin password reset (platform users + a salon owner's temporary password) sends the account back
    // through onboarding — today's behaviour, kept (BUILD_PLAN Phase 12 round 2 integration)
    active: ['active', 'inactive', 'suspended', 'invited'],
    inactive: ['active', 'inactive', 'suspended', 'invited'],
    suspended: ['active', 'inactive', 'suspended', 'invited'],
  },
  initial: ['invited', 'active'],
});

/** device_biometric_credentials.status — a Face ID device credential (BUILD_PLAN Phase 13, Constitution 6 §37–39) is
 *  active until it is revoked (replaced, reused secret, expiry, password change, device revoked / blocked, sign-out, Face ID
 *  turned off, access change). A revoked credential is never re-activated — enrolling again inserts a NEW row. */
export const BIOMETRIC_CREDENTIAL = defineStateMachine({
  name: 'biometric_credential', table: 'device_biometric_credentials', column: 'status',
  states: ['active', 'revoked'],
  transitions: { active: ['revoked'], revoked: [] },
  initial: ['active'],
});
