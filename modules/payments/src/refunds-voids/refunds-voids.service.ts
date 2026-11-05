// refunds-voids.service.ts — money-reversal overview (refunds + voids). Read-only.
import { buildRefundsVoidsSummary, type RefundsVoidsContext, type RefundsVoidsState } from './refunds-voids.dto';
import type { RefundsVoidsRepositoryPort } from './refunds-voids.repository';

export class RefundsVoidsForbiddenError extends Error {}

export class RefundsVoidsService {
  constructor(private readonly repo: RefundsVoidsRepositoryPort) {}
  async getState(ctx: RefundsVoidsContext): Promise<RefundsVoidsState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new RefundsVoidsForbiddenError('Not authenticated');
    const rows = await this.repo.list(ctx);
    return { kpis: buildRefundsVoidsSummary(rows), rows };
  }
}
