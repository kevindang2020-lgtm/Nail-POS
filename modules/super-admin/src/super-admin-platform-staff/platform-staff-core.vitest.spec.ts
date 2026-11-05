// Constitution 7 §24–§26 — the platform role-change rules.
import { describe, it, expect } from 'vitest';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { decideRoleChange, type RoleChangeInput } from './platform-staff-core';

const SA = { userId: 'sa1', permissions: platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[] };
const target = (over: Partial<NonNullable<RoleChangeInput['target']>> = {}) => ({ userId: 't1', isPlatformAccount: true, status: 'active', currentRole: 'PLATFORM_SUPPORT', ...over });
const base = (over: Partial<RoleChangeInput> = {}): RoleChangeInput => ({ actor: SA, target: target(), newRole: 'PLATFORM_FINANCE', reason: 'moved to the finance team', activeSuperAdmins: 2, ...over });

describe('platform role changes', () => {
  it('a Platform Super Admin may move another account between roles', () => {
    expect(decideRoleChange(base())).toEqual({ ok: true, from: 'PLATFORM_SUPPORT', to: 'PLATFORM_FINANCE' });
  });
  it('needs super_admin.platform_roles.manage — a Platform Admin (everything else) is refused', () => {
    const admin = { userId: 'a1', permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };
    expect(decideRoleChange(base({ actor: admin }))).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('§25 grant ceiling: an actor holding the manage key but not every key of the new role cannot grant it', () => {
    const narrow = { userId: 'n1', permissions: [...(platformPermissionsFor('PLATFORM_SUPPORT') as string[]), 'super_admin.platform_roles.manage'] };
    expect(decideRoleChange(base({ actor: narrow, newRole: 'PLATFORM_SUPER_ADMIN' }))).toMatchObject({ ok: false, code: 'beyond_grant_ceiling' });
    expect(decideRoleChange(base({ actor: narrow, newRole: 'PLATFORM_FINANCE' }))).toMatchObject({ ok: false, code: 'beyond_grant_ceiling' });
  });
  it('§25 no self-escalation (or self-demotion): nobody changes their own role', () => {
    expect(decideRoleChange(base({ target: target({ userId: 'sa1', currentRole: 'PLATFORM_SUPER_ADMIN' }), newRole: 'PLATFORM_AUDITOR' }))).toMatchObject({ ok: false, code: 'self_change' });
  });
  it('§26 the last ACTIVE Platform Super Admin cannot be moved; with a second one it can', () => {
    const last = base({ target: target({ currentRole: 'PLATFORM_SUPER_ADMIN' }), newRole: 'PLATFORM_ADMIN', activeSuperAdmins: 1 });
    expect(decideRoleChange(last)).toMatchObject({ ok: false, status: 409, code: 'last_super_admin' });
    expect(decideRoleChange({ ...last, activeSuperAdmins: 2 })).toMatchObject({ ok: true, from: 'PLATFORM_SUPER_ADMIN', to: 'PLATFORM_ADMIN' });
  });
  it('refuses an unknown role, a missing reason, a non-platform account, and a no-op', () => {
    expect(decideRoleChange(base({ newRole: 'ROOT' }))).toMatchObject({ ok: false, code: 'unknown_role' });
    expect(decideRoleChange(base({ reason: 'because' }))).toMatchObject({ ok: false, code: 'reason_required' });
    expect(decideRoleChange(base({ target: null }))).toMatchObject({ ok: false, status: 404 });
    expect(decideRoleChange(base({ newRole: 'PLATFORM_SUPPORT' }))).toMatchObject({ ok: false, code: 'no_change' });
  });
});
