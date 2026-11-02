// ai-business-reports.repository.ts — DTOs + repo port + in-memory adapter for generated report jobs (§36).
// Tenant-scoped from ctx. Result is stored inline on the row; expired jobs are not returned.
export const REPORT_TYPES = ['daily_brief', 'weekly_summary', 'monthly_review', 'branch_comparison'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ReportContext { tenantId: string; branchId: string; userId: string }

export interface ReportJob {
  id: string;
  reportType: ReportType;
  preset: string;
  status: ReportStatus;
  content: unknown | null;      // populated only when completed
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  expired: boolean;
}

export interface ReportsJobRepositoryPort {
  create(ctx: ReportContext, reportType: ReportType, preset: string): Promise<ReportJob>;
  get(ctx: ReportContext, id: string): Promise<ReportJob | null>;
  list(ctx: ReportContext): Promise<ReportJob[]>;
  markRunning(ctx: ReportContext, id: string): Promise<void>;
  complete(ctx: ReportContext, id: string, content: unknown): Promise<ReportJob | null>;
  fail(ctx: ReportContext, id: string, error: string): Promise<ReportJob | null>;
}

interface Stored {
  id: string; tenantId: string; branchId: string | null; reportType: ReportType; preset: string;
  status: ReportStatus; content: unknown | null; error: string | null;
  createdAt: string; startedAt: string | null; completedAt: string | null; expiresAt: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class InMemoryReportsJobRepository implements ReportsJobRepositoryPort {
  private rows: Stored[] = [];
  private seq = 0;
  private view(r: Stored): ReportJob {
    const expired = Date.parse(r.expiresAt) < Date.now();
    return {
      id: r.id, reportType: r.reportType, preset: r.preset, status: r.status,
      content: expired ? null : r.content, error: r.error,
      createdAt: r.createdAt, startedAt: r.startedAt, completedAt: r.completedAt, expiresAt: r.expiresAt, expired,
    };
  }
  private find(ctx: ReportContext, id: string) { return this.rows.find((r) => r.id === id && r.tenantId === ctx.tenantId); }

  async create(ctx: ReportContext, reportType: ReportType, preset: string): Promise<ReportJob> {
    const now = new Date();
    const r: Stored = {
      id: `rj_${++this.seq}`, tenantId: ctx.tenantId, branchId: ctx.branchId || null, reportType, preset,
      status: 'queued', content: null, error: null, createdAt: now.toISOString(), startedAt: null, completedAt: null,
      expiresAt: new Date(now.getTime() + WEEK_MS).toISOString(),
    };
    this.rows.push(r);
    return this.view(r);
  }
  async get(ctx: ReportContext, id: string): Promise<ReportJob | null> { const r = this.find(ctx, id); return r ? this.view(r) : null; }
  async list(ctx: ReportContext): Promise<ReportJob[]> {
    return this.rows.filter((r) => r.tenantId === ctx.tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => this.view(r));
  }
  async markRunning(ctx: ReportContext, id: string): Promise<void> { const r = this.find(ctx, id); if (r) { r.status = 'running'; r.startedAt = new Date().toISOString(); } }
  async complete(ctx: ReportContext, id: string, content: unknown): Promise<ReportJob | null> {
    const r = this.find(ctx, id); if (!r) return null;
    r.status = 'completed'; r.content = content; r.completedAt = new Date().toISOString(); return this.view(r);
  }
  async fail(ctx: ReportContext, id: string, error: string): Promise<ReportJob | null> {
    const r = this.find(ctx, id); if (!r) return null;
    r.status = 'failed'; r.error = error; r.completedAt = new Date().toISOString(); return this.view(r);
  }
}
