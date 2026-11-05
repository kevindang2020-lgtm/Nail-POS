import { describe, it, expect } from 'vitest';
import { SuperAdminRevenueResidualsService } from './super-admin-revenue-residuals.service';

// Validation runs before any repo call, so a stub repo is never touched for these cases.
const stubRepo = {} as any;
const svc = () => new SuperAdminRevenueResidualsService(stubRepo);
const actor = { id: undefined, role: 'super_admin' };
const base = { name: 'Test', aiPct: 60, processorPct: 15, salonPct: 25, effectiveDate: '2026-05-01' };

describe('SuperAdminRevenueResidualsService validation (Add Revenue Rule)', () => {
  it('rejects a missing name', async () => {
    const r = await svc().createAgreement(actor, { ...base, name: '' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('name_required'); expect((r as any).status).toBe(400);
  });

  it('rejects percentages that do not total 100', async () => {
    const r = await svc().createAgreement(actor, { ...base, aiPct: 60, processorPct: 15, salonPct: 20 });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('percentages_must_total_100');
  });

  it('rejects a missing effective date', async () => {
    const r = await svc().createAgreement(actor, { ...base, effectiveDate: '' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('effective_date_required');
  });

  it('rejects an expiration date before the effective date', async () => {
    const r = await svc().createAgreement(actor, { ...base, effectiveDate: '2026-05-01', expirationDate: '2026-04-01' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('expiration_before_effective');
  });

  it('accepts a valid two-party split (65/35/0)', async () => {
    // passes validation; would proceed to the repo (stub) — we only assert it clears validation, so use a repo that records the call
    const rec: any[] = [];
    const s = new SuperAdminRevenueResidualsService({ createAgreement: async (_a: any, i: any) => { rec.push(i); return { ok: true, id: 'x', code: 'AGR-2026-0001', versionId: 'v' }; } } as any);
    const r = await s.createAgreement(actor, { ...base, aiPct: 65, processorPct: 35, salonPct: 0 });
    expect(r.ok).toBe(true); expect((r as any).status).toBe(201); expect(rec[0].aiPct).toBe(65);
  });

  it('addVersion rejects a bad split without touching the repo', async () => {
    const r = await svc().addVersion(actor, 'agr-1', { aiPct: 50, processorPct: 30, salonPct: 30, effectiveDate: '2026-06-01' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('percentages_must_total_100');
  });

  it('returns unavailable when no repo is wired', async () => {
    const s = new SuperAdminRevenueResidualsService(undefined);
    const r = await s.createAgreement(actor, base);
    expect(r.ok).toBe(false); expect((r as any).error).toBe('unavailable'); expect((r as any).status).toBe(503);
  });

  it('importStatement rejects a missing statement reference', async () => {
    const r = await svc().importStatement(actor, { processor: 'Fiserv', periodStart: '2026-05-01', periodEnd: '2026-05-31', processorCalculatedCents: 100 });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('statement_ref_required');
  });

  it('importStatement rejects a missing/invalid period', async () => {
    const r = await svc().importStatement(actor, { processor: 'Fiserv', statementRef: 'S1', processorCalculatedCents: 100 });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('period_required');
  });

  it('importStatement rejects a period end before start', async () => {
    const r = await svc().importStatement(actor, { processor: 'Fiserv', statementRef: 'S1', periodStart: '2026-05-31', periodEnd: '2026-05-01', processorCalculatedCents: 100 });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('period_end_before_start');
  });

  it('reviewStatement rejects an invalid status', async () => {
    const r = await svc().reviewStatement(actor, 'stmt-1', 'bogus');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('invalid_status');
  });

  it('reconcileStatement requires a statement id', async () => {
    const r = await svc().reconcileStatement(actor, '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('statement_required'); expect((r as any).status).toBe(400);
  });

  it('reconcileStatement returns unavailable when no repo is wired', async () => {
    const s = new SuperAdminRevenueResidualsService(undefined);
    const r = await s.reconcileStatement(actor, 'stmt-1');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('unavailable'); expect((r as any).status).toBe(503);
  });

  it('calculatePartnerPayout requires an agreement', async () => {
    const r = await svc().calculatePartnerPayout(actor, { periodStart: '2026-05-01', periodEnd: '2026-05-31' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('agreement_required');
  });

  it('calculatePartnerPayout requires a valid period', async () => {
    const r = await svc().calculatePartnerPayout(actor, { agreementId: 'a1' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('period_required');
  });

  it('approvePartnerPayout requires a payout id', async () => {
    const r = await svc().approvePartnerPayout(actor, '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('payout_required');
  });

  it('calculateTenantIncentive requires an agreement and a tenant', async () => {
    const r1 = await svc().calculateTenantIncentive(actor, { tenantId: 't1', periodStart: '2026-05-01', periodEnd: '2026-05-31' });
    expect(r1.ok).toBe(false); expect((r1 as any).error).toBe('agreement_required');
    const r2 = await svc().calculateTenantIncentive(actor, { agreementId: 'a1', periodStart: '2026-05-01', periodEnd: '2026-05-31' });
    expect(r2.ok).toBe(false); expect((r2 as any).error).toBe('tenant_required');
  });

  it('calculateTenantIncentive requires a valid period', async () => {
    const r = await svc().calculateTenantIncentive(actor, { agreementId: 'a1', tenantId: 't1' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('period_required');
  });

  it('approveTenantIncentive requires an incentive id', async () => {
    const r = await svc().approveTenantIncentive(actor, '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('incentive_required');
  });

  it('exportPayoutReports returns unavailable when no repo is wired', async () => {
    const s = new SuperAdminRevenueResidualsService(undefined);
    const r = await s.exportPayoutReports(actor, { page: 1, pageSize: 10 } as any);
    expect(r.ok).toBe(false); expect((r as any).error).toBe('unavailable'); expect((r as any).status).toBe(503);
  });

  it('exportPayoutReports builds an audited CSV for a stub repo', async () => {
    const audits: any[] = [];
    const repo = {
      listRecords: async () => ({ rows: [{ agreementCode: 'AGR-1', tenantName: 'T', branchName: 'B', processor: 'Fiserv', revenueSource: 'processing_residual', grossRevenueCents: 1523045, salonIncentiveShareCents: 380761, processorShareCents: 228457, aiShareCents: 913827, refundsCreditsCents: 18520, netRevenueCents: 895307, effectiveDate: '2026-05-01', status: 'pending' }], total: 1 }),
      recordExportAudit: async (_a: any, dataset: string, count: number) => { audits.push({ dataset, count }); },
    } as any;
    const s = new SuperAdminRevenueResidualsService(repo);
    const r = await s.exportPayoutReports(actor, { dataset: 'records', page: 1, pageSize: 10 } as any);
    expect(r.ok).toBe(true);
    expect((r as any).mime).toBe('text/csv');
    expect((r as any).content).toContain('"Agreement"');
    expect((r as any).content).toContain('895307'.slice(0, 0) + '8953.07'); // net formatted as dollars
    expect(audits[0]).toEqual({ dataset: 'records', count: 1 });
  });

  it('createAdjustment rejects a zero amount', async () => {
    const r = await svc().createAdjustment(actor, { adjustmentType: 'other', amountCents: 0, reason: 'x' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('amount_required');
  });

  it('createAdjustment requires a reason', async () => {
    const r = await svc().createAdjustment(actor, { adjustmentType: 'other', amountCents: -100, reason: '' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('reason_required');
  });

  it('createAdjustment rejects an invalid adjustment type', async () => {
    const r = await svc().createAdjustment(actor, { adjustmentType: 'bogus', amountCents: -100, reason: 'x' });
    expect(r.ok).toBe(false); expect((r as any).error).toBe('invalid_adjustment_type');
  });

  it('approveAdjustment requires an adjustment id', async () => {
    const r = await svc().approveAdjustment(actor, '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('adjustment_required');
  });

  it('reverseAdjustment requires an adjustment id and is unavailable with no repo', async () => {
    const r1 = await svc().reverseAdjustment(actor, '');
    expect(r1.ok).toBe(false); expect((r1 as any).error).toBe('adjustment_required');
    const r2 = await new SuperAdminRevenueResidualsService(undefined).reverseAdjustment(actor, 'a1');
    expect(r2.ok).toBe(false); expect((r2 as any).error).toBe('unavailable');
  });

  it('createPeriod requires a name and a valid period', async () => {
    const r1 = await svc().createPeriod(actor, { startDate: '2026-05-01', endDate: '2026-05-31' });
    expect(r1.ok).toBe(false); expect((r1 as any).error).toBe('name_required');
    const r2 = await svc().createPeriod(actor, { name: '2026-05', startDate: '2026-05-31', endDate: '2026-05-01' });
    expect(r2.ok).toBe(false); expect((r2 as any).error).toBe('period_end_before_start');
  });

  it('lockPeriod requires a period id', async () => {
    const r = await svc().lockPeriod(actor, '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('period_id_required');
  });

  it('reopenPeriod requires a reason', async () => {
    const r = await svc().reopenPeriod(actor, 'per-1', '');
    expect(r.ok).toBe(false); expect((r as any).error).toBe('reason_required');
  });

  it('unpaidResiduals returns unavailable (empty) when no repo is wired', async () => {
    const s = new SuperAdminRevenueResidualsService(undefined);
    const r = await s.unpaidResiduals({});
    expect(r.available).toBe(false); expect(r.rows).toEqual([]); expect(r.totals.outstandingCents).toBe(0);
  });

  it('unpaidResiduals passes through the aging aggregation from the repo', async () => {
    const repo = { unpaidResidualsAging: async () => ({ rows: [{ processor: 'Fiserv', outstandingCents: 800000, currentCents: 0, b31_60Cents: 0, b61_90Cents: 500000, b90PlusCents: 300000, oldestAgeDays: 100 }], totals: { outstandingCents: 800000, currentCents: 0, b31_60Cents: 0, b61_90Cents: 500000, b90PlusCents: 300000 } }) } as any;
    const r = await new SuperAdminRevenueResidualsService(repo).unpaidResiduals({});
    expect(r.available).toBe(true); expect(r.rows[0].b90PlusCents).toBe(300000); expect(r.totals.outstandingCents).toBe(800000);
  });

  it('forecast returns unavailable when no repo is wired', async () => {
    const r = await new SuperAdminRevenueResidualsService(undefined).forecast({});
    expect(r.available).toBe(false); expect((r as any).reason).toBe('unavailable');
  });

  it('forecast passes through the projection from the repo', async () => {
    const repo = { revenueForecast: async () => ({ available: true, methodology: 'x', history: [{ month: '2026-03', grossCents: 1, netCents: 1000000 }, { month: '2026-04', grossCents: 1, netCents: 1200000 }], projection: [{ month: '2026-05', projectedNetCents: 1400000, lowCents: 1300000, highCents: 1500000 }], nextPeriod: { month: '2026-05', projectedNetCents: 1400000, lowCents: 1300000, highCents: 1500000 }, monthlyGrowthPct: 15.4, byProcessor: [{ processor: 'Fiserv', sharePct: 100, projectedNetCents: 1400000 }] }) } as any;
    const r = await new SuperAdminRevenueResidualsService(repo).forecast({ horizonMonths: 1 });
    expect(r.available).toBe(true); expect((r as any).nextPeriod.projectedNetCents).toBe(1400000); expect((r as any).monthlyGrowthPct).toBe(15.4);
  });

  it('enqueueExportJob returns unavailable when no repo is wired', async () => {
    const r = await new SuperAdminRevenueResidualsService(undefined).enqueueExportJob(actor, {} as any);
    expect(r.ok).toBe(false); expect((r as any).error).toBe('unavailable');
  });

  it('enqueueExportJob creates a job and the worker completes it via the shared builder', async () => {
    const store: Record<string, any> = {};
    const repo = {
      createExportJob: async (_a: any, i: any) => { store.job = { id: 'j1', ...i, status: 'queued' }; return { ok: true, jobId: 'j1', status: 'queued' }; },
      markExportJobRunning: async () => { store.job.status = 'running'; },
      completeExportJob: async (_id: string, res: any) => { store.job = { ...store.job, status: 'completed', ...res }; },
      failExportJob: async (_id: string, err: string) => { store.job = { ...store.job, status: 'failed', error: err }; },
      getExportJob: async () => store.job,
      // builder deps:
      listRecords: async () => ({ rows: [{ agreementCode: 'AGR-1', tenantName: 'T', branchName: 'B', processor: 'Fiserv', revenueSource: 'processing_residual', grossRevenueCents: 100, salonIncentiveShareCents: 25, processorShareCents: 15, aiShareCents: 60, refundsCreditsCents: 0, netRevenueCents: 100, effectiveDate: '2026-05-01', status: 'pending' }], total: 1 }),
      recordExportAudit: async () => undefined,
    } as any;
    const s = new SuperAdminRevenueResidualsService(repo);
    const enq = await s.enqueueExportJob(actor, { dataset: 'records', format: 'csv' } as any);
    expect(enq.ok).toBe(true); expect((enq as any).status).toBe(202);
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    const g = await s.getExportJob('j1');
    expect(g.job.status).toBe('completed'); expect(g.job.content).toContain('"Agreement"'); expect(g.job.rowCount).toBe(1);
  });
});
