// deposit-reconciliation.reports.service.ts — read-only finance reports composed from the deterministic engine
// outputs (reconciliation state, fee state, exceptions). Exports are generated server-side as CSV.
import { buildReconState, DEFAULT_RECON_OPTIONS, type ReconContext, type ReconOptions } from './deposit-reconciliation.dto';
import { buildFeeReconState, DEFAULT_FEE_OPTIONS } from './deposit-reconciliation.fees';
import { buildExceptionsState } from './deposit-reconciliation.exceptions';
import { buildDailyReport, buildSummary, dailyReportToCsv, type DailyReport, type ReconSummary } from './deposit-reconciliation.reports';
import type { ReconRepositoryPort } from './deposit-reconciliation.repository';
import type { FeeScheduleRepositoryPort } from './deposit-reconciliation.fees.repository';
import type { ExceptionsRepositoryPort } from './deposit-reconciliation.exceptions.repository';
import { ReconForbiddenError } from './deposit-reconciliation.service';

export class ReportsService {
  constructor(private readonly recon: ReconRepositoryPort, private readonly fees: FeeScheduleRepositoryPort, private readonly exceptions: ExceptionsRepositoryPort) {}
  private auth(ctx: ReconContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated'); }
  private options(): ReconOptions { return { ...DEFAULT_RECON_OPTIONS, nowIso: new Date().toISOString() }; }

  private async reconState(ctx: ReconContext) {
    const [settlements, deposits] = await Promise.all([this.recon.listSettlements(ctx), this.recon.listDeposits(ctx)]);
    return buildReconState(settlements, deposits, this.options());
  }

  async getDaily(ctx: ReconContext): Promise<DailyReport> { this.auth(ctx); return buildDailyReport(await this.reconState(ctx)); }

  async getSummary(ctx: ReconContext): Promise<ReconSummary> {
    this.auth(ctx);
    const [state, settlements, schedules, exceptions] = await Promise.all([this.reconState(ctx), this.recon.listSettlements(ctx), this.fees.listFeeSchedules(ctx), this.exceptions.list(ctx)]);
    const feeState = buildFeeReconState(settlements, schedules, DEFAULT_FEE_OPTIONS);
    return buildSummary(state, feeState, buildExceptionsState(exceptions));
  }

  async exportDailyCsv(ctx: ReconContext): Promise<string> { this.auth(ctx); return dailyReportToCsv(buildDailyReport(await this.reconState(ctx))); }
}
