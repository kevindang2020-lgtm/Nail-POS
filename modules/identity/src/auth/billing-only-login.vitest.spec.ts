// Constitution 7 §19 — billing-only sign-in for the owner of a salon suspended for a cause that keeps billing access.
import { describe, it, expect } from 'vitest';
import { decideLogin, ownerBillingAllowed, type LoginFacts } from './auth-flow';

const base: LoginFacts = { tenantFound: true, tenantStatus: 'suspended', userFound: true, passwordValid: true, userStatus: 'active',
  subscriptionStatus: 'past_due', mfaRequired: false, mfaSatisfied: true, branchCount: 3, role: 'OWNER', suspensionReasonCode: 'BILLING' };

describe('billing-only sign-in while suspended', () => {
  it('the owner of a BILLING-suspended salon signs in to a billing-only session — past-due subscription and branches do not block it', () => {
    expect(decideLogin(base)).toMatchObject({ outcome: 'SUCCESS', restriction: 'SUSPENDED_BILLING_ONLY' });
  });
  it('staff never; SECURITY / FRAUD never; an unknown or missing cause never', () => {
    for (const role of ['MANAGER', 'TECHNICIAN', 'CASHIER']) expect(decideLogin({ ...base, role })).toMatchObject({ outcome: 'TENANT_SUSPENDED' });
    for (const code of ['SECURITY', 'FRAUD', 'LATE', null]) expect(decideLogin({ ...base, suspensionReasonCode: code })).toMatchObject({ outcome: 'TENANT_SUSPENDED' });
  });
  it('still needs valid credentials, an active user and MFA', () => {
    expect(decideLogin({ ...base, passwordValid: false })).toMatchObject({ outcome: 'INVALID_CREDENTIALS' });
    expect(decideLogin({ ...base, userStatus: 'suspended' as any })).toMatchObject({ outcome: 'USER_DISABLED' });
    expect(decideLogin({ ...base, mfaRequired: true, mfaSatisfied: false })).toMatchObject({ outcome: 'MFA_REQUIRED' });
  });
  it('an ACTIVE salon is unaffected (no restriction), and a caller that passes no role keeps the old refusal', () => {
    expect(decideLogin({ ...base, tenantStatus: 'active', subscriptionStatus: 'active', branchCount: 1 })).toEqual({ outcome: 'SUCCESS', message: 'Signed in.' });
    expect(decideLogin({ ...base, role: undefined })).toMatchObject({ outcome: 'TENANT_SUSPENDED' });
    expect(ownerBillingAllowed('TERMS')).toBe(true);
  });
});
