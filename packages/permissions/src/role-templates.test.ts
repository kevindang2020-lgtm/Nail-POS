// role-templates.vitest.spec.ts — Functional Decision 12: default roles + custom roles + scopes, each a NARROWING of an
// existing base role (never a widening).
import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLE_TEMPLATES, templatePermissions, validateCustomRole, findRoleTemplate } from './role-templates';
import { permissionsFor } from './rbac';
import { defaultScopeForRole, enterableBranches } from './role-templates';

describe('Decision 12 default roles', () => {
  it('all ten decided roles exist, each with a scope', () => {
    expect(DEFAULT_ROLE_TEMPLATES.map((t) => t.name)).toEqual(['Tenant Owner', 'Tenant Admin', 'General Manager', 'Branch Manager', 'Receptionist', 'Technician', 'Accountant', 'Inventory Manager', 'Marketing Manager', 'Support Staff']);
    for (const t of DEFAULT_ROLE_TEMPLATES) expect(['OWN', 'BRANCH', 'SELECTED_BRANCHES', 'TENANT']).toContain(t.scope);
  });
  it('NO template grants anything its base role does not — every one is a subset, and none is empty', () => {
    for (const t of DEFAULT_ROLE_TEMPLATES) {
      const base = new Set(permissionsFor(t.baseRole));
      const perms = templatePermissions(t);
      expect(perms.length, t.key).toBeGreaterThan(0);
      expect(perms.filter((p) => !base.has(p)), t.key).toEqual([]);
    }
  });
  it('the narrow roles are actually narrow', () => {
    const acc = templatePermissions(findRoleTemplate('ACCOUNTANT')!);
    expect(acc).toContain('reports.view'); expect(acc).toContain('payroll.view');
    expect(acc).not.toContain('checkout.process_payment'); expect(acc).not.toContain('booking.manage');
    const inv = templatePermissions(findRoleTemplate('INVENTORY_MANAGER')!);
    expect(inv).toContain('inventory.stock.adjust'); expect(inv).not.toContain('customers.view'); expect(inv).not.toContain('payroll.view');
    const mkt = templatePermissions(findRoleTemplate('MARKETING_MANAGER')!);
    expect(mkt).toContain('marketing.manage'); expect(mkt).not.toContain('customers.export'); expect(mkt).not.toContain('checkout.process_payment');
    const sup = templatePermissions(findRoleTemplate('SUPPORT_STAFF')!);
    // looks, never changes (its own profile + Help Center requests excepted — Phase 9 self-service keys)
    expect(sup.filter((p) => !/\.view$|^pos\.login$|^dashboard\.view$|^global_search\.use$|^self\.profile\.edit$|^self\.notifications$|^help\.request$/.test(p))).toEqual([]);
  });
  it('Tenant Admin is the owner minus billing/subscription and archiving locations', () => {
    const admin = new Set(templatePermissions(findRoleTemplate('TENANT_ADMIN')!));
    expect(admin.has('subscription.manage')).toBe(false); expect(admin.has('locations.archive')).toBe(false);
    expect(admin.has('settings.edit')).toBe(true);
    expect(permissionsFor('OWNER').length - admin.size).toBe(2);
  });
});

describe('custom roles (e.g. Assistant Manager, Front Desk Lead)', () => {
  it('a subset of a base role is accepted, de-duplicated and sorted', () => {
    const r = validateCustomRole({ name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'booking.manage', 'pos.login'] }, 'MANAGER');
    expect(r).toEqual({ ok: true, role: { name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['booking.manage', 'pos.login'] } });
  });
  it('a permission beyond the base role is refused — a custom role can narrow, never widen', () => {
    const r = validateCustomRole({ name: 'Sneaky', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'settings.edit'] }, 'OWNER');
    expect(r.ok).toBe(false); expect((r as any).error).toMatch(/settings\.edit/);
  });
  it('only an owner can create an owner-level role; platform / customer bases are refused; scope and name are checked', () => {
    expect(validateCustomRole({ name: 'Co-owner', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] }, 'MANAGER').ok).toBe(false);
    expect(validateCustomRole({ name: 'Co-owner', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] }, 'OWNER').ok).toBe(true);
    expect(validateCustomRole({ name: 'Root', baseRole: 'SUPER_ADMIN', scope: 'TENANT', permissions: [] }, 'OWNER').ok).toBe(false);
    expect(validateCustomRole({ name: 'X', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login'] }, 'OWNER').ok).toBe(false);
    expect(validateCustomRole({ name: 'Floor Lead', baseRole: 'MANAGER', scope: 'EVERYWHERE', permissions: ['pos.login'] }, 'OWNER').ok).toBe(false);
  });
});

// BUILD_PLAN Phase 9: template scope read at runtime
describe('scope at runtime (Kevin decision (1))', () => {
  it('untemplated staff take their base role\'s default template scope', () => {
    expect(defaultScopeForRole('OWNER')).toBe('TENANT');
    expect(defaultScopeForRole('MANAGER')).toBe('TENANT');
    expect(defaultScopeForRole('FRONT_DESK')).toBe('BRANCH');
    expect(defaultScopeForRole('RECEPTION')).toBe('BRANCH');
    expect(defaultScopeForRole('TECHNICIAN')).toBe('OWN');
  });
  it('grants confine any scope; BRANCH / SELECTED → home; no home → any; TENANT / OWN → any', () => {
    expect(enterableBranches({ scope: 'TENANT', grants: ['b2', 'b1', 'b2'], homeBranchId: 'b9' })).toEqual(['b1', 'b2']);
    expect(enterableBranches({ scope: 'BRANCH', grants: [], homeBranchId: 'b9' })).toEqual(['b9']);
    expect(enterableBranches({ scope: 'SELECTED_BRANCHES', grants: [], homeBranchId: 'b9' })).toEqual(['b9']);
    expect(enterableBranches({ scope: 'BRANCH', grants: [], homeBranchId: null })).toBeNull();
    expect(enterableBranches({ scope: 'TENANT', grants: [], homeBranchId: 'b9' })).toBeNull();
    expect(enterableBranches({ scope: 'OWN', grants: [], homeBranchId: 'b9' })).toBeNull();
  });
});

describe('self-service keys on every template (Phase 9 integration)', () => {
  it('every default template keeps its own profile, notifications and the Help Center', () => {
    for (const t of DEFAULT_ROLE_TEMPLATES) {
      const ps = templatePermissions(t);
      for (const k of ['self.profile.view', 'self.profile.edit', 'self.notifications', 'help.view', 'help.request']) expect(ps, `${t.key} ${k}`).toContain(k);
    }
  });
});
