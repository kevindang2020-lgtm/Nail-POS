import { describe, it, expect } from 'vitest';
import { PosTeamService } from './pos-team.service';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';

function fakeDb(rows: any[]) {
  const qb: any = { select: () => qb, where: () => qb, orderBy: () => qb, leftJoin: () => qb, execute: async () => rows };   // + the redesign's avatar joins
  return { selectFrom: () => qb } as any;
}

const ctx = { tenantId: 't1', userId: 'u2', role: 'OWNER' };

describe('PosTeamService.listTeam', () => {
  it('maps users, flags the current user, and summarizes roles from the RBAC catalog', async () => {
    const rows = [
      { id: 'u1', full_name: 'Sophia Nguyen', first_name: 'Sophia', last_name: 'Nguyen', email: 's@x.com', role: 'OWNER', status: 'active', branch_id: 'b1', last_login_at: '2026-05-06T14:21:00Z', mfa_enabled: true, created_at: '2024-01-12T00:00:00Z' },
      { id: 'u2', full_name: 'Mai Tran', first_name: 'Mai', last_name: 'Tran', email: 'm@x.com', role: 'MANAGER', status: 'active', branch_id: 'b1', last_login_at: null, mfa_enabled: false, created_at: '2024-03-01T00:00:00Z' },
      { id: 'u3', full_name: null, first_name: 'Dee', last_name: 'Park', email: 'd@x.com', role: 'TECHNICIAN', status: 'suspended', branch_id: 'b2', last_login_at: null, mfa_enabled: false, created_at: '2024-06-01T00:00:00Z' },
    ];
    const out = await new PosTeamService(fakeDb(rows)).listTeam(ctx);
    expect(out.users).toHaveLength(3);
    expect(out.users[0]).toMatchObject({ id: 'u1', name: 'Sophia Nguyen', role: 'OWNER', mfaEnabled: true, isYou: false });
    expect(out.users[1]).toMatchObject({ id: 'u2', role: 'MANAGER', isYou: true }); // ctx.userId
    expect(out.users[2].name).toBe('Dee Park'); // full_name null → first + last
    expect(out.summary).toMatchObject({ total: 3, active: 2, admins: 2 }); // owner + manager
    const owner = out.roles.find((r) => r.role === 'OWNER')!;
    expect(owner.permissionCount).toBe(ROLE_PERMISSIONS.OWNER.length);
    expect(owner.userCount).toBe(1);
  });

  it('fails soft to empty with no db or tenant', async () => {
    expect(await new PosTeamService(null as any).listTeam(ctx)).toMatchObject({ users: [], summary: { total: 0 } });
    expect(await new PosTeamService(fakeDb([])).listTeam({})).toMatchObject({ users: [] });
  });
});

describe('PosTeamService.getState', () => {
  it('fails soft to the full empty Team Management contract with no db or tenant', async () => {
    const s = await new PosTeamService(null as any).getState(ctx);
    expect(s.kpis).toMatchObject({ totalMembers: 0, activeToday: 0, onShiftNow: 0, avgPerformance: 0, totalServices: 0, totalCommissionCents: 0, pendingApprovals: 0, openPositions: 0 });
    expect(s.rows.pagination).toMatchObject({ page: 1, pageSize: 8, totalItems: 0, totalPages: 1 });
    expect(Array.isArray(s.tabs)).toBe(true);
    expect(s.training).toMatchObject({ certificationsExpiring: 0, trainingInProgress: 0, newTrainings: 0 });
    // birthdays/training have no staff store yet → honest empty/zero, never fabricated
    expect(s.birthdays).toEqual([]);
  });
});
