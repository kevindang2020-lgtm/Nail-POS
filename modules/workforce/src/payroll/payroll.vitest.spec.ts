import { AuditService, InMemoryAuditRepository } from '@aipowersalon/audit';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { describe, it, expect } from 'vitest';
import { InMemoryPayrollRepository } from './payroll.repository';
import { PayrollService, ValidationError, ForbiddenError, NotFoundError } from './payroll.service';
import {
  computeCommissionCents, computePayableCents, computeLine, rollupPeriodTotals, canTransitionPeriod, derivePayrollKpis, applyPeriodFilters, type PayrollPeriodRow, type PayrollLineRow,
} from './payroll.dto';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.payroll.view', 'pos.payroll.manage'] };
const ctxB = { tenantId: 't_B', branchId: 'b9', userId: 'u9', role: 'OWNER', permissions: ['pos.payroll.view', 'pos.payroll.manage'] };
const viewer = { tenantId: 't_A', branchId: 'b1', userId: 'u2', role: 'MANAGER', permissions: ['pos.payroll.view'] };
// Oct 13 2026 (FLOW duplicate D7 merged): the hand-typed "manual line" (gross × rate, keyed like the canonical line and
// silently replaced by PREPARE) is gone from the service and the API — off-POS work enters payroll as a ledger ADJUSTMENT.
// Specs seed lines straight into the repository (what PREPARE's canonical build would have written).
let lastRepo: InMemoryPayrollRepository;
const newSvc = (audit?: AuditService) => { lastRepo = new InMemoryPayrollRepository(); return new PayrollService(lastRepo, audit); };
const seedLine = (periodId: string, req: any) => lastRepo.upsertLine(ctx as any, periodId, req);

describe('payroll math (pure)', () => {
  it('commission: percent and flat, with clamping', () => {
    expect(computeCommissionCents({ grossSalesCents: 100000, commissionType: 'percent', commissionValue: 50, servicesCount: 8 })).toBe(50000);
    expect(computeCommissionCents({ grossSalesCents: 100000, commissionType: 'flat', commissionValue: 1500, servicesCount: 8 })).toBe(12000); // $15 × 8
    expect(computeCommissionCents({ grossSalesCents: 100000, commissionType: 'percent', commissionValue: 250, servicesCount: 1 })).toBe(100000); // clamped to 100%
  });
  it('payable = commission + tips + adjustment (adjustment may be negative; floors at 0)', () => {
    expect(computePayableCents({ commissionCents: 50000, tipsCents: 12000, adjustmentCents: -2000 })).toBe(60000);
    expect(computePayableCents({ commissionCents: 1000, tipsCents: 0, adjustmentCents: -5000 })).toBe(0);
  });
  it('computeLine + rollup + filters + lifecycle gates', () => {
    const c = computeLine({ technicianId: 't', grossSalesCents: 100000, commissionType: 'percent', commissionValue: 40, servicesCount: 5, tipsCents: 8000 });
    expect(c.commissionCents).toBe(40000);
    expect(c.payableCents).toBe(48000);
    const lines = [{ grossSalesCents: 100, commissionCents: 40, tipsCents: 8, payableCents: 48 } as PayrollLineRow, { grossSalesCents: 50, commissionCents: 20, tipsCents: 2, payableCents: 22 } as PayrollLineRow];
    expect(rollupPeriodTotals(lines).totalPayableCents).toBe(70);
    expect(canTransitionPeriod('draft', 'finalized')).toBe(true);
    expect(canTransitionPeriod('draft', 'paid')).toBe(false);
    expect(canTransitionPeriod('paid', 'finalized')).toBe(false);
    const periods = [{ status: 'draft', totalPayableCents: 1000 } as PayrollPeriodRow, { status: 'paid', totalPayableCents: 500 } as PayrollPeriodRow];
    const k = derivePayrollKpis(periods);
    expect(k.unpaidPayableCents).toBe(1000);
    expect(k.lifetimePayableCents).toBe(1500);
    expect(applyPeriodFilters(periods, { status: 'paid' })).toHaveLength(1);
  });
});

describe('PayrollService', () => {
  it('creates a period, adds lines that roll up totals, and validates dates', async () => {
    const svc = newSvc();
    await expect(svc.createPeriod(ctx as any, { periodStart: '2026-06-15', periodEnd: '2026-06-01' })).rejects.toBeInstanceOf(ValidationError);
    const p = await svc.createPeriod(ctx as any, { label: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    expect(p.status).toBe('draft');
    const d1 = (await seedLine(p.id, { technicianId: 'tech1', technicianName: 'Sam', grossSalesCents: 100000, commissionType: 'percent', commissionValue: 50, servicesCount: 8, tipsCents: 15000 }))!;
    expect(d1.line.commissionCents).toBe(50000);
    expect(d1.period.totalPayableCents).toBe(65000);
    // the canonical line for a technician is ONE row (re-prepare replaces, never duplicates)
    const d2 = (await seedLine(p.id, { technicianId: 'tech1', technicianName: 'Sam', grossSalesCents: 120000, commissionType: 'percent', commissionValue: 50, servicesCount: 9, tipsCents: 15000 }))!;
    expect((await svc.getPeriod(ctx as any, p.id)).lines).toHaveLength(1);
    expect(d2.period.totalCommissionCents).toBe(60000);
    // D7: no manual-line path on the service any more (the adjustment ledger is the way to add off-POS money)
    expect((svc as any).upsertLine).toBeUndefined();
    expect((svc as any).removeLine).toBeUndefined();
  });

  it('enforces lifecycle: finalize locks line edits; paid is terminal', async () => {
    const svc = newSvc();
    const p = await svc.createPeriod(ctx as any, { periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    await seedLine(p.id, { technicianId: 'tech1', grossSalesCents: 100000, commissionValue: 40, servicesCount: 5 });
    const fin = await svc.finalize(ctx as any, p.id);
    expect(fin.status).toBe('finalized');
    const paid = await svc.markPaid(ctx as any, p.id);
    expect(paid.status).toBe('paid');
    // paid is locked — Phase 12 (#27): a refused move is the standard 409 INVALID_STATE_TRANSITION (was a 400 ValidationError)
    await expect(svc.finalize(ctx as any, p.id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { machine: 'payroll_period', from: 'paid', to: 'finalized' } });
    await expect(svc.reopen(ctx as any, p.id)).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('isolates tenants and gates writes behind manage', async () => {
    const svc = newSvc();
    const a = await svc.createPeriod(ctx as any, { periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    await svc.createPeriod(ctxB as any, { periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    expect((await svc.getState(ctx as any, {})).periods).toHaveLength(1);
    await expect(svc.getPeriod(ctxB as any, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.createPeriod(viewer as any, { periodStart: '2026-06-01', periodEnd: '2026-06-15' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc.getPlatformState({})).periods).toHaveLength(2);
  });

  it('writes durable audit events (paid is high severity)', async () => {
    const audit = new AuditService(new InMemoryAuditRepository());
    const svc = newSvc(audit);
    const p = await svc.createPeriod(ctx as any, { periodStart: '2026-06-01', periodEnd: '2026-06-15' });
    await seedLine(p.id, { technicianId: 'tech1', grossSalesCents: 100000, commissionValue: 50, servicesCount: 5, tipsCents: 5000 });
    await svc.finalize(ctx as any, p.id);
    await svc.markPaid(ctx as any, p.id);
    const page = await audit.list('t_A', {});
    expect(page.items.some((r) => r.module === 'payroll' && r.action === 'period.created')).toBe(true);
    const paidEvent = page.items.find((r) => r.action === 'period.paid');
    expect(paidEvent?.severity).toBe('high');
    expect((await audit.list('t_B', {})).pagination.totalItems).toBe(0);
  });
});
