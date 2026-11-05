// select-branch-body.vitest.spec.ts — BUILD_PLAN Phase 9 integration (found by the live proof): the tenant-context
// middleware strips client-named tenant / branch keys from every body. On POST /auth/select-branch that removed the very
// branch the person asked for, so a mid-session branch switch silently landed on the first enterable branch. The branch is
// kept on that one path (the branch-access service validates it); the tenant keys are still stripped there, and branchId
// is still stripped everywhere else.
import { describe, it, expect } from 'vitest';
import { isSelectBranchPath, keepBranchId } from './tenant-context.middleware';
import { stripClientTenantKeys } from '@aipowersalon/permissions';

describe('select-branch keeps the requested branch', () => {
  it('recognises only POST /auth/select-branch', () => {
    expect(isSelectBranchPath({ method: 'POST', originalUrl: '/auth/select-branch' })).toBe(true);
    expect(isSelectBranchPath({ method: 'POST', originalUrl: '/api/v1/auth/select-branch?x=1' })).toBe(true);
    expect(isSelectBranchPath({ method: 'GET', originalUrl: '/auth/select-branch' })).toBe(false);
    expect(isSelectBranchPath({ method: 'POST', originalUrl: '/pos/checkout/tickets' })).toBe(false);
  });
  it('keeps branchId, still strips tenant keys; elsewhere branchId is stripped', () => {
    expect(keepBranchId({ branchId: 'b2', tenantId: 't9', tenant_id: 't9', branch_id: 'b9' })).toEqual({ branchId: 'b2' });
    expect(stripClientTenantKeys({ branchId: 'b2', x: 1 })).toEqual({ x: 1 });
  });
});
