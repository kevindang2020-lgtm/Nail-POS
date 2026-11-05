import { describe, it, expect, vi } from 'vitest';
import { AiReportsService } from './ai-reports.service';

function harness() {
  const repo = {
    kpiTotals: vi.fn(async () => ({ generatedToday: 84, onDemandTotal: 28, weekly: 612, monthly: 2348 })),
    byType: vi.fn(async () => [{ reportKey: 'sales', count: 100 }, { reportKey: 'sales_summary', count: 28 }, { reportKey: 'services', count: 60 }, { reportKey: 'customer', count: 40 }, { reportKey: 'mystery', count: 12 }]),
    byFormat: vi.fn(async () => [{ format: 'pdf', count: 120 }, { format: 'xlsx', count: 80 }, { format: 'csv', count: 40 }]),
    daily7: vi.fn(async () => [{ day: '2026-05-06', count: 84 }, { day: '2026-05-05', count: 70 }]),
    recentExports: vi.fn(async () => [{ id: 'e1', reportKey: 'sales', format: 'pdf', tenant: 'Glamour', branch: 'Downtown', role: 'admin', startDate: '2026-05-01T00:00:00Z', endDate: '2026-05-06T00:00:00Z', hasFile: true, createdAt: '2026-05-06T06:15:00Z' }]),
    engineTotals: vi.fn(async () => ({ scheduleActive: 12, runsFailed: 3, avgGenDurationMs: 138000, deliveredCount: 628, deliveryTotal: 636 })),
    deliveryStatusCounts: vi.fn(async () => ({ delivered: 628, failed: 5, bounced: 2, pending: 1 })),
    runSourceCounts: vi.fn(async () => ({ scheduled: 40, onDemand: 12 })),
    recentRuns: vi.fn(async () => [{ reportKey: 'daily_platform', status: 'completed', durationMs: 138000, createdAt: '2026-05-06T06:15:00Z' }]),
    recentSchedules: vi.fn(async () => [{ name: 'Daily Platform', reportKey: 'daily_platform', frequency: 'daily', runAtTime: '06:00', scopeType: 'platform', nextRunAt: '2026-05-07T06:00:00Z', owner: 'System', status: 'active' }]),
    publishedTemplates: vi.fn(async () => [{ reportKey: 'daily_platform', name: 'Daily v2', version: 2 }]),
  };
  return { svc: new AiReportsService(repo as any) };
}

describe('AiReportsService.overview', () => {
  it('resolves the export + engine KPIs (schedules, failed, avg gen, delivery rate) and keeps true gaps honest', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.kpis.reportsGeneratedToday).toMatchObject({ value: 84, available: true });
    expect(o.kpis.weeklyReportsSent).toMatchObject({ value: 612, available: true });
    expect(o.kpis.scheduledReports).toMatchObject({ value: 12, available: true });
    expect(o.kpis.failedReports).toMatchObject({ value: 3, available: true });
    expect(o.kpis.avgGenerationTime).toMatchObject({ value: 138, available: true });
    expect(o.kpis.deliverySuccessRate).toMatchObject({ value: 98.7, available: true });
    for (const g of ['activeRecipients', 'reportTemplates', 'aiReceptionistReports', 'riskReportsOpen'] as const) {
      expect(o.kpis[g].available).toBe(false);
      expect(o.kpis[g].note).toBeTruthy();
    }
  });

  it('repoints delivery/source/schedule/history panels at the real engine tables', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect((o.deliveryStatus as any).available).toBe(true);
    expect((o.deliveryStatus as any).total).toBe(636);
    expect((o.scheduledVsOnDemand as any)).toMatchObject({ available: true, scheduled: 40, onDemand: 12 });
    expect((o.scheduleOverview as any).available).toBe(true);
    expect((o.generationHistory as any).rows[0]).toMatchObject({ reportKey: 'daily_platform', status: 'completed' });
    expect((o.deliverySummary as any)).toMatchObject({ available: true, delivered: 628, total: 636 });
    expect(o.publishedTemplates[0]).toMatchObject({ reportKey: 'daily_platform', version: 2 });
  });

  it('reconciles the Reports-by-Type donut (report_key → category) and format mix', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.reportsByType.total).toBe(240);
    expect(o.reportsByType.segments.find((s) => s.label === 'Revenue')!.value).toBe(128);
    expect(o.reportsByType.segments.find((s) => s.label === 'Other')!.value).toBe(12);
    expect(o.formatMix.total).toBe(240);
    expect(o.formatMix.segments.find((s) => s.label === 'PDF')!.value).toBe(120);
  });

  it('maps recent exports with category + scope and keeps only true panels gapped', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.recentReports[0]).toMatchObject({ name: 'sales', category: 'Revenue', format: 'PDF', scope: 'Glamour · Downtown', generated: true });
    for (const g of ['reportTemplates', 'recipientGroups'] as const) {
      expect((o as any)[g].available).toBe(false);
    }
  });
});
