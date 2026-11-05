// mfa-enrollment.guard.vitest.spec.ts — Constitution 3 Step 9: an enrollment-only session reaches /auth/* until it has a
// confirmed authenticator; the moment it does, the gate lifts.
import { describe, it, expect } from 'vitest';
import { MfaEnrollmentGuard, enrollmentAllows } from './mfa-enrollment.guard';
const ctxOf = (url: string, ctx: any) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, ctx }) }) }) as any;
const dbWith = (hasFactor: boolean) => ({ executeQuery: async () => ({ rows: hasFactor ? [{ '?column?': 1 }] : [] }), getExecutor: undefined }) as any;
describe('MfaEnrollmentGuard', () => {
  it('auth routes always; other routes refused until enrolled', async () => {
    expect(enrollmentAllows('/auth/mfa/enroll')).toBe(true); expect(enrollmentAllows('/api/v1/auth/me')).toBe(true); expect(enrollmentAllows('/pos/booking/state')).toBe(false);
    const g = new MfaEnrollmentGuard(null);
    const restricted = { userId: 'u1', restriction: 'MFA_ENROLLMENT_REQUIRED' };
    expect(await g.canActivate(ctxOf('/auth/mfa/confirm', restricted))).toBe(true);
    await expect(g.canActivate(ctxOf('/pos/booking/state', restricted))).rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_REQUIRED' } });
    expect(await g.canActivate(ctxOf('/pos/booking/state', { userId: 'u2' }))).toBe(true);                       // not restricted
    expect(await g.canActivate(ctxOf('/pos/booking/state', { userId: 'u3', restriction: 'SUSPENDED_BILLING_ONLY' }))).toBe(true);   // another guard's business
  });
});
