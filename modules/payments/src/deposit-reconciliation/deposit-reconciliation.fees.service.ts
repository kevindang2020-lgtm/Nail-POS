// deposit-reconciliation.fees.service.ts — fee schedules + fee reconciliation. Settlements (and their actual
// fees) come from the slice-1 repo (payment_settlements); schedules from the fee repo. All matching is the pure
// engine — this layer only adds auth + validation. Honest: unverifiable fees are reported as such, never guessed.
import { buildFeeReconState, validateFeeSchedule, DEFAULT_FEE_OPTIONS, type FeeSchedule, type FeeReconState } from './deposit-reconciliation.fees';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { ReconRepositoryPort } from './deposit-reconciliation.repository';
import type { FeeScheduleRepositoryPort, CreateFeeScheduleInput } from './deposit-reconciliation.fees.repository';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';

export class FeeReconciliationService {
  constructor(private readonly recon: ReconRepositoryPort, private readonly fees: FeeScheduleRepositoryPort) {}
  private auth(ctx: ReconContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated'); }

  async listFeeSchedules(ctx: ReconContext): Promise<FeeSchedule[]> { this.auth(ctx); return this.fees.listFeeSchedules(ctx); }

  async createFeeSchedule(ctx: ReconContext, input: CreateFeeScheduleInput): Promise<FeeSchedule> {
    this.auth(ctx);
    const v = validateFeeSchedule(input);
    if (!v.ok) throw new ReconValidationError(v.error || 'Invalid fee schedule');
    return this.fees.createFeeSchedule(ctx, {
      processorType: String(input.processorType).trim(), label: String(input.label).trim(), effectiveFrom: input.effectiveFrom,
      percentageBps: input.percentageBps ?? 0, perTransactionCents: input.perTransactionCents ?? 0, batchCents: input.batchCents ?? 0, monthlyCents: input.monthlyCents ?? 0, notes: input.notes ?? null,
    });
  }

  async getFeeReconciliation(ctx: ReconContext): Promise<FeeReconState> {
    this.auth(ctx);
    const [settlements, schedules] = await Promise.all([this.recon.listSettlements(ctx), this.fees.listFeeSchedules(ctx)]);
    return buildFeeReconState(settlements, schedules, DEFAULT_FEE_OPTIONS);
  }
}
