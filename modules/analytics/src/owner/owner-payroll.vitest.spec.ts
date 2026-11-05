import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerPayrollList, OwnerPayrollPeriodDetail } from './owner.dto';

// Owner Commission & Payroll is read-only and gated by 'owner.finance.view'. Branch scoping is enforced in the repo
// (bScope over the owner's allowed branches); the service gates the permission and resolves the period, returning
// not_found for an unknown/foreign period. The numbers are the engine's stored payroll_periods/payroll_lines values.
const withPerm = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u_owner', role: 'OWNER', permissions: perms } as any);

const list: OwnerPayrollList = {
  periods: [
    { periodId: 'p2', branchId: null, label: 'May 12 – May 18', periodStart: '2026-05-12', periodEnd: '2026-05-18', status: 'finalized', finalizedAt: '2026-05-19T00:00:00.000Z', paidAt: null, totalPayableCents: 2468000, totalCommissionCents: 1842000, totalTipsCents: 325000 },
    { periodId: 'p1', branchId: null, label: 'May 5 – May 11', periodStart: '2026-05-05', periodEnd: '2026-05-11', status: 'paid', finalizedAt: '2026-05-12T00:00:00.000Z', paidAt: '2026-05-13T00:00:00.000Z', totalPayableCents: 2310000, totalCommissionCents: 1700000, totalTipsCents: 300000 },
  ],
  kpis: { totalPeriods: 2, openPeriods: 1, unpaidPayableCents: 2468000, latestPeriodPayableCents: 2468000, lifetimeCommissionCents: 3542000, lifetimeTipsCents: 625000 },
};
const detail: OwnerPayrollPeriodDetail = {
  period: list.periods[0],
  totals: { grossSalesCents: 5000000, commissionCents: 1842000, retailCommissionCents: 120000, cardTipCents: 200000, cashTipCents: 125000, tipsCents: 325000, guaranteeTopupCents: 480000, adjustmentCents: 0, payableCents: 2468000, technicianCount: 1 },
  lines: [{ technicianId: 'te1', technicianName: 'Emily R.', servicesCount: 48, grossSalesCents: 312000, commissionType: 'percent', commissionValue: 40, commissionCents: 124800, retailCommissionCents: 4000, cardTipCents: 9000, cashTipCents: 3000, tipsCents: 12000, guaranteeTopupCents: 0, adjustmentCents: 0, payableCents: 125000 }],
};

class FakeRepo extends InMemoryOwnerRepository {
  constructor(private allowed: string[] | null, private hasPeriod = true) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async ownerPayrollList() { return list; }
  async ownerPayrollPeriod(_ctx: OwnerContext, periodId: string) { return this.hasPeriod && periodId === 'p2' ? detail : null; }
}

describe('Owner Commission & Payroll — read-only, finance-gated, branch-scoped', () => {
  it('blocks an owner-app user without owner.finance.view', async () => {
    const svc = new OwnerService(new FakeRepo(null));
    await expect(svc.payrollList(withPerm(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });

  it('returns periods + KPIs for a finance-permitted owner', async () => {
    const svc = new OwnerService(new FakeRepo(null));
    const out = await svc.payrollList(withPerm(['owner.finance.view']));
    expect(out.periods).toHaveLength(2);
    expect(out.kpis.openPeriods).toBe(1);
    expect(out.kpis.latestPeriodPayableCents).toBe(2468000);
    expect(out.periods[0].status).toBe('finalized');
  });

  it('returns a period payout preview with the per-tech breakdown', async () => {
    const svc = new OwnerService(new FakeRepo(null));
    const out = await svc.payrollPeriod(withPerm(['owner.finance.view']), 'p2');
    expect(out.totals.tipsCents).toBe(325000);
    expect(out.totals.guaranteeTopupCents).toBe(480000);
    expect(out.lines[0].technicianName).toBe('Emily R.');
    expect(out.lines[0].commissionCents).toBe(124800);
  });

  it('returns not_found for an unknown or out-of-scope period', async () => {
    const svc = new OwnerService(new FakeRepo(null));
    await expect(svc.payrollPeriod(withPerm(['owner.finance.view']), 'nope')).rejects.toThrow(/not found/i);
  });
});
