// Constitution 7 §5 — a platform session carries its platform role as a SIGNED claim, and its permissions derive from it.
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './auth-session-token';
import { platformPermissionsFor, permissionsFor } from '@aipowersalon/permissions';

const secret = 'test-secret-constitution-7';
const base = { userId: 'u1', tenantId: null, branchId: null, role: 'SUPER_ADMIN' as any, subscriptionStatus: 'active' };

describe('platform role in the session token', () => {
  it('a PLATFORM_SUPPORT session carries its role, not the full list, and verifies to exactly the support set', () => {
    const t = signSession({ ...base, platformRole: 'PLATFORM_SUPPORT', permissions: platformPermissionsFor('PLATFORM_SUPPORT') } as any, { secret, now: 1000 });
    const raw = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
    expect(raw.permissions).toBeUndefined();                                // derived, keeps the cookie small
    expect(raw.platformRole).toBe('PLATFORM_SUPPORT');
    const v = verifySession(t, { secret, now: 1001 });
    expect(v.valid).toBe(true);
    expect([...(v as any).payload.permissions].sort()).toEqual([...platformPermissionsFor('PLATFORM_SUPPORT')].sort());
    expect((v as any).payload.permissions).not.toContain('super_admin.billing.manage');
  });
  it('raising the role in the payload breaks the signature (it cannot be edited client-side)', () => {
    const t = signSession({ ...base, platformRole: 'PLATFORM_SUPPORT', permissions: platformPermissionsFor('PLATFORM_SUPPORT') } as any, { secret, now: 1000 });
    const [p, sig] = t.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); forged.platformRole = 'PLATFORM_SUPER_ADMIN';
    const v = verifySession(`${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`, { secret, now: 1001 });
    expect(v.valid).toBe(false);
  });
  it('a legacy SUPER_ADMIN token with no platform role keeps the full set it was minted with (no sign-out on deploy)', () => {
    const t = signSession({ ...base, permissions: permissionsFor('SUPER_ADMIN') } as any, { secret, now: 1000 });
    const v = verifySession(t, { secret, now: 1001 });
    expect([...(v as any).payload.permissions].sort()).toEqual([...permissionsFor('SUPER_ADMIN')].sort());
  });
});
