// ai-business-branch-staffing.pgtest — AI Business Assistant 09 (round 10): staffed hours per branch from recorded shifts on the
// REAL schema, and the per-staffed-hour figures on the branch comparison (N/A with no staffed time — never a fake 0).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBranchStaffing, perStaffHour } from './ai-business-branch-staffing';
import { AiBusinessBranchesService } from './ai-business-branches.service';

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B1 = id(2), B2 = id(3), U = id(9), TE1 = id(20), TE2 = id(21), TE3 = id(22);
let pg: any; let db: any;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Lux','st-910','ST910','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Big','active','UTC'), ($2,$3,'Small','active','UTC')`, [B1, B2, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$4,$5,'A','A','A A'), ($2,$4,$5,'B','B','B B'), ($3,$4,$6,'C','C','C C')`, [TE1, TE2, TE3, T, B1, B2]);
  const sh = (b: string, te: string, day: string, start: string | null, end: string | null) => q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date,$5,$6,'closed')`, [T, b, te, day, start, end]);
  await sh(B1, TE1, '2026-11-02', '2026-11-02T09:00:00Z', '2026-11-02T17:00:00Z');   // 8 h
  await sh(B1, TE2, '2026-11-02', '2026-11-02T10:00:00Z', '2026-11-02T14:00:00Z');   // 4 h
  await sh(B1, TE2, '2026-11-03', '2026-11-03T10:00:00Z', null);                      // still open: counted apart, not as hours
  await sh(B1, TE1, '2026-10-30', '2026-10-30T09:00:00Z', '2026-10-30T17:00:00Z');   // outside the range
  await sh(B2, TE3, '2026-11-02', '2026-11-02T09:00:00Z', '2026-11-02T13:00:00Z');   // 4 h
}, 180_000);

describe('AI Business Assistant 09 — staffing normalisation', () => {
  it('BS-01 staffed minutes, technicians and open shifts per branch on the branch’s salon days; per staffed hour is N/A without time', async () => {
    const st = await new KyselyBranchStaffing(db).staffing(T, [B1, B2], { preset: 'custom', from: '2026-11-01', to: '2026-11-06' });
    expect(st[B1]).toEqual({ technicianCount: 2, staffMinutes: 720, openShifts: 1 });
    expect(st[B2]).toEqual({ technicianCount: 1, staffMinutes: 240, openShifts: 0 });
    expect(perStaffHour(120000, 720)).toBe(10000);
    expect(perStaffHour(120000, 0)).toBeNull();
    expect(perStaffHour(null, 720)).toBeNull();
  });
  it('BS-02 the comparison carries per-staffed-hour figures so the bigger branch is not better just for being bigger', async () => {
    const reports = {
      getBooking: async (c: any) => ({ totalBookings: c.branchId === B1 ? 30 : 10, completed: c.branchId === B1 ? 24 : 8, cancelledPercent: 0, noShowPercent: 0 }),
      getSales: async (c: any) => ({ kpis: { netSalesCents: c.branchId === B1 ? 120000 : 40000, ticketsCount: c.branchId === B1 ? 24 : 8 } }),
    } as any;
    const scope = { listAuthorizedBranches: async () => [{ branchId: B1, branchName: 'Big', status: 'active' }, { branchId: B2, branchName: 'Small', status: 'active' }] } as any;
    const svc = new AiBusinessBranchesService(reports, scope, new KyselyBranchStaffing(db));
    const r: any = await svc.compareBranches({ tenantId: T, userId: U, role: 'OWNER', permissions: ['pos.reports.financial_view'] } as any, { from: '2026-11-01', to: '2026-11-06' });
    const big = r.branches.find((b: any) => b.branchId === B1), small = r.branches.find((b: any) => b.branchId === B2);
    expect(big.staffing).toEqual({ technicianCount: 2, staffMinutes: 720, openShifts: 1, netSalesPerStaffHourCents: 10000, completedPer10StaffHours: 20 });
    expect(small.staffing).toEqual({ technicianCount: 1, staffMinutes: 240, openShifts: 0, netSalesPerStaffHourCents: 10000, completedPer10StaffHours: 20 });
    // without a staffing source the rows carry no staffing block (nothing invented)
    const plain: any = await new AiBusinessBranchesService(reports, scope).compareBranches({ tenantId: T, userId: U, role: 'OWNER', permissions: [] } as any, { from: '2026-11-01', to: '2026-11-06' });
    expect(plain.branches[0].staffing).toBeUndefined();
  });
});
