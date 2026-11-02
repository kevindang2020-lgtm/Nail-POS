// Pure logic for the Super Admin AI Reports oversight surface. No DB/Nest deps. The real source is the existing
// `report_exports` log (report_key, format, scope, created_at). There is NO schedule / generation-job / delivery /
// template / recipient / narrative / model-version schema, so those widgets are HONEST GAPS (available:false), never
// fabricated. On-demand = user-initiated exports (documented); "sent/generated" counts are export counts by window.

export type ReportCategory = 'Platform' | 'Revenue' | 'Operations' | 'Customer' | 'Risk & Compliance' | 'Other';
const CATEGORY_BY_KEY: Record<string, ReportCategory> = {
  sales: 'Revenue', sales_summary: 'Revenue', revenue: 'Revenue', merchant_processing: 'Revenue',
  services: 'Operations', technician_performance: 'Operations', branch_performance: 'Operations', queue: 'Operations',
  customer: 'Customer', customer_retention: 'Customer', retention: 'Customer',
  platform: 'Platform', daily_platform: 'Platform',
  system_risk: 'Risk & Compliance', risk: 'Risk & Compliance', security: 'Risk & Compliance',
};
export function classifyReportCategory(reportKey: string | null | undefined): ReportCategory {
  return CATEGORY_BY_KEY[String(reportKey || '').toLowerCase()] || 'Other';
}

export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Reports by Type donut — categorizes the real report_key counts; the center total equals the sum (reconciles by design).
export function assembleReportsByType(counts: { reportKey: string; count: number }[]): { segments: { label: ReportCategory; value: number; sharePct: number }[]; total: number } {
  const byCat = new Map<ReportCategory, number>();
  for (const c of counts || []) { const cat = classifyReportCategory(c.reportKey); byCat.set(cat, (byCat.get(cat) || 0) + (Number(c.count) || 0)); }
  const total = Array.from(byCat.values()).reduce((s, x) => s + x, 0);
  const order: ReportCategory[] = ['Platform', 'Revenue', 'Operations', 'Customer', 'Risk & Compliance', 'Other'];
  const segments = order.filter((c) => byCat.has(c)).map((label) => ({ label, value: byCat.get(label)!, sharePct: pct(byCat.get(label)!, total) }));
  return { segments, total };
}

export interface AiReportKpi { value: number | null; available: boolean; note?: string }
const kpi = (v: number | null | undefined, note?: string): AiReportKpi => ({ value: v == null ? null : Number(v), available: v != null, ...(note ? { note } : {}) });

export interface AiReportKpiRaw { reportsGeneratedToday?: number | null; onDemandReports?: number | null; weeklyReportsSent?: number | null; monthlyReportsSent?: number | null; scheduledReports?: number | null; failedReports?: number | null; avgGenerationTimeSec?: number | null; deliverySuccessRate?: number | null }

// 12 headline KPIs. Only those sourceable from the export log resolve; the rest (schedules, failures, recipients,
// delivery rate, generation time, templates, AI-receptionist, open risk) have no schema and stay honest gaps.
export function assembleAiReportKpis(raw: AiReportKpiRaw): Record<
  'scheduledReports' | 'reportsGeneratedToday' | 'onDemandReports' | 'failedReports' | 'activeRecipients' | 'deliverySuccessRate' |
  'avgGenerationTime' | 'reportTemplates' | 'weeklyReportsSent' | 'monthlyReportsSent' | 'aiReceptionistReports' | 'riskReportsOpen', AiReportKpi> {
  return {
    scheduledReports: kpi(raw.scheduledReports, 'Active report schedules'),
    reportsGeneratedToday: kpi(raw.reportsGeneratedToday, 'Report exports created today'),
    onDemandReports: kpi(raw.onDemandReports, 'User-initiated report exports'),
    failedReports: kpi(raw.failedReports, 'Failed report-generation runs'),
    activeRecipients: kpi(null, 'No recipient schema'),
    deliverySuccessRate: kpi(raw.deliverySuccessRate, 'Delivered ÷ requested deliveries'),
    avgGenerationTime: kpi(raw.avgGenerationTimeSec, 'Avg completed-run duration (seconds)'),
    reportTemplates: kpi(null, 'No report-template schema'),
    weeklyReportsSent: kpi(raw.weeklyReportsSent, 'Report exports in the last 7 days'),
    monthlyReportsSent: kpi(raw.monthlyReportsSent, 'Report exports in the last 30 days'),
    aiReceptionistReports: kpi(null, 'No AI-receptionist report type recorded'),
    riskReportsOpen: kpi(null, 'No risk-report status schema'),
  };
}

// Delivery Status donut from recipient-level delivery counts (center total = sum; reconciles by design).
export function assembleDeliveryStatusMix(counts: { delivered: number; failed: number; bounced: number; pending: number }): { segments: { label: string; value: number; sharePct: number }[]; total: number } {
  const entries: [string, number][] = [['Delivered', counts.delivered || 0], ['Failed', counts.failed || 0], ['Bounced', counts.bounced || 0], ['Pending', counts.pending || 0]];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return { segments: entries.filter(([, v]) => v > 0).map(([label, value]) => ({ label, value, sharePct: pct(value, total) })), total };
}

// Scheduled vs On-Demand from real run generation_source counts.
export function assembleSourceMix(counts: { scheduled: number; onDemand: number }): { scheduled: number; onDemand: number; total: number } {
  return { scheduled: counts.scheduled || 0, onDemand: counts.onDemand || 0, total: (counts.scheduled || 0) + (counts.onDemand || 0) };
}
