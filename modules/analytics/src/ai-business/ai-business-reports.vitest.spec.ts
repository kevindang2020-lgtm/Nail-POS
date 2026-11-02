// ai-business-reports.vitest.spec.ts — slice 13: generated reports (§36).
import { describe, it, expect } from 'vitest';
import { AiBusinessReportsService, type ReportToolset } from './ai-business-reports.service';
import { InMemoryReportsJobRepository } from './ai-business-reports.repository';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';

const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view'], ...o });

const toolset = (over: Partial<ReportToolset> = {}): ReportToolset => ({
  async getDailyBrief() { return { brief: true }; },
  async getRevenueSummary() { return { netSalesCents: 84200 }; },
  async getAppointmentMetrics() { return { funnel: { completed: 30 } }; },
  async getCustomerGrowth() { return { newCustomers: 12 }; },
  async compareBranches() { return { branches: [] }; },
  ...over,
});
const mk = (ts: ReportToolset = toolset()) => new AiBusinessReportsService(new InMemoryReportsJobRepository(), ts);

describe('generate lifecycle', () => {
  it('creates a completed daily_brief job with content', async () => {
    const job = await mk().create(CTX(), 'daily_brief');
    expect(job.status).toBe('completed');
    expect(job.content).toEqual({ brief: { brief: true } });
    expect(job.completedAt).not.toBeNull();
    expect(job.expiresAt).toBeTruthy();
  });

  it('composes multiple sections for a monthly_review', async () => {
    const job = await mk().create(CTX(), 'monthly_review');
    const c = job.content as any;
    expect(c.revenue).toBeTruthy();
    expect(c.appointments).toBeTruthy();
    expect(c.customers).toBeTruthy();
    expect(c.branches).toBeTruthy();
  });

  it('rejects an unknown report type', async () => {
    try { await mk().create(CTX(), 'annual_saga'); expect.fail('throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
});

describe('permission degradation', () => {
  it('degrades a restricted revenue section to { available:false } rather than failing the report', async () => {
    const ts = toolset({ async getRevenueSummary() { throw new AiBusinessForbiddenError('no financial'); } });
    const job = await mk(ts).create(CTX(), 'weekly_summary');
    expect(job.status).toBe('completed');
    expect((job.content as any).revenue).toEqual({ available: false, reason: 'restricted' });
    expect((job.content as any).appointments).toBeTruthy(); // operational section still present
  });

  it('marks the job failed when a required section is forbidden outright', async () => {
    const ts = toolset({ async getDailyBrief() { throw new AiBusinessForbiddenError('no reports.view'); } });
    const job = await mk(ts).create(CTX(), 'daily_brief');
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/permission/i);
    expect(job.content).toBeNull();
  });
});

describe('retrieval + isolation', () => {
  it('lists and gets a tenant\u2019s own jobs; another tenant sees none', async () => {
    const svc = mk();
    const job = await svc.create(CTX({ tenantId: 'tA' }), 'daily_brief');
    expect((await svc.get(CTX({ tenantId: 'tA' }), job.id))?.id).toBe(job.id);
    expect(await svc.get(CTX({ tenantId: 'tB' }), job.id)).toBeNull();
    expect(await svc.list(CTX({ tenantId: 'tB' }))).toHaveLength(0);
  });

  it('rejects an unauthenticated context', async () => {
    try { await mk().create({ tenantId: '', branchId: '', userId: '', role: '', permissions: [] }, 'daily_brief'); expect.fail('throw'); }
    catch (e) { expect(e).toBeInstanceOf(AiBusinessForbiddenError); }
  });
});
