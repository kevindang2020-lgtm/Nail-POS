// deposit-reconciliation.adjustments.service.ts — read-only reconciliation view of refunds, chargebacks, and
// compensation adjustments (all from existing tables). Adds auth only; no mutation of those source systems.
import { buildAdjustmentsState, type AdjustmentsState } from './deposit-reconciliation.adjustments';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { AdjustmentsRepositoryPort } from './deposit-reconciliation.adjustments.repository';
import { ReconForbiddenError } from './deposit-reconciliation.service';

export class AdjustmentsReconciliationService {
  constructor(private readonly repo: AdjustmentsRepositoryPort) {}
  async getState(ctx: ReconContext): Promise<AdjustmentsState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated');
    return buildAdjustmentsState(await this.repo.listAdjustments(ctx));
  }
}
