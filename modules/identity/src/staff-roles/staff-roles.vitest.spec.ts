// staff-roles.vitest.spec.ts — Functional Decision 12, step 2: custom roles, assignment, and the fail-safe resolver.
import { describe, it, expect } from 'vitest';
import { StaffRolesService, InMemoryStaffRolesStore } from './staff-roles';
import { permissionsFor, STAFF_SELF_SERVICE } from '@aipowersalon/permissions';

const T = 't1';
const OWNER = { tenantId: T, userId: 'u-owner', role: 'OWNER' };
const MANAGER = { tenantId: T, userId: 'u-mgr', role: 'MANAGER' };
function setup() {
  const store = new InMemoryStaffRolesStore();
  store.users.set(T + '::u-acct', 'MANAGER'); store.users.set(T + '::u-desk', 'FRONT_DESK'); store.users.set(T + '::u-owner2', 'OWNER');
  const audit: any[] = [];
  return { store, audit, svc: new StaffRolesService(store, { record: (e) => audit.push(e) }) };
}

describe('Decision 12 step 2 — custom roles', () => {
  it('lists the ten defaults plus the salon\'s own roles; a created role is audited', async () => {
    const { svc, audit } = setup();
    const r = await svc.createCustomRole(MANAGER, { name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'booking.manage'] });
    expect(r.key.startsWith('custom:')).toBe(true);
    const all = await svc.listRoles(T);
    expect(all).toHaveLength(11);
    expect(all.find((x) => x.name === 'Front Desk Lead')!.permissions).toEqual(['booking.manage', 'pos.login']);
    expect(audit[0]).toMatchObject({ action: 'staff_role_created', tenantId: T });
  });
  it('rules: no duplicates, no widening, owner-level only by the owner, staff only', async () => {
    const { svc } = setup();
    await svc.createCustomRole(OWNER, { name: 'Floor Lead', baseRole: 'MANAGER', scope: 'BRANCH', permissions: ['pos.login'] });
    await expect(svc.createCustomRole(OWNER, { name: 'floor lead', baseRole: 'MANAGER', scope: 'BRANCH', permissions: ['pos.login'] })).rejects.toThrow(/already exists/);
    await expect(svc.createCustomRole(OWNER, { name: 'Wide', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'settings.edit'] })).rejects.toThrow(/not part of/);
    await expect(svc.createCustomRole(MANAGER, { name: 'Co-owner', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] })).rejects.toThrow(/owner/i);
    await expect(svc.createCustomRole({ tenantId: T, userId: 'x', role: 'FRONT_DESK' }, { name: 'Mine', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'] })).rejects.toThrow(/owner or a manager/);
  });
  it('an archived role disappears from the list and can no longer be assigned', async () => {
    const { svc } = setup();
    const r = await svc.createCustomRole(OWNER, { name: 'Temp', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'] });
    await svc.archiveCustomRole(OWNER, r.key.slice(7));
    expect((await svc.listRoles(T)).some((x) => x.name === 'Temp')).toBe(false);
    await expect(svc.assignRole(OWNER, 'u-desk', r.key)).rejects.toThrow(/not found/i);
  });
});

describe('Decision 12 step 2 — assigning roles', () => {
  it('Accountant (built on Manager) can be given to a Manager-role user; the resolver then returns the narrow set', async () => {
    const { svc } = setup();
    await svc.assignRole(OWNER, 'u-acct', 'ACCOUNTANT');
    const perms = (await svc.resolvePermissions(T, 'u-acct', 'MANAGER'))!;
    expect(perms).toContain('reports.view'); expect(perms).not.toContain('checkout.process_payment');
    expect(perms.length).toBeLessThan(permissionsFor('MANAGER').length);
  });
  it('BUILD_PLAN Phase 9: a template may MOVE a person to its base role (promotion / demotion) — the users.role changes too', async () => {
    const { svc, store } = setup();
    expect(await svc.assignRole(OWNER, 'u-desk', 'ACCOUNTANT', { reason: 'promoted' })).toEqual({ userId: 'u-desk', templateKey: 'ACCOUNTANT', role: 'MANAGER' });
    expect(await store.userBaseRole(T, 'u-desk')).toBe('MANAGER');
    expect(store.changes[0]).toMatchObject({ toBase: 'MANAGER', templateKey: 'ACCOUNTANT', reason: 'promoted', by: 'u-owner' });
    expect((await svc.resolvePermissions(T, 'u-desk', 'MANAGER'))!).toContain('reports.view');
  });
  it('a manager cannot change an owner, nor hand out owner-level roles; not-staff-here is refused', async () => {
    const { svc } = setup();
    await expect(svc.assignRole(MANAGER, 'u-owner2', 'TENANT_ADMIN')).rejects.toThrow(/owner/i);
    // isolates the rule: CLEARING an owner's role involves no template, so only 'a manager cannot change an owner' can stop it
    await expect(svc.assignRole(MANAGER, 'u-owner2', null)).rejects.toThrow("Only the owner can change an owner's role.");
    await expect(svc.assignRole(MANAGER, 'u-stranger', 'RECEPTIONIST')).rejects.toThrow(/not a staff member/);
    await svc.assignRole(OWNER, 'u-owner2', 'TENANT_ADMIN');   // the owner may
  });
});

describe('no escalation through staff roles (Phase 1, Oct 6 2026)', () => {
  // The owner narrowed this manager to the Accountant set (reports, no payments, no payroll approval).
  const NARROW = { tenantId: T, userId: 'u-narrow', role: 'MANAGER' };
  async function narrowed() {
    const ctx = setup();
    ctx.store.users.set(T + '::u-narrow', 'MANAGER');
    await ctx.svc.assignRole(OWNER, 'u-narrow', 'ACCOUNTANT');
    // Phase 9: managing roles is its own permission (roles.manage) — this narrowed manager kept it, and nothing else
    const perms = [...(await ctx.svc.resolvePermissions(T, 'u-narrow', 'MANAGER'))!, 'roles.manage', 'roles.view'];
    return { ...ctx, actor: { ...NARROW, permissions: perms } };
  }

  it('nobody changes their OWN role — not even to clear it back to the full manager defaults', async () => {
    const { svc, actor } = await narrowed();
    await expect(svc.assignRole(actor, 'u-narrow', 'GENERAL_MANAGER')).rejects.toThrow(/your own role/);
    await expect(svc.assignRole(actor, 'u-narrow', null)).rejects.toThrow(/your own role/);
    await expect(svc.assignRole(OWNER, 'u-owner', null)).rejects.toThrow(/your own role/);
  });

  it('a narrowed manager cannot give ANOTHER manager more than they hold (template or cleared defaults)', async () => {
    const { svc, actor } = await narrowed();
    await expect(svc.assignRole(actor, 'u-acct', 'GENERAL_MANAGER')).rejects.toThrow(/do not hold yourself/);
    await expect(svc.assignRole(actor, 'u-acct', null)).rejects.toThrow(/do not hold yourself/);
    await svc.assignRole(actor, 'u-acct', 'ACCOUNTANT');   // within their own set: allowed
  });

  it('a narrowed manager cannot build a custom role from permissions they lack', async () => {
    const { svc, actor } = await narrowed();
    await expect(svc.createCustomRole(actor, { name: 'Payments', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', 'checkout.process_payment'] }))
      .rejects.toThrow(/permissions you hold yourself/);
    await svc.createCustomRole(actor, { name: 'Reports only', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', 'reports.view'] });
  });

  it('a full manager and the owner keep working as before', async () => {
    const { svc } = setup();
    await svc.assignRole({ ...MANAGER, permissions: [...permissionsFor('MANAGER')] }, 'u-acct', 'GENERAL_MANAGER');
    await svc.assignRole(OWNER, 'u-acct', null);
  });
});

describe('Decision 12 step 2 — the resolver is FAIL-SAFE (null = use the base-role defaults)', () => {
  it('no assignment → null; base role changed since → null; archived custom role → null; a store error → null', async () => {
    const { svc, store } = setup();
    expect(await svc.resolvePermissions(T, 'u-acct', 'MANAGER')).toBeNull();
    await svc.assignRole(OWNER, 'u-acct', 'ACCOUNTANT');
    expect(await svc.resolvePermissions(T, 'u-acct', 'FRONT_DESK')).toBeNull();          // platform changed their base role
    const r = await svc.createCustomRole(OWNER, { name: 'Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'] });
    await svc.assignRole(OWNER, 'u-desk', r.key); await svc.archiveCustomRole(OWNER, r.key.slice(7));
    expect(await svc.resolvePermissions(T, 'u-desk', 'FRONT_DESK')).toBeNull();
    store.assignment = async () => { throw new Error('db down'); };
    expect(await svc.resolvePermissions(T, 'u-acct', 'MANAGER')).toBeNull();
  });
  it('never returns a permission the base role does not hold — even if a stored custom role was tampered with', async () => {
    const { svc, store } = setup();
    const r = await svc.createCustomRole(OWNER, { name: 'Lead2', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'] });
    store.roles.find((x) => x.name === 'Lead2')!.permissions.push('settings.edit', 'subscription.manage');   // written around the service
    await svc.assignRole(OWNER, 'u-desk', r.key);
    const perms = (await svc.resolvePermissions(T, 'u-desk', 'FRONT_DESK'))!;
    // Phase 9: every staff member keeps their own profile + Help Center (STAFF_SELF_SERVICE, held by every base role);
    // the tampered keys are still dropped
    expect(perms).toEqual(['pos.login', ...STAFF_SELF_SERVICE]);
    expect(perms).not.toContain('settings.edit'); expect(perms).not.toContain('subscription.manage');
  });
});

describe('BUILD_PLAN Phase 9 — permissions, not role names; target ceiling; last owner', () => {
  it('managing roles needs roles.manage — a MANAGER narrowed without it is refused, a FRONT_DESK granted it (override) may', async () => {
    const { svc } = setup();
    await expect(svc.assignRole({ ...MANAGER, permissions: ['pos.login', 'roles.view'] }, 'u-desk', 'RECEPTIONIST')).rejects.toThrow(/owner or a manager/);
    await svc.assignRole({ tenantId: T, userId: 'u-lead', role: 'FRONT_DESK', permissions: [...permissionsFor('FRONT_DESK'), 'roles.manage'] }, 'u-desk', 'SUPPORT_STAFF');
    await expect(svc.listStaff({ ...MANAGER, permissions: ['pos.login'] })).rejects.toThrow(/see staff roles/);
  });
  it('owner-level roles need ownership.transfer: a manager can neither demote an owner nor make someone one', async () => {
    const { svc, store } = setup();
    const r = await svc.createCustomRole(OWNER, { name: 'Tiny owner', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] });
    await expect(svc.assignRole({ ...MANAGER, permissions: [...permissionsFor('MANAGER')] }, 'u-desk', r.key)).rejects.toThrow(/owner-level/);
    await expect(svc.createCustomRole({ ...MANAGER, permissions: [...permissionsFor('MANAGER')] }, { name: 'Tiny owner 2', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] })).rejects.toThrow(/owner/i);
    expect(await store.userBaseRole(T, 'u-desk')).toBe('FRONT_DESK');
  });
  it('LAST_OWNER: the only active owner cannot be demoted (409 code) — not even by themselves; with a co-owner it works', async () => {
    const { svc, store } = setup();
    store.users.delete(T + '::u-owner2');
    store.users.set(T + '::u-owner', 'OWNER');
    const e = await svc.assignRole(OWNER, 'u-owner', 'GENERAL_MANAGER').catch((x) => x);
    expect(e).toMatchObject({ code: 'CONFLICT', reason: 'LAST_OWNER' });
    store.users.set(T + '::u-owner2', 'OWNER'); store.statuses.set(T + '::u-owner2', 'inactive');
    expect(await svc.assignRole(OWNER, 'u-owner', 'GENERAL_MANAGER').catch((x) => x.reason)).toBe('LAST_OWNER');   // an inactive co-owner does not count
    store.statuses.set(T + '::u-owner2', 'active');
    await expect(svc.assignRole(OWNER, 'u-owner', 'GENERAL_MANAGER')).rejects.toThrow(/your own role/);           // there IS a co-owner: the self rule applies
    expect(await svc.assignRole({ ...OWNER, userId: 'u-owner2' }, 'u-owner', 'GENERAL_MANAGER')).toMatchObject({ role: 'MANAGER' });
  });
});
