// mfa-policy.vitest.spec.ts — §6 "Two-factor authentication for roles where required".
//
// Verifies the policy is real (not just a hook), and pins the production behaviour that makes the deploy-runbook
// bootstrap step (5a) mandatory: in production a SUPER_ADMIN with no enrolled TOTP factor CANNOT satisfy MFA, so
// they must be enrolled out-of-band (scripts/enroll-mfa.ts) BEFORE the first login — otherwise they are locked
// out of their own admin console with no in-app way back in.
import { describe, it, expect, afterEach } from 'vitest';
import { mfaRequiredForRole, requireRealTotpEnrollment, isValidMfaCode } from '@aipowersalon/auth';

const prevEnv = process.env.NODE_ENV;
const prevFlag = process.env.MFA_REQUIRE_TOTP;
afterEach(() => {
  if (prevEnv === undefined) delete (process.env as any).NODE_ENV; else (process.env as any).NODE_ENV = prevEnv;
  if (prevFlag === undefined) delete process.env.MFA_REQUIRE_TOTP; else process.env.MFA_REQUIRE_TOTP = prevFlag;
});

describe('role-based MFA policy (§6)', () => {
  it('SUPER_ADMIN always requires MFA — it cannot be opted out of', () => {
    expect(mfaRequiredForRole('SUPER_ADMIN')).toBe(true);
    expect(mfaRequiredForRole('SUPER_ADMIN', { userMfaEnabled: false })).toBe(true);   // cannot be disabled
  });

  it('tenant roles are optional by default (per-user opt-in)', () => {
    for (const role of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'] as const) {
      expect(mfaRequiredForRole(role)).toBe(false);
      expect(mfaRequiredForRole(role, { userMfaEnabled: true })).toBe(true);   // user turned it on
    }
  });

  it('a tenant-level force flag can require MFA for a tenant role', () => {
    expect(mfaRequiredForRole('OWNER', { tenantForce: true })).toBe(true);
  });
});

describe('production requires a REAL enrolled TOTP factor', () => {
  it('production: the permissive any-6-digit fallback is OFF', () => {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.MFA_REQUIRE_TOTP;
    expect(requireRealTotpEnrollment()).toBe(true);
  });

  it('MFA_REQUIRE_TOTP=1 turns it off outside production too', () => {
    (process.env as any).NODE_ENV = 'test';
    process.env.MFA_REQUIRE_TOTP = '1';
    expect(requireRealTotpEnrollment()).toBe(true);
  });

  it('dev/test stays permissive so testing needs no authenticator app', () => {
    (process.env as any).NODE_ENV = 'test';
    delete process.env.MFA_REQUIRE_TOTP;
    expect(requireRealTotpEnrollment()).toBe(false);
    expect(isValidMfaCode('123456')).toBe(true);
  });

  // This is the behaviour that makes DEPLOY_RUNBOOK step 5a mandatory. A SUPER_ADMIN with no TOTP secret cannot
  // pass MFA in production, and the in-app enrollment endpoint needs a session they cannot get. Enroll them
  // out-of-band first (scripts/enroll-mfa.ts) or they are locked out of their own console.
  it('DOCUMENTS THE LOCKOUT: in production, MFA is required for SUPER_ADMIN and a bare code is not accepted', () => {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.MFA_REQUIRE_TOTP;
    expect(mfaRequiredForRole('SUPER_ADMIN')).toBe(true);      // MFA is demanded…
    expect(requireRealTotpEnrollment()).toBe(true);            // …and only a real enrolled factor satisfies it.
    // => with no enrolled factor there is NO in-app path in. See DEPLOY_RUNBOOK §5a.
  });
});
