import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';

// Service-level tests for the owner's computed KPIs — the figures an owner reads first and trusts: net profit and the
// revenue/profit trends (getFinanceSummary), technician ranking + utilization (getStaffPerformance), per-branch ranking
// + growth (getBranchPerformance / getComparison), and expense roll-ups (getExpenseSummary). These compute in the
// service from repo inputs, so they're exercised here against in-memory fakes (the raw SQL behind the inputs is verified
// on live Postgres). Each method's permission gate is asserted alongside the math.
const ctx = (perms: string[], role = 'OWNER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

// ───────────────────────── getFinanceSummary ─────────────────────────
class FinanceRepo extends InMemoryOwnerRepository {
  ri = 0; si = 0; ei = 0; allowed: string[] | null = null;
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return this.allowed ? this.allowed[0] : null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async paidRevenueCents() { return [120000, 100000][this.ri++]; }            // cur, prev
  async paidTicketCount() { return 40; }
  async paidSalesCents() { return 100000; }   // sales (service + retail lines) — revenue above also carries tax, tips, gift cards
  async tipsCents() { return 5000; }
  async taxAndDiscountCents() { return { taxCents: 8000, discountCents: 2000 }; }
  async staffSales() { return [[{ technicianId: 't1', servicesCompleted: 0, salesCents: 0, commissionCents: 30000, busyMinutes: 0 }], [{ technicianId: 't1', servicesCompleted: 0, salesCents: 0, commissionCents: 25000, busyMinutes: 0 }]][this.si++]; }
  async expensesTotalCents() { return [20000, 15000][this.ei++]; }            // cur, prev
}

describe('getFinanceSummary — net profit and trends', () => {
  it('computes net profit = revenue − commission − expenses, with trends and average ticket', async () => {
    const out = await new OwnerService(new FinanceRepo()).getFinanceSummary(ctx(['owner.finance.view']), 'month');
    expect(out.totalRevenueCents).toBe(120000);
    expect(out.totalCommissionCents).toBe(30000);
    expect(out.totalExpensesCents).toBe(20000);
    expect(out.netProfitCents).toBe(70000);            // 120000 − 30000 − 20000
    expect(out.revenueTrendPercent).toBe(20);          // (120000−100000)/100000
    expect(out.profitTrendPercent).toBe(16.7);         // (70000−60000)/60000 → 16.7
    expect(out.averageTicketCents).toBe(2500);         // SALES ÷ paid tickets = 100000 / 40 — the POS reports' definition (wave 4 pilot)
    expect(out.totalTransactions).toBe(40);
    expect(out.taxCollectedCents).toBe(8000);
    expect(out.tipsCents).toBe(5000);
    expect(out.discountsCents).toBe(2000);
    // Receipt/Expense §94: approved expenses ÷ sales (not ÷ revenue, which carries tax / tips / gift cards) = 20000 / 100000
    expect(out.salesCents).toBe(100000);
    expect(out.expenseToSalesPct).toBe(20);
    expect(out.expenseRatioBasis).toMatch(/Approved expenses ÷ sales/);
  });

  it('requires owner.finance.view', async () => {
    await expect(new OwnerService(new FinanceRepo()).getFinanceSummary(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });

  it('rejects a branch outside a restricted manager’s assigned set', async () => {
    const repo = new FinanceRepo(); repo.allowed = ['b1'];
    await expect(new OwnerService(repo).getFinanceSummary(ctx(['owner.finance.view'], 'MANAGER'), 'month', 'b2')).rejects.toThrow();
  });
});

// ───────────────────────── getStaffPerformance ─────────────────────────
class StaffRepo extends InMemoryOwnerRepository {
  si = 0; sch = 0;
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async listTechnicians() { return [{ technicianId: 't1', fullName: 'Ann', status: 'active', isActive: true }, { technicianId: 't2', fullName: 'Bo', status: 'active', isActive: true }]; }
  async staffSales() {
    return [
      [{ technicianId: 't1', servicesCompleted: 10, salesCents: 50000, commissionCents: 20000, busyMinutes: 300 }, { technicianId: 't2', servicesCompleted: 5, salesCents: 80000, commissionCents: 30000, busyMinutes: 200 }], // cur
      [{ technicianId: 't1', servicesCompleted: 0, salesCents: 0, commissionCents: 0, busyMinutes: 400 }], // prev
    ][this.si++];
  }
  async ratingsByTechnician() { return [{ technicianId: 't1', rating: 4.5, reviewCount: 12 }, { technicianId: 't2', rating: 4.8, reviewCount: 9 }]; }
  async scheduledMinutesByTechnician() { return [[{ technicianId: 't1', minutes: 480 }, { technicianId: 't2', minutes: 480 }], [{ technicianId: 't1', minutes: 600 }, { technicianId: 't2', minutes: 600 }]][this.sch++]; }
  async activeTechnicianCount() { return { active: 2, scheduled: 2 }; }
}

describe('getStaffPerformance — ranking and utilization', () => {
  it('ranks technicians by sales and computes utilization with its trend', async () => {
    const out = await new OwnerService(new StaffRepo()).getStaffPerformance(ctx(['owner.staff.performance.view']), 'month');
    expect(out.topTechnicians.map((t) => t.technicianId)).toEqual(['t2', 't1']); // 80000 > 50000
    expect(out.topTechnicians[0].rating).toBe(4.8);
    expect(out.utilizationPercent).toBe(52);          // (300+200)/960
    expect(out.utilizationTrendPercent).toBe(57.6);   // 52 vs 33 (400/1200)
    expect(out.totalStaff).toBe(2);
    expect(out.onDutyCount).toBe(2);
    expect(out.totalCommissionCents).toBe(50000);     // 20000 + 30000
  });

  it('requires owner.staff.performance.view', async () => {
    await expect(new OwnerService(new StaffRepo()).getStaffPerformance(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });
});

// ───────────────────────── getBranchPerformance / getComparison ─────────────────────────
class BranchRepo extends InMemoryOwnerRepository {
  rb = 0;
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async listBranches() { return [{ branchId: 'b1', branchName: 'Main', status: 'active', city: null }, { branchId: 'b2', branchName: 'West', status: 'active', city: null }]; }
  async revenueByBranch() { return [[{ branchId: 'b1', revenueCents: 200000, ticketCount: 50, salesCents: 175000 }, { branchId: 'b2', revenueCents: 300000, ticketCount: 60, salesCents: 270000 }], [{ branchId: 'b1', revenueCents: 150000, ticketCount: 40 }, { branchId: 'b2', revenueCents: 250000, ticketCount: 50 }]][this.rb++]; }
  async bookingsByBranch() { return [{ branchId: 'b1', bookingCount: 40 }, { branchId: 'b2', bookingCount: 55 }]; }
}

describe('getBranchPerformance — ranking and growth', () => {
  it('ranks branches by revenue and derives totals, trends, and the quick comparison', async () => {
    const out = await new OwnerService(new BranchRepo()).getBranchPerformance(ctx(['owner.branches.view']), 'month');
    expect(out.branches.map((b) => b.branchId)).toEqual(['b2', 'b1']);   // 300000 > 200000
    expect(out.branches[0].rank).toBe(1);
    expect(out.branches.find((b) => b.branchId === 'b1')!.trendPercent).toBe(33.3); // 200k vs 150k
    expect(out.branches.find((b) => b.branchId === 'b1')!.averageTicketCents).toBe(3500); // SALES 175000 / 50 tickets (POS definition, wave 4 pilot)
    expect(out.totalRevenueCents).toBe(500000);
    expect(out.totalRevenueTrendPercent).toBe(25);     // 500k vs 400k
    expect(out.quickComparison.bestGrowth!.branchId).toBe('b1');         // 33.3 > 20
    expect(out.quickComparison.highestAverageTicket!.branchId).toBe('b2'); // 4500 > 3500
    expect(out.totalBranches).toBe(2);
  });

  it('batch 9 guide 16 (Nov 10 2026): a branch with no prior revenue has NO trend (null) and never wins "best growth"', async () => {
    class NewBranchRepo extends BranchRepo {
      async listBranches() { return [...(await super.listBranches()), { branchId: 'b3', branchName: 'New', status: 'active', city: null }]; }
      async revenueByBranch() { this.rb++; return this.rb % 2 === 1
        ? [{ branchId: 'b1', revenueCents: 200000, ticketCount: 50, salesCents: 175000 }, { branchId: 'b3', revenueCents: 90000, ticketCount: 20, salesCents: 80000 }]
        : [{ branchId: 'b1', revenueCents: 150000, ticketCount: 40, salesCents: 140000 }]; }
    }
    const out = await new OwnerService(new NewBranchRepo()).getBranchPerformance(ctx(['owner.branches.view']), 'month');
    expect(out.branches.find((b) => b.branchId === 'b3')!.trendPercent).toBeNull();      // was +100%
    expect(out.branches.find((b) => b.branchId === 'b2')!.trendPercent).toBeNull();      // nothing now, nothing before
    expect(out.quickComparison.bestGrowth!.branchId).toBe('b1');
    expect(out.quickComparison.topBookings!.branchId).toBe('b2');
  });

  it('getComparison delegates to the same computation', async () => {
    const out = await new OwnerService(new BranchRepo()).getComparison(ctx(['owner.branches.view']), 'month');
    expect(out.totalRevenueCents).toBe(500000);
  });

  it('requires owner.branches.view', async () => {
    await expect(new OwnerService(new BranchRepo()).getBranchPerformance(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });
});

// ───────────────────────── getExpenseSummary ─────────────────────────
class ExpenseRepo extends InMemoryOwnerRepository {
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async expensesByCategory() { return [{ category: 'rent', amountCents: 100000, count: 1 }, { category: 'supplies', amountCents: 50000, count: 3 }]; }
  async expensesTotalCents() { return 150000; }
}

// Oct 21 2026 (finance mandate): the summary is the finance module's report (approved expenses only), seen through the
// OwnerExpensesPort the app binds — the Owner App and the P&L read ONE number.
function withFinance(svc: OwnerService, calls: unknown[] = []) {
  svc.expenses = {
    report: async (_c, q) => { calls.push(q); return { window: { from: '2026-10-01', to: '2026-10-31' }, totalCents: 150000, count: 4,
      byCategory: [{ key: 'rent', totalCents: 100000, count: 1 }, { key: 'supplies', totalCents: 50000, count: 3 }, { key: 'other', totalCents: 0, count: 0 }] }; },
  } as unknown as NonNullable<OwnerService['expenses']>;
  return svc;
}
describe('getExpenseSummary — roll-up', () => {
  it('totals expenses and counts line items across categories', async () => {
    const calls: unknown[] = [];
    const out = await withFinance(new OwnerService(new ExpenseRepo()), calls).getExpenseSummary(ctx(['owner.expenses.view']), 'month');
    expect(out.totalCents).toBe(150000);
    expect(out.count).toBe(4);                         // 1 + 3
    expect(out.byCategory).toHaveLength(2);           // a $0 category is not listed
    expect(out.byCategory[0]).toEqual({ category: 'rent', amountCents: 100000, count: 1 });
    expect(calls[0]).toMatchObject({ period: 'month' });
  });
  it('with no finance module bound it refuses instead of inventing a total', async () => {
    await expect(new OwnerService(new ExpenseRepo()).getExpenseSummary(ctx(['owner.expenses.view']), 'month')).rejects.toThrow(/not available/i);
  });

  it('requires owner.expenses.view', async () => {
    await expect(new OwnerService(new ExpenseRepo()).getExpenseSummary(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });
});

// ───────────────────────── average ticket = POS definition (wave 4 pilot P3) ─────────────────────────
class DashRepo extends InMemoryOwnerRepository {
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async paidRevenueCents() { return 50000; }        // collected: sales + tax + tips + gift cards sold
  async paidSalesCents() { return 40000; }          // sales
  async paidTicketCount() { return 10; }
}
describe('Owner average ticket = sales ÷ paid tickets (the POS reports\' definition)', () => {
  it('the dashboard divides sales, not everything collected', async () => {
    const out = await new OwnerService(new DashRepo()).getDashboard(ctx(['owner.dashboard.view']));
    expect(out.averageTicketCents).toBe(4000);
  });
});

describe('customRange (Nov 10 2026)', () => {
  it('inclusive salon days, compared with the same length just before; invalid → null', async () => {
    const { customRange } = await import('./owner.dto');
    const r = customRange('2026-10-01', '2026-10-31', 'America/New_York')!;
    expect([r.from.fromDate, r.from.toDate, r.prev.fromDate, r.prev.toDate]).toEqual(['2026-10-01', '2026-10-31', '2026-08-31', '2026-09-30']);
    expect(customRange('2026-11-05', '2026-11-01')).toBeNull();
    expect(customRange('2024-01-01', '2026-01-01')).toBeNull();
  });
});
