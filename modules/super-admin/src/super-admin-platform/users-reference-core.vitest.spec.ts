// users-reference-core.vitest.spec.ts — pure helpers behind the Users & Roles reference page (KPI cards, the
// role→permission-level mapping + distribution, and Role Health). No I/O. These encode the DOCUMENTED mapping of the
// fixed 7-role system enum onto the reference's four permission levels, and the honest "not connected" gaps
// (open access requests, over-permissioned review) that have no schema source and must never be fabricated.
import { describe, it, expect } from 'vitest';
import { permissionLevelFor, permissionLevelDistribution, usersKpiCards, usersRoleHealth } from './super-admin-platform.repository';

describe('permissionLevelFor (documented role → level mapping)', () => {
  it('maps owners/super-admins to Full Access', () => {
    expect(permissionLevelFor('OWNER')).toBe('Full Access');
    expect(permissionLevelFor('SUPER_ADMIN')).toBe('Full Access');
  });
  it('maps manager → Branch Admin, technician → Limited, reception/front-desk → Basic', () => {
    expect(permissionLevelFor('MANAGER')).toBe('Branch Admin');
    expect(permissionLevelFor('TECHNICIAN')).toBe('Limited Access');
    expect(permissionLevelFor('RECEPTION')).toBe('Basic Access');
    expect(permissionLevelFor('FRONT_DESK')).toBe('Basic Access');
  });
  it('excludes customers / unknown roles (null, not an admin level)', () => {
    expect(permissionLevelFor('CUSTOMER')).toBeNull();
    expect(permissionLevelFor('WHATEVER')).toBeNull();
  });
});

describe('permissionLevelDistribution', () => {
  it('collapses role counts into the four fixed levels in order with correct percentages', () => {
    const d = permissionLevelDistribution([
      { role: 'OWNER', count: 10 }, { role: 'SUPER_ADMIN', count: 2 }, // Full = 12
      { role: 'MANAGER', count: 8 },                                   // Branch Admin = 8
      { role: 'TECHNICIAN', count: 60 },                               // Limited = 60
      { role: 'RECEPTION', count: 15 }, { role: 'FRONT_DESK', count: 5 }, // Basic = 20
      { role: 'CUSTOMER', count: 999 },                                // excluded
    ]);
    expect(d.map((x) => x.level)).toEqual(['Full Access', 'Branch Admin', 'Limited Access', 'Basic Access']);
    expect(d.map((x) => x.count)).toEqual([12, 8, 60, 20]);          // total = 100
    expect(d[2].pct).toBe(60); // 60/100
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(100);
  });
  it('is safe with no rows (zero counts, zero pct, no divide-by-zero)', () => {
    const d = permissionLevelDistribution([]);
    expect(d.every((x) => x.count === 0 && x.pct === 0)).toBe(true);
  });
});

describe('usersKpiCards', () => {
  const cards = usersKpiCards({ totalUsers: 3842, activeUsers: 3214, distinctRoles: 6, pendingInvites: 156, suspended: 92, branchManagers: 214, technicians: 1682, receptionists: 512, ownersAdmins: 186, openAccessRequests: 34 });
  it('returns exactly the reference 10 cards in order', () => {
    expect(cards).toHaveLength(10);
    expect(cards.map((c) => c.label)).toEqual([
      'Total Users', 'Active Users', 'Total Roles', 'Pending Invites', 'Suspended Users',
      'Branch Managers', 'Technicians', 'Receptionists', 'Owners / Admins', 'Open Access Requests',
    ]);
  });
  it('reports REAL distinct roles, not the fixture "28"', () => {
    expect(cards.find((c) => c.key === 'totalRoles')!.value).toBe(6);
  });
  it('Open Access Requests is now backed by access_requests (real count, available)', () => {
    const ar = cards.find((c) => c.key === 'openAccessRequests')!;
    expect(ar.available).toBe(true);
    expect(ar.value).toBe(34);
  });
});

describe('usersRoleHealth', () => {
  const rows = usersRoleHealth({ inactive30d: 112, expiredInvitations: 48, suspended: 92, accessRequestsPending: 34 });
  it('populates the real counts and routes each to a filtered directory', () => {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.inactive30d.count).toBe(112);
    expect(byKey.expiredInvitations.count).toBe(48);
    expect(byKey.suspended.count).toBe(92);
    expect(byKey.suspended.to).toContain('status=suspended');
  });
  it('Access Requests Pending is now backed by access_requests, but over-permissioned stays honestly unavailable', () => {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.overPermissioned.available).toBe(false);   // still needs an access-review process
    expect(byKey.overPermissioned.count).toBeNull();
    expect(byKey.accessRequestsPending.available).toBe(true);
    expect(byKey.accessRequestsPending.count).toBe(34);
  });
});
