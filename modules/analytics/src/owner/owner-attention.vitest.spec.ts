import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerPayrollList, OwnerInventoryOverview } from './owner.dto';

// Owner "Needs Attention" strip: a lightweight cross-module aggregate gated by 'owner.dashboard.view'. Payroll counts are
// finance-gated, alerts are alerts-gated, low/out-of-stock reuse the inventory status. These tests cover the gate, the
// composition, the per-permission degradation, and the branch-scope guard.
const ctx = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: perms } as any);

const payroll: OwnerPayrollList = {
  kpis: {} as any,
  periods: [
    { periodId: 'p1', branchId: null, label: 'P1', periodStart: '', periodEnd: '', status: 'draft', finalizedAt: null, paidAt: null, totalPayableCents: 0, totalCommissionCents: 0, totalTipsCents: 0 },
    { periodId: 'p2', branchId: null, label: 'P2', periodStart: '', periodEnd: '', status: 'finalized', finalizedAt: null, paidAt: null, totalPayableCents: 0, totalCommissionCents: 0, totalTipsCents: 0 },
    { periodId: 'p3', branchId: null, label: 'P3', periodStart: '', periodEnd: '', status: 'paid', finalizedAt: null, paidAt: null, totalPayableCents: 0, totalCommissionCents: 0, totalTipsCents: 0 },
  ],
};
const inv = (): OwnerInventoryOverview => ({ totalProducts: 0, stockPositions: 0, statusCounts: { inStock: 100, low: 8, critical: 3, outOfStock: 5, overstock: 0 }, needsReorderCount: 16, stockValueCents: 0, retailValueCents: 0, brandsCount: 0, vendorsCount: 0, categoriesCount: 0, topCategories: [], reorderList: [], generatedAt: '' });

class FakeRepo extends InMemoryOwnerRepository {
  invBranchIds: string[] | null | undefined;
  constructor(private allowed: string[] | null = null) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return null; }
  async ownerPayrollList() { return payroll; }
  async ownerInventoryOverview(_ctx: OwnerContext, branchIds: string[] | null) { this.invBranchIds = branchIds; return inv(); }
  async alertCounts() { return { total: 9, unread: 4, bySeverity: {}, byStatus: {} }; }
}

describe('Owner Needs Attention — cross-module aggregate', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.attention(ctx(['owner.settings.view']))).rejects.toThrow(/permission/i);
  });

  it('composes payroll, inventory, and alert signals for a fully-permitted owner', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.attention(ctx(['owner.dashboard.view', 'owner.finance.view', 'owner.alerts.view']));
    expect(out.payrollToApprove).toBe(1); // p1 draft
    expect(out.payrollToLock).toBe(1);    // p2 finalized
    expect(out.lowStock).toBe(11);        // low(8)+critical(3)
    expect(out.outOfStock).toBe(5);
    expect(out.openAlerts).toBe(4);
  });

  it('zeroes payroll for non-finance and alerts for non-alerts users (inventory still shown)', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.attention(ctx(['owner.dashboard.view']));
    expect(out.payrollToApprove).toBe(0);
    expect(out.payrollToLock).toBe(0);
    expect(out.openAlerts).toBe(0);
    expect(out.lowStock).toBe(11); // operational, always shown
  });

  it('forbids a branch outside the owner’s allowed set', async () => {
    const svc = new OwnerService(new FakeRepo(['b1']));
    await expect(svc.attention(ctx(['owner.dashboard.view']), 'b2')).rejects.toThrow(/assigned branch/i);
  });

  it('passes the resolved branch scope to inventory (null for a full owner)', async () => {
    const repo = new FakeRepo(null);
    const svc = new OwnerService(repo);
    await svc.attention(ctx(['owner.dashboard.view']));
    expect(repo.invBranchIds).toBeNull();
  });
});
