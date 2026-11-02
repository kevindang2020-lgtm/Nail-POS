import { describe, it, expect } from 'vitest';
import { loginResponse, logoutResponse } from './auth.http';
import { verifySession } from './auth-session-token';
import { SESSION_COOKIE } from './session-from-request';
import type { LoginResult, LoginPrincipal } from './auth-login.service';

const SECRET = 'controller-test-secret';
const principal: LoginPrincipal = {
  userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER',
  permissions: ['pos.queue.view'], subscriptionStatus: 'active', needsBranchSelection: false, fullName: 'Ann Owner',
};

describe('auth.http.loginResponse', () => {
  it('SUCCESS → 200, sets a valid httpOnly session cookie, echoes principal', () => {
    const res = loginResponse({ outcome: 'SUCCESS', message: 'Signed in.', principal }, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.cookie?.name).toBe(SESSION_COOKIE);
    expect(res.cookie?.httpOnly).toBe(true);
    const v = verifySession(res.cookie!.value, { secret: SECRET });
    expect(v.valid).toBe(true);
    if (v.valid) { expect(v.payload.userId).toBe('u1'); expect(v.payload.role).toBe('OWNER'); }
  });

  it('secure flag honored', () => {
    const res = loginResponse({ outcome: 'SUCCESS', message: 'x', principal }, { secret: SECRET, secure: true });
    expect(res.cookie?.secure).toBe(true);
  });

  it('INVALID_CREDENTIALS → 401, no cookie', () => {
    const res = loginResponse({ outcome: 'INVALID_CREDENTIALS', message: 'generic' } as LoginResult, { secret: SECRET });
    expect(res.status).toBe(401);
    expect(res.cookie).toBeUndefined();
    expect(res.body.ok).toBe(false);
  });

  it('TENANT_SUSPENDED → 403, no cookie', () => {
    const res = loginResponse({ outcome: 'TENANT_SUSPENDED', message: 'suspended' } as LoginResult, { secret: SECRET });
    expect(res.status).toBe(403);
    expect(res.cookie).toBeUndefined();
  });

  it('MFA_REQUIRED → 200, no cookie', () => {
    const res = loginResponse({ outcome: 'MFA_REQUIRED', message: 'code?' } as LoginResult, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.cookie).toBeUndefined();
    expect(res.body.ok).toBe(false);
  });

  it('BRANCH_SELECTION_REQUIRED → 200, sets an authenticated session cookie with branchId null, returns principal flagged', () => {
    const res = loginResponse({ outcome: 'BRANCH_SELECTION_REQUIRED', message: 'pick', principal: { ...principal, branchId: null, needsBranchSelection: true } }, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.cookie?.name).toBe(SESSION_COOKIE);
    const v = verifySession(res.cookie!.value, { secret: SECRET });
    expect(v.valid && v.payload.branchId).toBe(null);
    expect((res.body as any).principal.needsBranchSelection).toBe(true);
  });
});

describe('auth.http.logoutResponse', () => {
  it('clears the session cookie', () => {
    const res = logoutResponse();
    expect(res.status).toBe(200);
    expect(res.clearCookie?.name).toBe(SESSION_COOKIE);
  });
});
