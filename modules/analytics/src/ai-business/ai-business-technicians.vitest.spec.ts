// ai-business-technicians.vitest.spec.ts — slice 7: technician performance (§16, §32, §47).
import { ForbiddenError, type ReportsContext, type ReportFilters, type TopTechnicianRevenue } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessTechniciansService, type TechnicianSource } from './ai-business-technicians.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const tech = (o: Partial<TopTechnicianRevenue>): TopTechnicianRevenue => ({ technicianId: 't', rank: 0, name: 'T', roleLabel: 'Nail Tech', revenueCents: 0, completedServices: 0, ...o });

class FakeTechSource implements TechnicianSource {
  lastCtx: ReportsContext | null = null;
  constructor(private data: TopTechnicianRevenue[], private deny = false) {}
  async getTechnicians(ctx: ReportsContext, _f?: ReportFilters) { this.lastCtx = ctx; if (this.deny) throw new ForbiddenError('Missing pos.reports.technician_view'); return this.data; }
}
const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view', 'pos.reports.technician_view'], ...o });

describe('getTechnicianPerformance', () => {
  const src = new FakeTechSource([
    tech({ technicianId: 't1', name: 'Ana', revenueCents: 300000, completedServices: 60 }),
    tech({ technicianId: 't2', name: 'Bui', revenueCents: 120000, completedServices: 30 }),
    tech({ technicianId: 't3', name: 'Cam', revenueCents: 8000, completedServices: 2 }), // below sample floor
  ]);
  const svc = new AiBusinessTechniciansService(src);

  it('exposes only operational fields and derives average service revenue', async () => {
    const r = await svc.getTechnicianPerformance(CTX(), 'month');
    const ana = r.technicians.find((t) => t.technicianId === 't1')!;
    expect(ana.completedServices).toBe(60);
    expect(ana.serviceRevenueCents).toBe(300000);
    expect(ana.averageServiceRevenueCents).toBe(5000); // 300000/60
    expect(r.modeledFields).toEqual(['completedServices', 'serviceRevenueCents', 'averageServiceRevenueCents(derived)']);
  });

  it('never surfaces compensation and marks payrollIncluded false', async () => {
    const r = await svc.getTechnicianPerformance(CTX(), 'month');
    expect(r.payrollIncluded).toBe(false);
    // The technician ROWS must carry no pay/tip/commission fields (notes may mention them as exclusions).
    expect(JSON.stringify(r.technicians)).not.toMatch(/tip|commission|pay|compensation/i);
    for (const row of r.technicians) {
      expect(Object.keys(row)).not.toContain('tipsCents');
      expect(Object.keys(row)).not.toContain('commissionCents');
    }
    expect(r.notes.some((n) => /Compensation.*payroll permission/i.test(n))).toBe(true);
  });

  it('sorts by completed-service volume with a disclosed criterion, not a performance verdict', async () => {
    const r = await svc.getTechnicianPerformance(CTX(), 'month');
    expect(r.performanceRanking).toBe(false);
    expect(r.technicians.map((t) => t.technicianId)).toEqual(['t1', 't2', 't3']); // by completedServices desc
    expect(r.technicians[0].volumeRank).toBe(1);
  });

  it('flags technicians below the sample-size floor', async () => {
    const r = await svc.getTechnicianPerformance(CTX(), 'month');
    expect(r.technicians.find((t) => t.technicianId === 't3')?.limitedSample).toBe(true);
    expect(r.anyLimitedSample).toBe(true);
    expect(r.notes.some((n) => /fewer than 5 completed/i.test(n))).toBe(true);
  });

  it('includes a fairness notice and no employment recommendation', async () => {
    const r = await svc.getTechnicianPerformance(CTX(), 'month');
    expect(r.fairnessNotice).toMatch(/must not be used.*employment decision/i);
    expect(JSON.stringify(r)).not.toMatch(/fire|terminate|demote|discipline/i);
  });

  it('handles zero completed services without dividing by zero', async () => {
    const r = await new AiBusinessTechniciansService(new FakeTechSource([tech({ technicianId: 'tz', completedServices: 0, revenueCents: 0 })])).getTechnicianPerformance(CTX(), 'week');
    expect(r.technicians[0].averageServiceRevenueCents).toBeNull();
  });

  it('rejects an invalid preset', async () => {
    try { await svc.getTechnicianPerformance(CTX(), 'aeon'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('maps the technician-view permission denial to INSUFFICIENT_PERMISSION', async () => {
    const denied = new AiBusinessTechniciansService(new FakeTechSource([], true));
    try { await denied.getTechnicianPerformance(CTX({ permissions: ['ai.use', 'pos.reports.view'] }), 'month'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION); }
  });

  it('builds the ReportsContext from the trusted tenant id', async () => {
    await svc.getTechnicianPerformance(CTX({ tenantId: 'tT' }), 'week');
    expect(src.lastCtx?.tenantId).toBe('tT');
  });
});
