// technicians-pay-projection.vitest.spec.ts — workforce audit P0 #2/#13.
//   • PATCH /pos/technicians/:id never writes commission (stripped in the service; audited; the repo backstop too).
//   • Front desk / reception (technicians.view, no technicians.view_pay) get no commission %, no commission history,
//     no payroll summary, and the roster/detail/KPI figures for tips & commission are projected to 0.
import { describe, it, expect } from 'vitest';
import { InMemoryTechniciansRepository, type TechniciansContext } from './technicians.repository';
import { TechniciansService, ForbiddenError } from './technicians.service';
import { stripCommissionFromUpdate, projectTechnicianPay, projectTechniciansStatePay } from './technicians-pay-projection';
import { permissionsFor, hasPermission } from '@aipowersalon/permissions';

const base = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1' };
const frontDesk = (): TechniciansContext => ({ ...base, role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] });
const manager = (): TechniciansContext => ({ ...base, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] });
const owner = (): TechniciansContext => ({ ...base, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });

describe('technicians.view_pay — who holds it', () => {
  it('OWNER + MANAGER yes; FRONT_DESK / RECEPTION / TECHNICIAN no', () => {
    expect(hasPermission(owner() as any, 'technicians.view_pay')).toBe(true);
    expect(hasPermission(manager() as any, 'technicians.view_pay')).toBe(true);
    expect(hasPermission(frontDesk() as any, 'technicians.view_pay')).toBe(false);
    expect(hasPermission({ ...base, role: 'RECEPTION', permissions: permissionsFor('RECEPTION') } as any, 'technicians.view_pay')).toBe(false);
    expect(hasPermission({ ...base, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') } as any, 'technicians.view_pay')).toBe(false);
    // and the roster read alone is NOT enough — pos.technicians.view still resolves to technicians.view, not view_pay
    expect(hasPermission(frontDesk() as any, 'pos.technicians.view')).toBe(true);
  });
});

describe('PATCH never writes commission', () => {
  it('stripCommissionFromUpdate removes every pay key and reports the attempt', () => {
    const out = stripCommissionFromUpdate({ fullName: 'Mia Chen', commissionSplitPercent: 95, default_commission_split_percent: 95, commission_value: 95 } as any);
    expect(out.commissionSplitPercent).toBe(95);
    expect('default_commission_split_percent' in out).toBe(false);
    expect('commission_value' in out).toBe(false);
    expect((out as any).fullName).toBe('Mia Chen');
    expect(stripCommissionFromUpdate({ fullName: 'x' }).commissionSplitPercent).toBeUndefined();
  });
  it('service.update with commissionSplitPercent leaves the commission unchanged and audits the stripped attempt', async () => {
    const repo = new InMemoryTechniciansRepository();
    const svc = new TechniciansService(repo);
    const before = (await svc.getCommission(owner(), 't_mia')).defaultPercent;
    const row = await svc.update(owner(), 't_mia', { fullName: 'Mia Chen', commissionSplitPercent: 95 } as any);
    expect(row.displayName).toBe('Mia Chen');
    expect((await svc.getCommission(owner(), 't_mia')).defaultPercent).toBe(before);
    expect((await repo.getCommission(owner(), 't_mia'))!.defaultPercent).toBe(before);
    const stripped = svc.auditLog().filter((a) => a.actionType === 'pos_technician_commission_edit_stripped');
    expect(stripped.length).toBe(1);
    expect(stripped[0].metadata).toMatchObject({ attempted: 95 });
  });
  it('setCommission (the admin-code path) still changes it', async () => {
    const svc = new TechniciansService(new InMemoryTechniciansRepository());
    await svc.setCommission(owner(), 't_mia', { defaultPercent: 42, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' });
    expect((await svc.getCommission(owner(), 't_mia')).defaultPercent).toBe(42);
  });
});

describe('front desk cannot read pay', () => {
  it('commission / commission history / salon commission / payroll summary are 403 for technicians.view alone', async () => {
    const svc = new TechniciansService(new InMemoryTechniciansRepository());
    await expect(svc.getCommission(frontDesk(), 't_mia')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.getCommissionHistory(frontDesk(), 't_mia')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.getSalonCommission(frontDesk())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.payrollSummary(frontDesk(), 't_mia')).rejects.toBeInstanceOf(ForbiddenError);
    // a manager still can
    expect((await svc.getCommission(manager(), 't_mia')).defaultPercent).toBeGreaterThanOrEqual(0);
    expect((await svc.payrollSummary(manager(), 't_mia')).periodLabel).toBeTruthy();
  });
  it('detail / state / list are projected: no commission %, no payroll figures, tips & commission = 0', async () => {
    const svc = new TechniciansService(new InMemoryTechniciansRepository());
    const full = await svc.detail(manager(), 't_mia');
    const fd = await svc.detail(frontDesk(), 't_mia');
    expect(fd.technicianId).toBe(full.technicianId);
    expect(fd.schedule).toEqual(full.schedule);                // roster data intact
    expect(fd.commission.defaultPercent).toBe(0);
    expect((fd.commission as any).redacted).toBe(true);
    expect(fd.payroll.commissionCents).toBe(0); expect(fd.payroll.tipsCents).toBe(0); expect(fd.payroll.estimatedTodayCents).toBe(0);
    expect(fd.estimatedCommissionCents).toBe(0); expect(fd.todayTipsCents).toBe(0);
    expect(fd.todaySalesCents).toBe(full.todaySalesCents);     // sales are not pay

    const st = await svc.getState(frontDesk());
    expect(st.kpisFull.estimatedCommissionCents).toBe(0);
    expect(st.kpisFull.todayTipsCents).toBe(0);
    for (const r of st.rows.items) { expect(r.estimatedCommissionCents).toBe(0); expect(r.todayTipsCents).toBe(0); }
    // the manager's state is untouched (same repo → same numbers)
    const mst = await svc.getState(manager());
    expect(mst.kpisFull.totalTechnicians).toBe(st.kpisFull.totalTechnicians);
  });
  it('pure projections are identity for a pay reader and never mutate the input', () => {
    const detail: any = { technicianId: 't', commission: { defaultPercent: 55, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'weekly' }, payroll: { periodLabel: 'p', salesCents: 100, tipsCents: 10, commissionCents: 55, estimatedTodayCents: 55, closed: false }, estimatedCommissionCents: 55, todayTipsCents: 10 };
    expect(projectTechnicianPay(detail, true)).toBe(detail);
    const out = projectTechnicianPay(detail, false);
    expect(detail.commission.defaultPercent).toBe(55);
    expect(out.commission.defaultPercent).toBe(0); expect(out.payroll.commissionCents).toBe(0); expect(out.payroll.salesCents).toBe(100);
    const st: any = { kpisFull: { estimatedCommissionCents: 9, todayTipsCents: 9 }, rows: { items: [{ estimatedCommissionCents: 9, todayTipsCents: 9 }], pagination: {} }, technicians: { items: [], pagination: {} }, insights: { payrollSnapshotCents: 9 } };
    const p = projectTechniciansStatePay(st, false);
    expect(p.kpisFull.estimatedCommissionCents).toBe(0); expect((p as any).insights.payrollSnapshotCents).toBe(0); expect(p.rows.items[0].estimatedCommissionCents).toBe(0);
    expect(st.kpisFull.estimatedCommissionCents).toBe(9);
  });
});
