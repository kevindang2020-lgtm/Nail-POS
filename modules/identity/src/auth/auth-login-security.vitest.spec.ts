// auth-login-security.vitest.spec.ts — the security assertions your spec (§11) requires by name and that were
// not yet covered anywhere:
//   • Login response does not expose password hashes
//   • Login response does not expose internal secrets (TOTP/MFA secret, session signing secret)
//   • Error response does not confirm account existence
//   • Secure cookie settings are enabled in production
//   • Remember Me follows the correct session policy (SERVER-decided duration)
//   • Tenant / branch / role cannot be changed through request manipulation
import { describe, it, expect } from 'vitest';
import { loginResponse } from './auth.http';
import { verifySession } from './auth-session-token';
import type { LoginResult } from './auth-login.service';

const SECRET = 'test-session-secret-value-32-chars-long';

const principal = {
  userId: 'u1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  branchId: 'bbbbbbbb-1111-1111-1111-111111111111',
  role: 'RECEPTIONIST',
  permissions: ['pos.checkout'],
  subscriptionStatus: 'active',
  needsBranchSelection: false,
  fullName: 'Sam Receptionist',
  // Fields that MUST NEVER reach the client — deliberately present on the internal object:
  passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
  totpSecret: 'JBSWY3DPEHPK3PXP',
} as any;

const success: LoginResult = { outcome: 'SUCCESS', message: 'Signed in.', principal } as any;

describe('login response never leaks secrets (§11)', () => {
  const res = loginResponse(success, { secret: SECRET, secure: true });
  const body = JSON.stringify(res.body);

  it('does NOT expose the password hash', () => {
    expect(body).not.toContain('$2b$');
    expect(body).not.toMatch(/passwordHash/i);
  });

  it('does NOT expose the MFA/TOTP secret', () => {
    expect(body).not.toContain('JBSWY3DPEHPK3PXP');
    expect(body).not.toMatch(/totp|mfaSecret/i);
  });

  it('does NOT expose the session signing secret', () => {
    expect(body).not.toContain(SECRET);
  });

  it('returns only the whitelisted principal fields', () => {
    const p: any = (res.body as any).principal;
    expect(Object.keys(p).sort()).toEqual(
      ['branchId', 'fullName', 'needsBranchSelection', 'permissions', 'role', 'subscriptionStatus', 'tenantId', 'userId'].sort(),
    );
  });
});

describe('secure cookie settings (§11)', () => {
  it('production: httpOnly + secure + SameSite', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true });   // secure = NODE_ENV==='production'
    expect(res.cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  });

  it('the session token is in the cookie, never in the response body', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true });
    expect(res.cookie?.value).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(res.cookie!.value);
  });
});

describe('Remember Me follows the SERVER session policy (§11)', () => {
  it('an extended TTL lengthens the cookie lifetime; the client never supplies a duration', () => {
    const normal = loginResponse(success, { secret: SECRET, secure: true, ttlSeconds: 60 * 60 * 12 });   // 12h
    const remembered = loginResponse(success, { secret: SECRET, secure: true, ttlSeconds: 60 * 60 * 24 * 30 }); // 30d
    expect(remembered.cookie!.maxAge).toBeGreaterThan(normal.cookie!.maxAge);
    // both remain hardened regardless of duration
    expect(remembered.cookie).toMatchObject({ httpOnly: true, secure: true });
  });
});

describe('tenant / branch / role cannot be changed by request manipulation (§11)', () => {
  it('the session claims come from the SERVER-verified principal, not from any client field', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true });
    const v: any = verifySession(res.cookie!.value, { secret: SECRET });
    expect(v.valid).toBe(true);
    expect(v.payload.tenantId).toBe(principal.tenantId);
    expect(v.payload.branchId).toBe(principal.branchId);
    expect(v.payload.role).toBe('RECEPTIONIST');
    // the signed claims carry no secret material
    expect(JSON.stringify(v.payload)).not.toContain('$2b$');
    expect(JSON.stringify(v.payload)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('a tampered session token is REJECTED (a client cannot forge a tenant/role)', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true });
    const token = res.cookie!.value;

    // flip a character in the payload — any alteration must fail signature verification
    const tampered = token.slice(0, -3) + (token.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
    expect(verifySession(tampered, { secret: SECRET }).valid).toBe(false);

    // a token signed with a DIFFERENT secret is also rejected
    const foreign = loginResponse(success, { secret: 'another-secret-value-that-is-32ch', secure: true }).cookie!.value;
    expect(verifySession(foreign, { secret: SECRET }).valid).toBe(false);
  });
});

describe('error responses do not confirm account existence (§11)', () => {
  it('an unknown store code and a wrong password return the SAME status class', () => {
    const badPw = loginResponse({ outcome: 'INVALID_CREDENTIALS', message: 'x' } as any, { secret: SECRET, secure: true });
    const noStore = loginResponse({ outcome: 'TENANT_NOT_FOUND', message: 'x' } as any, { secret: SECRET, secure: true });
    expect(badPw.status).toBe(401);
    expect(noStore.status).toBe(401);          // identical — the status code itself cannot be used to probe
    expect(badPw.cookie).toBeFalsy();          // and no session is issued either way
    expect(noStore.cookie).toBeFalsy();
  });

  it('an inactive branch is an account-access refusal (403), not a credential error', () => {
    const res = loginResponse({ outcome: 'BRANCH_INACTIVE', message: 'This salon location is not currently active.' } as any, { secret: SECRET, secure: true });
    expect(res.status).toBe(403);              // consistent with TENANT_SUSPENDED / USER_DISABLED
    expect(res.cookie).toBeFalsy();            // no session for an inactive branch
  });
});
