// AI Reports oversight service — composes the dashboard payload from the real report_exports log via ai-reports-core.
// Unsourced widgets (schedules, failures, recipients, delivery, templates, narratives) are honest gaps, not fabricated.
import type { AiReportsRepositoryPort } from './ai-reports.repository';
import { assembleAiReportKpis, assembleReportsByType, assembleDeliveryStatusMix, assembleSourceMix, classifyReportCategory, pct } from './ai-reports-core';

export class AiReportsService {
  constructor(private readonly repo: AiReportsRepositoryPort) {}

  async overview() {
    const [totals, byType, byFormat, daily, recent, engine, delCounts, srcCounts, recentRuns, recentSchedules, publishedTemplates] = await Promise.all([
      this.repo.kpiTotals(), this.repo.byType(), this.repo.byFormat(), this.repo.daily7(), this.repo.recentExports(8),
      this.repo.engineTotals(), this.repo.deliveryStatusCounts(), this.repo.runSourceCounts(), this.repo.recentRuns(8), this.repo.recentSchedules(8), this.repo.publishedTemplates(),
    ]);

    const deliverySuccessRate = engine.deliveryTotal > 0 ? pct(engine.deliveredCount, engine.deliveryTotal) : null;
    const kpis = assembleAiReportKpis({
      reportsGeneratedToday: totals.generatedToday, onDemandReports: totals.onDemandTotal, weeklyReportsSent: totals.weekly, monthlyReportsSent: totals.monthly,
      scheduledReports: engine.scheduleActive, failedReports: engine.runsFailed,
      avgGenerationTimeSec: engine.avgGenDurationMs > 0 ? Math.round(engine.avgGenDurationMs / 1000) : null, deliverySuccessRate,
    });
    const reportsByType = assembleReportsByType(byType);
    const formatTotal = byFormat.reduce((s, f) => s + (f.count || 0), 0);
    const deliveryMix = assembleDeliveryStatusMix(delCounts);
    const sourceMix = assembleSourceMix(srcCounts);

    return {
      kpis,
      reportsByType,
      formatMix: { segments: byFormat.map((f) => ({ label: (f.format || 'unknown').toUpperCase(), value: f.count, sharePct: pct(f.count, formatTotal) })), total: formatTotal },
      trend: daily.map((d) => ({ day: d.day, count: d.count })),
      recentReports: recent.map((r) => ({
        id: r.id, name: r.reportKey, category: classifyReportCategory(r.reportKey), format: (r.format || '').toUpperCase(),
        scope: r.tenant ? `${r.tenant}${r.branch ? ` · ${r.branch}` : ''}` : 'All Tenants', role: r.role,
        dateRange: r.startDate && r.endDate ? `${r.startDate.slice(0, 10)} → ${r.endDate.slice(0, 10)}` : null,
        generatedAt: r.createdAt, generated: r.hasFile,
      })),
      // Repointed at the real engine tables — available when data exists, else honest gap
      scheduledVsOnDemand: sourceMix.total > 0 ? { available: true, ...sourceMix } : { available: false, note: 'No report-generation runs yet' },
      deliveryStatus: deliveryMix.total > 0 ? { available: true, ...deliveryMix } : { available: false, note: 'No report deliveries yet' },
      scheduleOverview: recentSchedules.length > 0 ? { available: true, rows: recentSchedules } : { available: false, note: 'No report schedules yet' },
      generationHistory: recentRuns.length > 0 ? { available: true, rows: recentRuns } : { available: false, note: 'No report-generation runs yet' },
      deliverySummary: engine.deliveryTotal > 0 ? { available: true, delivered: engine.deliveredCount, total: engine.deliveryTotal, pending: delCounts.pending, failed: delCounts.failed, bounced: delCounts.bounced } : { available: false, note: 'No report deliveries yet' },
      // Still honest gaps — no schema
      failedReports: { available: false, note: 'See Generation History for failed runs' },
      reportTemplates: { available: false, note: 'No report-template schema' },
      recipientGroups: { available: false, note: 'No recipient-group schema' },
      publishedTemplates: publishedTemplates.map((t) => ({ reportKey: t.reportKey, name: t.name, version: t.version })),
      meta: { onDemandLabel: 'User-initiated report exports', generatedLabel: 'Report exports' },
    };
  }
}
