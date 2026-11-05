// role-matrix.vitest.spec.ts — BUILD_PLAN Phase 9 (Constitution 2 §153 "role-matrix tests" + "escalation tests").
//
// 1. THE MATRIX. For every session route × every tenant role and every platform role, the allow / deny the guards decide
//    (scripts/role-matrix.mjs computes it with the guards' own functions) must equal the committed snapshot
//    (apps/api/security/role-matrix.snapshot.json). A change in who may call what is a decision: regenerate the snapshot
//    on purpose (node apps/api/scripts/role-matrix.mjs --write) and the diff shows exactly who gained or lost what.
// 2. INVARIANTS that hold whatever the snapshot says (no tenant role on the platform plane and vice versa, …).
// 3. ESCALATION: self-assignment, peer widening, a custom role above the actor, an ALLOW / super_admin.* override
//    (decision-level here; the write-path refusals are in modules/workforce access-governance escalation.pgtest), and a
//    branch-level role replacing the session role.
import { describe, it, expect } from 'vitest';
import { permissionsFor, templatePermissions, findRoleTemplate, decide, hasPermission, ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { StaffRolesService, InMemoryStaffRolesStore, StaffRoleError, narrowByBranchRole } from '@aipowersalon/identity';

const m: any = await import('../../scripts/role-matrix.mjs');
const now = m.computeMatrix();
const col = (label: string) => now.principals.indexOf(label);
const TENANT = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];
const PLATFORM = now.principals.filter((p: string) => p.startsWith('PLATFORM_'));
const allowed = (c: string) => c === 'A' || c === 'U';

describe('the per-role ALLOW / DENY matrix', () => {
  it('covers every session route for every tenant role and every platform role', () => {
    expect(Object.keys(now.routes).length).toBeGreaterThan(1000);
    for (const r of [...TENANT, 'CUSTOMER']) expect(now.principals).toContain(r);
    expect(PLATFORM.length).toBeGreaterThanOrEqual(10);
    for (const row of Object.values(now.routes) as string[]) expect(row).toMatch(new RegExp(`^[ADRUX]{${now.principals.length}}$`));
  });

  it('equals the committed snapshot (regenerate ON PURPOSE: node apps/api/scripts/role-matrix.mjs --write)', () => {
    const changes = m.diffMatrix(m.loadSnapshot(), now);
    expect(changes.slice(0, 50)).toEqual([]);
  });

  it('no tenant role or customer reaches the platform plane; no platform role reaches a salon staff route', () => {
    const bad: string[] = [];
    for (const [route, row] of Object.entries(now.routes) as [string, string][]) {
      const path = route.split(' ')[1];
      if (/^\/super-admin(\/|$)/.test(path)) for (const r of [...TENANT, 'CUSTOMER']) if (allowed(row[col(r)])) bad.push(`${route} ${r}`);
      if (/^\/(pos|owner|tech)(\/|$)/.test(path)) for (const p of [...PLATFORM, 'CUSTOMER']) if (allowed(row[col(p)])) bad.push(`${route} ${p}`);
    }
    expect(bad).toEqual([]);
  });

  it('the Phase 9 governance and access routes: the owner yes, everyone else as their keys say', () => {
    const row = (k: string) => now.routes[k] as string;
    for (const k of ['GET /pos/security/high-risk', 'GET /pos/security/dormant', 'GET /pos/security/denials', 'POST /pos/security/access-reviews', 'POST /pos/security/access-reviews/{id}/decisions']) {
      expect(row(k)[col('OWNER')], k).toBe('A');
      for (const r of ['MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN']) expect(row(k)[col(r)], `${k} ${r}`).toBe('D');
      for (const p of PLATFORM) expect(row(k)[col(p)], `${k} ${p}`).toBe('R');
    }
  });

  it('exporting the customer list is the owner\'s and the manager\'s only (Constitution 12 §323)', () => {
    const r = now.routes['GET /pos/customers/export'] as string;
    expect([r[col('OWNER')], r[col('MANAGER')], r[col('FRONT_DESK')], r[col('RECEPTION')], r[col('TECHNICIAN')]]).toEqual(['A', 'A', 'D', 'D', 'D']);
  });

  it('the matrix is computed with the guards\' logic: a key the role holds is A, a key it lacks is D', () => {
    const f = { perms: ['checkout.approve_refund'], derived: null, guards: [] };
    const p = (role: string) => ({ role, label: role, permissions: permissionsFor(role as any) });
    expect(m.cell(p('MANAGER'), f, '/pos/x')).toBe('A');
    expect(m.cell(p('FRONT_DESK'), f, '/pos/x')).toBe('D');
    expect(m.cell(p('CUSTOMER'), f, '/pos/x')).toBe('R');
    expect(m.cell(p('OWNER'), { perms: [], derived: null, guards: ['SuperAdminGuard'] }, '/super-admin/x')).toBe('R');
    // a SuperAdminGuard outside the /super-admin prefix (e.g. the AI control plane) still refuses every salon role
    expect(m.cell(p('OWNER'), { perms: [], derived: null, guards: ['SuperAdminGuard'] }, '/ai/control-plane/x')).toBe('R');
    expect(m.cell(p('TECHNICIAN'), { perms: [], derived: null, guards: ['TenantAuthGuard'] }, '/pos/x')).toBe('X');   // TENANT_DEFAULT_DENY is ON (Phase 9 integration): an unkeyed staff handler is refused, never 'U'
    expect(m.cell(p('CUSTOMER'), { perms: [], derived: null, guards: ['StaffSessionGuard'] }, '/auth/x')).toBe('R');
  });
});

// ── escalation ───────────────────────────────────────────────────────────────────────────────────────────────────────
const T = 't-esc';
function salon() {
  const store = new InMemoryStaffRolesStore();
  for (const [id, role] of [['owner', 'OWNER'], ['owner2', 'OWNER'], ['mgr', 'MANAGER'], ['mgr2', 'MANAGER'], ['desk', 'FRONT_DESK']] as const) store.users.set(`${T}::${id}`, role);
  return { store, svc: new StaffRolesService(store) };
}
const actor = (userId: string, role: string, permissions: string[]) => ({ tenantId: T, userId, role, permissions });
const refused = async (p: Promise<unknown>) => p.then(() => 'allowed', (e) => (e instanceof StaffRoleError ? e.code : String(e)));

describe('escalation', () => {
  it('SELF-ASSIGNMENT: nobody changes their own role — not even to a narrower or equal one', async () => {
    const { svc } = salon();
    expect(await refused(svc.assignRole(actor('mgr', 'MANAGER', permissionsFor('MANAGER')), 'mgr', 'GENERAL_MANAGER'))).toBe('FORBIDDEN');
    expect(await refused(svc.assignRole(actor('desk', 'FRONT_DESK', permissionsFor('FRONT_DESK')), 'desk', 'RECEPTIONIST'))).toBe('FORBIDDEN');
  });

  it('PEER WIDENING: a narrowed manager cannot give a peer a role carrying keys the actor does not hold', async () => {
    const { svc } = salon();
    const narrowed = templatePermissions(findRoleTemplate('INVENTORY_MANAGER')!);
    expect(await refused(svc.assignRole(actor('mgr', 'MANAGER', narrowed), 'mgr2', 'GENERAL_MANAGER'))).toBe('FORBIDDEN');
    // …while a full manager may (within their own ceiling), and nobody but the owner touches an owner-level role
    expect(await refused(svc.assignRole(actor('mgr', 'MANAGER', permissionsFor('MANAGER')), 'mgr2', 'GENERAL_MANAGER'))).toBe('allowed');
    expect(await refused(svc.assignRole(actor('mgr', 'MANAGER', permissionsFor('MANAGER')), 'desk', 'TENANT_ADMIN'))).toBe('FORBIDDEN');
    expect(await refused(svc.assignRole(actor('mgr', 'MANAGER', permissionsFor('MANAGER')), 'owner', 'GENERAL_MANAGER'))).toBe('FORBIDDEN');
  });

  it('CUSTOM ROLE ABOVE THE ACTOR: a role may only be built from permissions the builder holds', async () => {
    const { svc } = salon();
    const narrowed = templatePermissions(findRoleTemplate('MARKETING_MANAGER')!);
    expect(await refused(svc.createCustomRole(actor('mgr', 'MANAGER', narrowed), { name: 'Shadow GM', baseRole: 'MANAGER', scope: 'TENANT', permissions: ['pos.login', 'reports.export', 'customers.export'] }))).toBe('FORBIDDEN');
    expect(await refused(svc.createCustomRole(actor('mgr', 'MANAGER', permissionsFor('MANAGER')), { name: 'Co-owner', baseRole: 'OWNER', scope: 'TENANT', permissions: ['pos.login'] }))).not.toBe('allowed');
  });

  it('ALLOW OVERRIDE / super_admin.* VIA OVERRIDE: the decision never lets a salon principal hold a platform key', () => {
    const p = { userId: 'desk', tenantId: T, role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK'), overrides: [{ permission: 'super_admin.users.manage', effect: 'ALLOW' as const }] };
    expect(decide(p, 'super_admin.users.manage')).toMatchObject({ allowed: false, reason: 'platform_key_for_tenant' });
    // a DENY override beats the role's own grant
    expect(decide({ ...p, overrides: [{ permission: 'checkout.view', effect: 'DENY' as const }] }, 'checkout.view')).toMatchObject({ allowed: false, reason: 'denied_by_override' });
    // and no tenant role's grant contains a platform key in the first place
    for (const r of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'] as const) expect(ROLE_PERMISSIONS[r].some((k) => k.startsWith('super_admin.'))).toBe(false);
  });

  it('BRANCH-LEVEL ROLE: a user_branch_access row naming a wider role can only NARROW the session, never replace it', () => {
    const desk = permissionsFor('FRONT_DESK');
    const out = narrowByBranchRole(desk, 'FRONT_DESK', 'OWNER');
    expect(out.every((k) => desk.includes(k))).toBe(true);
    expect(out).not.toContain('settings.edit');
    expect(hasPermission({ tenantId: T, branchId: 'b', userId: 'desk', role: 'FRONT_DESK', permissions: out } as any, 'subscription.manage')).toBe(false);
    const mgr = narrowByBranchRole(permissionsFor('MANAGER'), 'MANAGER', 'FRONT_DESK');
    expect(mgr).not.toContain('customers.export');   // a branch row naming a NARROWER role does narrow
  });
});
