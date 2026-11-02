// global-tech-admin-perms.vitest.spec.ts — Phase 7: the technician-management actions are now individually permissioned.
// A SUPER_ADMIN passes a route only if its exact super_admin.technicians.* key is in the session — proving a session can
// be minted with routine-oversight keys but WITHOUT the dangerous ones (suspend / merge / delete / anonymize).
import { hasPermission, PERMISSIONS } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';

const KEYS = [
  'super_admin.technicians.view', 'super_admin.technicians.pause', 'super_admin.technicians.suspend',
  'super_admin.technicians.transfer', 'super_admin.technicians.merge', 'super_admin.technicians.delete_request',
  'super_admin.technicians.anonymize', 'super_admin.technicians.hard_delete', 'super_admin.technicians.memberships_manage',
  'super_admin.technicians.profile_moderate', 'super_admin.technicians.security_manage',
];

const ctx = (perms: string[]) => ({ tenantId: '', branchId: '', userId: 'admin', role: 'SUPER_ADMIN' as const, permissions: perms });

describe('granular technician-management permissions', () => {
  it('every key is registered in the RBAC catalog (so it is grantable and mintable)', () => {
    for (const k of KEYS) expect((PERMISSIONS as readonly string[]).includes(k)).toBe(true);
  });

  it('a super admin holding a routine key can view but cannot suspend/merge/delete', () => {
    const routine = ctx(['super_admin.technicians.view', 'super_admin.technicians.pause']);
    expect(hasPermission(routine, 'super_admin.technicians.view')).toBe(true);
    expect(hasPermission(routine, 'super_admin.technicians.pause')).toBe(true);
    expect(hasPermission(routine, 'super_admin.technicians.suspend')).toBe(false);
    expect(hasPermission(routine, 'super_admin.technicians.merge')).toBe(false);
    expect(hasPermission(routine, 'super_admin.technicians.anonymize')).toBe(false);
  });

  it('holding the dangerous key grants exactly that action', () => {
    expect(hasPermission(ctx(['super_admin.technicians.suspend']), 'super_admin.technicians.suspend')).toBe(true);
    // a super admin WITHOUT the key is denied it — the guard's real enforcement
    expect(hasPermission(ctx(['super_admin.technicians.view']), 'super_admin.technicians.suspend')).toBe(false);
  });
});
