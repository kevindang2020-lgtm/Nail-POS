// deposit-reconciliation.periods.service.ts — accounting-period close. The close guard blocks closure over
// unresolved MATERIAL exceptions dated within the period (spec: no silent close over material differences).
// A dry-run check surfaces blockers + warnings without closing. Closure records who closed it and when.
import { canClosePeriod, validateCreatePeriod, DEFAULT_CLOSE_OPTIONS, type ReconPeriod, type CloseCheck } from './deposit-reconciliation.periods';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { PeriodsRepositoryPort, CreatePeriodInput } from './deposit-reconciliation.periods.repository';
import type { ExceptionsRepositoryPort } from './deposit-reconciliation.exceptions.repository';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class PeriodsService {
  constructor(private readonly periods: PeriodsRepositoryPort, private readonly exceptions: ExceptionsRepositoryPort) {}
  private auth(ctx: ReconContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated'); }

  async list(ctx: ReconContext): Promise<ReconPeriod[]> { this.auth(ctx); return this.periods.list(ctx); }

  async create(ctx: ReconContext, input: Partial<CreatePeriodInput>): Promise<ReconPeriod> {
    this.auth(ctx);
    const v = validateCreatePeriod(input);
    if (!v.ok) throw new ReconValidationError(v.error || 'Invalid period');
    return this.periods.create(ctx, { label: String(input.label).trim(), periodStart: input.periodStart!, periodEnd: input.periodEnd!, notes: input.notes ?? null });
  }

  async checkClose(ctx: ReconContext, id: string): Promise<CloseCheck & { period: ReconPeriod }> {
    this.auth(ctx);
    const period = await this.periods.find(ctx, id); if (!period) throw withCode(new ReconValidationError('Period not found'), 'RECON_PERIOD_NOT_FOUND');
    const check = canClosePeriod(await this.exceptions.list(ctx), period, DEFAULT_CLOSE_OPTIONS);
    return { ...check, period };
  }

  async close(ctx: ReconContext, id: string, notes?: string | null): Promise<ReconPeriod> {
    this.auth(ctx);
    const period = await this.periods.find(ctx, id); if (!period) throw withCode(new ReconValidationError('Period not found'), 'RECON_PERIOD_NOT_FOUND');
    if (period.status === 'closed') throw withCode(new ReconValidationError('Period is already closed'), 'RECON_PERIOD_CLOSED');
    const check = canClosePeriod(await this.exceptions.list(ctx), period, DEFAULT_CLOSE_OPTIONS);
    if (!check.ok) throw withCode(new ReconValidationError(`Cannot close: ${check.blockers.length} unresolved material exception(s) in this period must be resolved or approved first`), 'RECON_PERIOD_HAS_BLOCKERS', { count: check.blockers.length });
    const closed = await this.periods.setStatus(ctx, id, 'closed', ctx.userId, new Date().toISOString(), notes ?? period.notes);
    if (!closed) throw withCode(new ReconValidationError('Period not found'), 'RECON_PERIOD_NOT_FOUND');
    return closed;
  }

  async reopen(ctx: ReconContext, id: string): Promise<ReconPeriod> {
    this.auth(ctx);
    const period = await this.periods.find(ctx, id); if (!period) throw withCode(new ReconValidationError('Period not found'), 'RECON_PERIOD_NOT_FOUND');
    const reopened = await this.periods.setStatus(ctx, id, 'open', null, null);
    if (!reopened) throw withCode(new ReconValidationError('Period not found'), 'RECON_PERIOD_NOT_FOUND');
    return reopened;
  }
}
