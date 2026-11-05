import { describe, it, expect } from 'vitest';
import { assertNoClientTenant } from './http-core';

describe('assertNoClientTenant', () => {
  it('allows tenantId and branchId for /super-admin endpoints', () => {
    expect(() => {
      assertNoClientTenant({ tenantId: 't1', toPlanCode: 'Professional' }, '/super-admin/billing/subscriptions/change-plan');
    }).not.toThrow();

    expect(() => {
      assertNoClientTenant({ branchId: 'b1' }, '/super-admin/platform/branches');
    }).not.toThrow();
  });

  it('throws for non-super-admin endpoints when tenantId is supplied', () => {
    expect(() => {
      assertNoClientTenant({ tenantId: 't1' }, '/tenant/pos/checkout');
    }).toThrow(/Refusing to send 'tenantId'/);
  });

  it('allows branchId for /auth endpoints during sign in / branch selection', () => {
    expect(() => {
      assertNoClientTenant({ branchId: 'b123' }, '/auth/select-branch');
    }).not.toThrow();

    expect(() => {
      assertNoClientTenant({ tenantId: 't123', branchId: 'b123' }, '/auth/select-branch');
    }).toThrow(/Refusing to send 'tenantId'/);
  });
});
