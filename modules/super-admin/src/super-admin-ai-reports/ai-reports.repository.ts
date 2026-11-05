// Repository port for AI Reports oversight. Real source: the `report_exports` log. No schedule/job/delivery/template
// schema exists, so those are simply not queried (the service marks them honest gaps). In-memory returns empties.
export interface KeyCount { reportKey: string; count: number }
export interface FormatCount { format: string; count: number }
export interface DailyCount { day: string; count: number }
export interface KpiTotals { generatedToday: number; onDemandTotal: number; weekly: number; monthly: number }
export interface RecentExportRow { id: string; reportKey: string; format: string; tenant: string | null; branch: string | null; role: string | null; startDate: string | null; endDate: string | null; hasFile: boolean; createdAt: string | null }

export interface EngineTotals { scheduleActive: number; runsFailed: number; avgGenDurationMs: number; deliveredCount: number; deliveryTotal: number }
export interface DeliveryStatusCounts { delivered: number; failed: number; bounced: number; pending: number }
export interface RunSourceCounts { scheduled: number; onDemand: number }
export interface RecentRunRow { reportKey: string; status: string; durationMs: number | null; createdAt: string | null }
export interface RecentScheduleRow { name: string; reportKey: string; frequency: string; runAtTime: string; scopeType: string; nextRunAt: string | null; owner: string; status: string }

export interface PublishedTemplateRow { reportKey: string; name: string; version: number }

export interface AiReportsRepositoryPort {
  kpiTotals(): Promise<KpiTotals>;
  byType(): Promise<KeyCount[]>;
  byFormat(): Promise<FormatCount[]>;
  daily7(): Promise<DailyCount[]>;
  recentExports(limit: number): Promise<RecentExportRow[]>;
  engineTotals(): Promise<EngineTotals>;
  deliveryStatusCounts(): Promise<DeliveryStatusCounts>;
  runSourceCounts(): Promise<RunSourceCounts>;
  recentRuns(limit: number): Promise<RecentRunRow[]>;
  recentSchedules(limit: number): Promise<RecentScheduleRow[]>;
  publishedTemplates(): Promise<PublishedTemplateRow[]>;
}

export class InMemoryAiReportsRepository implements AiReportsRepositoryPort {
  async kpiTotals() { return { generatedToday: 0, onDemandTotal: 0, weekly: 0, monthly: 0 }; }
  async byType() { return []; }
  async byFormat() { return []; }
  async daily7() { return []; }
  async recentExports() { return []; }
  async engineTotals() { return { scheduleActive: 0, runsFailed: 0, avgGenDurationMs: 0, deliveredCount: 0, deliveryTotal: 0 }; }
  async deliveryStatusCounts() { return { delivered: 0, failed: 0, bounced: 0, pending: 0 }; }
  async runSourceCounts() { return { scheduled: 0, onDemand: 0 }; }
  async recentRuns() { return []; }
  async recentSchedules() { return []; }
  async publishedTemplates() { return []; }
}
