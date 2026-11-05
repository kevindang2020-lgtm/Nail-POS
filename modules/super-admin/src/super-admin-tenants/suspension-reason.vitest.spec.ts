// Constitution 7 §18, §20, §21 — what a tenant status change must carry.
import { describe, it, expect } from 'vitest';
import { statusChangeRequirement, SUSPENSION_REASON_CODES } from './super-admin-tenants-core';

describe('tenant status change requirements', () => {
  it('suspension needs one of the seven reason codes AND a written reason', () => {
    expect(SUSPENSION_REASON_CODES).toEqual(['BILLING', 'SECURITY', 'TERMS', 'FRAUD', 'TENANT_REQUEST', 'PLATFORM_OPERATION', 'OTHER']);
    expect(statusChangeRequirement('suspend', 'card declined three times', undefined)).toMatch(/suspension reason/);
    expect(statusChangeRequirement('suspend', 'card declined three times', 'LATE')).toMatch(/suspension reason/);
    expect(statusChangeRequirement('suspend', 'short', 'BILLING')).toMatch(/at least 10/);
    expect(statusChangeRequirement('suspend', 'card declined three times', 'BILLING')).toBeNull();
  });
  it('reactivation and closure need a written reason; first activation of a pending tenant does not', () => {
    expect(statusChangeRequirement('reactivate', '', undefined)).toMatch(/reactivate/);
    expect(statusChangeRequirement('reactivate', 'billing resolved in full', undefined)).toBeNull();
    expect(statusChangeRequirement('cancel', 'x', undefined)).toMatch(/close/);
    expect(statusChangeRequirement('activate', undefined, undefined)).toBeNull();
  });
});
