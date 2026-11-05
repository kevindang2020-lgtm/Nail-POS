// manager-override-permission.vitest.spec.ts — the ONE managerOverride rule (BK's resolveManagerOverride, merge Oct 12 2026;
// the other chat's auth/manager-override-permission spec, workforce audit P0 #7, adapted by AUTH): the body flag is a
// permission (pos.booking.override_conflict → booking.override: OWNER + MANAGER), refused without it, reported when used.
// Queue / booking adoption is covered by BK's own specs.
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@aipowersalon/permissions';
import { resolveManagerOverride, ManagerOverrideForbiddenError, MANAGER_OVERRIDE_PERMISSION } from './manager-override';

const sess = (role: string, permissions: string[]) => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role, permissions });

describe('resolveManagerOverride', () => {
  it('OWNER and MANAGER role defaults carry the override; front desk, reception and technicians do not', () => {
    for (const r of ['OWNER', 'MANAGER']) expect(resolveManagerOverride(sess(r, permissionsFor(r as any) as string[]), true, () => undefined, 'x'), r).toBe(true);
    for (const r of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN']) expect(() => resolveManagerOverride(sess(r, permissionsFor(r as any) as string[]), true, () => undefined, 'x'), r).toThrow(ManagerOverrideForbiddenError);
  });
  it('not asked → false and silent, whoever asks', () => {
    const used: any[] = [];
    expect(resolveManagerOverride(sess('FRONT_DESK', []), undefined, (u) => used.push(u), 'x')).toBe(false);
    expect(resolveManagerOverride(sess('FRONT_DESK', []), false, (u) => used.push(u), 'x')).toBe(false);
    expect(used).toEqual([]);
  });
  it('asked without the permission → 403-class error, never a silent downgrade, nothing reported', () => {
    const used: any[] = [];
    expect(() => resolveManagerOverride(sess('FRONT_DESK', ['booking.manage', 'queue.manage']), true, (u) => used.push(u), 'queue.assign_technician')).toThrow(ManagerOverrideForbiddenError);
    expect(used).toEqual([]);
  });
  it('asked with the permission → true and reported once with the action and actor', () => {
    const used: any[] = [];
    expect(resolveManagerOverride(sess('MANAGER', [MANAGER_OVERRIDE_PERMISSION]), true, (u) => used.push(u), 'queue.assign_technician')).toBe(true);
    expect(used).toEqual([{ action: 'queue.assign_technician', userId: 'u1', role: 'MANAGER', permission: MANAGER_OVERRIDE_PERMISSION }]);
  });
});
