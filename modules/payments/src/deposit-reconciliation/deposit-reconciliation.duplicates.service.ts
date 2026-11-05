// deposit-reconciliation.duplicates.service.ts — read-only duplicate detection over the tenant's settlements and
// bank deposits (both from the slice-1 repo). Auth only; the detection itself is the pure engine.
import { buildDuplicatesState, type DuplicatesState } from './deposit-reconciliation.duplicates';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { ReconRepositoryPort } from './deposit-reconciliation.repository';
import { ReconForbiddenError } from './deposit-reconciliation.service';

export class DuplicateDetectionService {
  constructor(private readonly repo: ReconRepositoryPort) {}
  async getState(ctx: ReconContext): Promise<DuplicatesState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated');
    const [settlements, deposits] = await Promise.all([this.repo.listSettlements(ctx), this.repo.listDeposits(ctx)]);
    return buildDuplicatesState(settlements, deposits);
  }
}
