import { describe, it, expect } from 'vitest';
import { decideLogin, type LoginFacts } from './auth-flow';
import { can, permissionsFor, canAccessSuperAdminPortal, canAccessTenantPos, ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import {
  normalizeIdentifier, checkPasswordPolicy, mfaRequiredForRole, isValidMfaCode,
  rateLimitDecision, refreshTokenDecision, isCrossTenantAttempt, buildTenantContext,
} from '@aipowersalon/auth';

const base: LoginFacts = {
  tenantFound: true, tenantStatus: 'active', userFound: true, passwordValid: true,
  userStatus: 'active', subscriptionStatus: 'active', mfaRequired: false, mfaSatisfied: false, branchCount: 1,
};

describe('auth-flow.decideLogin', () => {
  it('happy path -> SUCCESS', () => {
    expect(decideLogin(base).outcome).toBe('SUCCESS');
  });
  it('unknown tenant -> TENANT_NOT_FOUND with generic message', () => {
    const d = decideLogin({ ...base, tenantFound: false });
    expect(d.outcome).toBe('TENANT_NOT_FOUND');
    expect(d.message).not.toMatch(/suspended|exists/i);
  });
  it('bad password -> INVALID_CREDENTIALS (does not leak tenant state)', () => {
    const d = decideLogin({ ...base, passwordValid: false, tenantStatus: 'suspended' });
    expect(d.outcome).toBe('INVALID_CREDENTIALS');
  });
  it('suspended tenant (valid creds) -> TENANT_SUSPENDED', () => {
    expect(decideLogin({ ...base, tenantStatus: 'suspended' }).outcome).toBe('TENANT_SUSPENDED');
  });
  it('disabled user -> USER_DISABLED', () => {
    expect(decideLogin({ ...base, userStatus: 'suspended' }).outcome).toBe('USER_DISABLED');
  });
  it('expired subscription -> SUBSCRIPTION_BLOCKED', () => {
    expect(decideLogin({ ...base, subscriptionStatus: 'expired' }).outcome).toBe('SUBSCRIPTION_BLOCKED');
  });
  it('mfa required and unsatisfied -> MFA_REQUIRED', () => {
    expect(decideLogin({ ...base, mfaRequired: true, mfaSatisfied: false }).outcome).toBe('MFA_REQUIRED');
  });
  it('mfa satisfied + multi-branch -> BRANCH_SELECTION_REQUIRED', () => {
    expect(decideLogin({ ...base, mfaRequired: true, mfaSatisfied: true, branchCount: 3 }).outcome).toBe('BRANCH_SELECTION_REQUIRED');
  });
});

describe('rbac', () => {
  it('owner can process checkout, technician cannot', () => {
    expect(can('OWNER', 'checkout.process_payment')).toBe(true);
    expect(can('TECHNICIAN', 'checkout.process_payment')).toBe(false);
  });
  it('only SUPER_ADMIN holds super_admin.* and portal access', () => {
    expect(can('SUPER_ADMIN', 'super_admin.tenants.create')).toBe(true);
    expect(can('OWNER', 'super_admin.tenants.create')).toBe(false);
    expect(canAccessSuperAdminPortal('SUPER_ADMIN')).toBe(true);
    expect(canAccessSuperAdminPortal('OWNER')).toBe(false);
  });
  it('super admin cannot use tenant POS, tenant roles can', () => {
    expect(canAccessTenantPos('SUPER_ADMIN')).toBe(false);
    expect(canAccessTenantPos('FRONT_DESK')).toBe(true);
    expect(canAccessTenantPos('CUSTOMER')).toBe(false); // customers don't get pos.login
  });
  it('owner has no super_admin perms; super admin has only super_admin perms', () => {
    expect(permissionsFor('OWNER').some((p) => p.startsWith('super_admin.'))).toBe(false);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.every((p) => p.startsWith('super_admin.'))).toBe(true);
  });
});

describe('security.normalizeIdentifier', () => {
  it('detects + lowercases email', () => {
    expect(normalizeIdentifier('Owner@Salon.COM')).toEqual({ kind: 'email', value: 'owner@salon.com' });
  });
  it('detects phone and E.164-izes a 10-digit US number', () => {
    expect(normalizeIdentifier('(856) 555-1234')).toEqual({ kind: 'phone', value: '+18565551234' });
  });
  it('unknown for junk', () => {
    expect(normalizeIdentifier('abc').kind).toBe('unknown');
  });
});

describe('security.checkPasswordPolicy', () => {
  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Sunflower9X').ok).toBe(true);
  });
  it('rejects short/weak', () => {
    expect(checkPasswordPolicy('abc').ok).toBe(false);
    expect(checkPasswordPolicy('alllowercase1').ok).toBe(false);
  });
});

describe('security.mfa', () => {
  it('SUPER_ADMIN always requires MFA', () => {
    expect(mfaRequiredForRole('SUPER_ADMIN')).toBe(true);
  });
  it('OWNER optional unless enabled or tenant-forced', () => {
    expect(mfaRequiredForRole('OWNER')).toBe(false);
    expect(mfaRequiredForRole('OWNER', { userMfaEnabled: true })).toBe(true);
    expect(mfaRequiredForRole('OWNER', { tenantForce: true })).toBe(true);
  });
  it('validates 6-digit code', () => {
    expect(isValidMfaCode('123456')).toBe(true);
    expect(isValidMfaCode('12a456')).toBe(false);
    expect(isValidMfaCode('12345')).toBe(false);
  });
});

describe('security.rateLimitDecision', () => {
  const now = 1_000_000;
  it('allows under the threshold', () => {
    const d = rateLimitDecision([now - 1000, now - 2000], now, { maxFailures: 5 });
    expect(d.allowed).toBe(true); expect(d.remaining).toBe(3);
  });
  it('locks at/after threshold within the window', () => {
    const fails = [0, 1, 2, 3, 4].map((i) => now - i * 1000);
    const d = rateLimitDecision(fails, now, { maxFailures: 5, lockMs: 900_000 });
    expect(d.allowed).toBe(false); expect(d.lockMs).toBeGreaterThan(0);
  });
  it('old failures fall out of the window', () => {
    const fails = [0, 1, 2, 3, 4].map((i) => now - 16 * 60_000 - i * 1000);
    expect(rateLimitDecision(fails, now, { windowMs: 15 * 60_000 }).allowed).toBe(true);
  });
});

describe('security.refreshTokenDecision', () => {
  const now = 1_000_000;
  it('rotates a valid token', () => {
    expect(refreshTokenDecision({ expiresAt: now + 1000 }, now)).toBe('ROTATE');
  });
  it('detects reuse of a superseded token', () => {
    expect(refreshTokenDecision({ expiresAt: now + 1000, supersededByTokenId: 't2' }, now)).toBe('REUSE_DETECTED');
  });
  it('flags revoked and expired', () => {
    expect(refreshTokenDecision({ expiresAt: now + 1000, revokedAt: now - 1 }, now)).toBe('REVOKED');
    expect(refreshTokenDecision({ expiresAt: now - 1 }, now)).toBe('EXPIRED');
  });
});

describe('security tenant isolation', () => {
  const ctx = buildTenantContext({ tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: [], subscriptionStatus: 'active' });
  it('ignores matching/no tenantId, flags a mismatched one', () => {
    expect(isCrossTenantAttempt(ctx, undefined)).toBe(false);
    expect(isCrossTenantAttempt(ctx, 'T1')).toBe(false);
    expect(isCrossTenantAttempt(ctx, 'T2')).toBe(true);
  });
  it('super admin may target another tenant', () => {
    const sa = buildTenantContext({ tenantId: 'T1', branchId: 'B1', userId: 'U9', role: 'SUPER_ADMIN', permissions: [], subscriptionStatus: 'active' });
    expect(isCrossTenantAttempt(sa, 'T2')).toBe(false);
  });
});
