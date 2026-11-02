import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerPayrollList } from './owner.dto';

// Owner Approval Center aggregates pending owner actions: payroll periods awaiting approval (draft) or lock (finalized),
// gated by finance permission, plus an open-alert count gated by alerts permission. These tests cover the gate, the
// payroll composition + status mapping, the per-permission degradation, and the alert count.
const ctx = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: perms } as any);

const period = (id: string, status: string, payable: number) => ({ periodId: id, branchId: null, label: `Period ${id}`, periodStart: '2026-05-01', periodEnd: '2026-05-15', status, finalizedAt: null, paidAt: null, totalPayableCents: payable, totalCommissionCents: 0, totalTipsCents: 0 });
const payrollList: OwnerPayrollList = {
  kpis: { totalPeriods: 4, openPeriods: 3, unpaidPayableCents: 0, latestPeriodPayableCents: 0, lifetimeCommissionCents: 0, lifetimeTipsCents: 0 } as any,
  periods: [period('p1', 'draft', 100000), period('p2', 'finalized', 500000), period('p3', 'paid', 200000), period('p4', 'draft', 300000)],
};

class FakeRepo extends InMemoryOwnerRepository {
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async ownerPayrollList() { return payrollList; }
  async alertCounts() { return { total: 9, unread: 5, bySeverity: {}, byStatus: {} }; }
}

describe('Owner Approval Center — aggregated pending actions', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.approvals(ctx(['owner.settings.view']))).rejects.toThrow(/permission/i);
  });

  it('composes payroll approvals (draft) and locks (finalized), excluding paid periods', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.approvals(ctx(['owner.dashboard.view', 'owner.finance.view', 'owner.alerts.view']));
    expect(out.counts.payrollToApprove).toBe(2); // p1, p4
    expect(out.counts.payrollToLock).toBe(1);    // p2
    expect(out.items.find((i) => i.periodId === 'p3')).toBeUndefined(); // paid excluded
    expect(out.items.every((i) => i.kind === 'payroll')).toBe(true);
  });

  it('orders approvals before locks, larger payouts first', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.approvals(ctx(['owner.dashboard.view', 'owner.finance.view']));
    expect(out.items.map((i) => i.periodId)).toEqual(['p4', 'p1', 'p2']); // approve(300k), approve(100k), lock(500k)
  });

  it('omits payroll items for a user without finance permission', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.approvals(ctx(['owner.dashboard.view']));
    expect(out.items).toHaveLength(0);
    expect(out.counts.payrollToApprove).toBe(0);
  });

  it('includes the open-alert count only for an alerts-permitted user', async () => {
    const svc = new OwnerService(new FakeRepo());
    const withAlerts = await svc.approvals(ctx(['owner.dashboard.view', 'owner.alerts.view']));
    expect(withAlerts.counts.openAlerts).toBe(5);
    const without = await svc.approvals(ctx(['owner.dashboard.view']));
    expect(without.counts.openAlerts).toBe(0);
  });
});
