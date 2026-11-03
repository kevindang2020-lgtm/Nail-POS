// ai-business-reports.service.ts — generate bounded structured reports (§36). create() enqueues a job then generates
// it inline by composing the existing authorized tools; the result is stored as JSONB on the row. Because these
// reports are small (a few tool calls) this is safe in-request; a background worker could instead call generate() for
// large/scheduled reports. Every section is tenant-scoped via ctx; sections the caller can't see degrade rather than
// failing the whole report.
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import { REPORT_TYPES, type ReportType, type ReportJob, type ReportsJobRepositoryPort, type ReportContext } from './ai-business-reports.repository';

/** Facade over the tool services needed to compose reports. Real services satisfy it; forbidden sections are caught. */
export interface ReportToolset {
  getDailyBrief(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getRevenueSummary(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getAppointmentMetrics(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getCustomerGrowth(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  compareBranches(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
}

const PRESET_FOR: Record<ReportType, string> = {
  daily_brief: 'today', weekly_summary: 'week', monthly_review: 'month', branch_comparison: 'month',
};

export class AiBusinessReportsService {
  constructor(private readonly repo: ReportsJobRepositoryPort, private readonly tools: ReportToolset) {}

  private rctx(ctx: AiBusinessContext): ReportContext {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId };
  }

  /** Run a section, degrading to a { available:false } marker when the caller lacks permission for it. */
  private async section(run: () => Promise<unknown>): Promise<unknown> {
    try { return await run(); }
    catch (e: any) {
      const code = e?.code;
      if (code === AiBusinessErrorCode.INSUFFICIENT_PERMISSION) return { available: false, reason: 'restricted' };
      throw e;
    }
  }

  private async generate(ctx: AiBusinessContext, type: ReportType, preset: string): Promise<Record<string, unknown>> {
    switch (type) {
      case 'daily_brief':
        return { brief: await this.tools.getDailyBrief(ctx, preset) };
      case 'weekly_summary':
        return {
          revenue: await this.section(() => this.tools.getRevenueSummary(ctx, preset)),
          appointments: await this.tools.getAppointmentMetrics(ctx, preset),
          customers: await this.section(() => this.tools.getCustomerGrowth(ctx, preset)),
        };
      case 'monthly_review':
        return {
          revenue: await this.section(() => this.tools.getRevenueSummary(ctx, preset)),
          appointments: await this.tools.getAppointmentMetrics(ctx, preset),
          customers: await this.section(() => this.tools.getCustomerGrowth(ctx, preset)),
          branches: await this.section(() => this.tools.compareBranches(ctx, preset)),
        };
      case 'branch_comparison':
        return { branches: await this.tools.compareBranches(ctx, preset) };
    }
  }

  /** `preset` (AI Business Reports guide, Nov 3 2026): the period the owner chose — the type's default when omitted. `extra` is
   *  merged into the stored content: the exact salon-local period and the canonical Sales Report snapshot used by Verify. */
  async create(ctx: AiBusinessContext, reportType: string, presetIn?: string, extra?: (preset: string) => Promise<Record<string, unknown>>): Promise<ReportJob> {
    const rc = this.rctx(ctx);
    if (!REPORT_TYPES.includes(reportType as ReportType)) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unknown report type');
    const type = reportType as ReportType;
    const preset = presetIn ?? PRESET_FOR[type];
    const job = await this.repo.create(rc, type, preset);
    await this.repo.markRunning(rc, job.id);
    try {
      const content = { ...(await this.generate(ctx, type, preset)), ...(extra ? await extra(preset) : {}) };
      return (await this.repo.complete(rc, job.id, content)) ?? job;
    } catch (e: any) {
      // A hard failure (e.g. no reports.view at all) marks the job failed rather than 500-ing the request.
      const msg = e?.code === AiBusinessErrorCode.INSUFFICIENT_PERMISSION ? 'You do not have permission to generate this report.' : 'Report generation failed.';
      return (await this.repo.fail(rc, job.id, msg)) ?? job;
    }
  }

  get(ctx: AiBusinessContext, id: string): Promise<ReportJob | null> { return this.repo.get(this.rctx(ctx), id); }
  list(ctx: AiBusinessContext): Promise<ReportJob[]> { return this.repo.list(this.rctx(ctx)); }
}
