// membership-rbac.vitest.spec.ts — locks the Memberships RBAC mapping. Granular pos.memberships.* keys resolve to the
// coarse "customers" capability: reads/exports require customers.view, writes require customers.edit. This guards against
// a future change silently widening or breaking access to the membership surface.
import { requiredCapability, hasPermission, type Ctx, permissionsFor } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';

const ctx = (role: any, perms: string[] = []): Ctx => ({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions: perms });

describe('Memberships RBAC mapping', () => {
  it('maps view/export to customers.view and manage to customers.edit', () => {
    expect(requiredCapability('pos.memberships.view')).toBe('customers.view');
    expect(requiredCapability('pos.memberships.export')).toBe('customers.view');
    expect(requiredCapability('pos.memberships.manage')).toBe('customers.edit');
  });

  it('grants view (not manage) to a holder of customers.view only', () => {
    const viewer = ctx('MANAGER', ['customers.view']);
    expect(hasPermission(viewer, 'pos.memberships.view')).toBe(true);
    expect(hasPermission(viewer, 'pos.memberships.manage')).toBe(false);
  });

  it('grants manage to a holder of customers.edit', () => {
    expect(hasPermission(ctx('MANAGER', ['customers.edit']), 'pos.memberships.manage')).toBe(true);
  });

  it('grants both view and manage to OWNER via the role catalog', () => {
    const owner = ctx('OWNER', permissionsFor('OWNER'));
    expect(hasPermission(owner, 'pos.memberships.view')).toBe(true);
    expect(hasPermission(owner, 'pos.memberships.manage')).toBe(true);
  });

  it('denies the membership surface to a principal with no customer capabilities', () => {
    const none = ctx('STAFF', []);
    expect(hasPermission(none, 'pos.memberships.view')).toBe(false);
    expect(hasPermission(none, 'pos.memberships.manage')).toBe(false);
  });

  it('denies SUPER_ADMIN any membership mutation (read-only oversight role)', () => {
    const sa = ctx('SUPER_ADMIN', ['customers.edit']);
    expect(hasPermission(sa, 'pos.memberships.manage')).toBe(false);
  });
});
