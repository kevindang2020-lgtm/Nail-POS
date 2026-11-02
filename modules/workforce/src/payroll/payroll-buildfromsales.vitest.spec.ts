// payroll-buildfromsales.vitest.spec.ts — §20 auto-build a period from sales via the canonical (no-recompute) path.
import { describe, it, expect } from 'vitest';
import { InMemoryPayrollRepository } from './payroll.repository';
import { PayrollService, ValidationError } from './payroll.service';
import type { AutoBuildPorts } from '../compensation/compensation-payroll-autobuild';
import { DEFAULT_INCLUSIONS, type GuaranteePolicy } from '../compensation/compensation-guarantee';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.payroll.view', 'pos.payroll.manage'] } as any;
const weekly: GuaranteePolicy = { period: 'week', guaranteedCents: 100000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };

const ports: AutoBuildPorts = {
  technicianSums: async () => [
    { technicianId: 'a', branchId: 'b1', sums: { techServiceEarningsCents: 87000, cardTipCents: 32500, cashTipCents: 0, retailCommissionCents: 0, grossServiceCents: 145000, tickets: 40 } },
    { technicianId: 'b', branchId: 'b1', sums: { techServiceEarningsCents: 120000, cardTipCents: 10000, cashTipCents: 0, retailCommissionCents: 2000, grossServiceCents: 200000, tickets: 55 } },
  ],
  resolveGuarantee: async (_t, tech) => (tech === 'a' ? weekly : null),
  netAdjustments: async (_t, tech) => (tech === 'b' ? -5000 : 0),
};

describe('payroll buildFromSales (§20)', () => {
  it('derives + persists canonical lines from sales; period totals roll up; no recomputation', async () => {
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo, undefined, ports);
    const period = await repo.createPeriod(ctx, { label: 'wk', periodStart: '2026-06-20', periodEnd: '2026-06-26' } as any);
    const detail = await svc.buildFromSales(ctx, period.id);
    const a = detail.lines.find((l) => l.technicianId === 'a')!;
    const b = detail.lines.find((l) => l.technicianId === 'b')!;
    expect(a.payableCents).toBe(132500);   // 870 + 130 top-up + 325 tips
    expect(b.payableCents).toBe(127000);   // 1200 service + 20 retail + 100 tips - 50 adj
    expect(a.commissionCents).toBe(87000); // canonical service commission, NOT recomputed from gross×value
    // period total payable = sum of lines
    expect(detail.period.totalPayableCents).toBe(259500);
  });

  it('rejects build on a non-draft period', async () => {
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo, undefined, ports);
    const period = await repo.createPeriod(ctx, { label: 'wk', periodStart: '2026-06-20', periodEnd: '2026-06-26' } as any);
    await repo.setStatus(ctx, period.id, 'finalized');
    await expect(svc.buildFromSales(ctx, period.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('errors clearly when no sales source is connected', async () => {
    const repo = new InMemoryPayrollRepository();
    const svc = new PayrollService(repo); // no autoBuild port
    const period = await repo.createPeriod(ctx, { label: 'wk', periodStart: '2026-06-20', periodEnd: '2026-06-26' } as any);
    await expect(svc.buildFromSales(ctx, period.id)).rejects.toBeInstanceOf(ValidationError);
  });
});
