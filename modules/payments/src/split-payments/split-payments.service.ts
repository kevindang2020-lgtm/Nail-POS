// split-payments.service.ts — read-only split-tender view.
import { buildSplitTickets, buildSplitSummary, type SplitPaymentsContext, type SplitPaymentsState } from './split-payments.dto';
import type { SplitPaymentsRepositoryPort } from './split-payments.repository';
export class SplitPaymentsForbiddenError extends Error {}
export class SplitPaymentsService {
  constructor(private readonly repo: SplitPaymentsRepositoryPort) {}
  async getState(ctx: SplitPaymentsContext): Promise<SplitPaymentsState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new SplitPaymentsForbiddenError('Not authenticated');
    const payments = await this.repo.listPayments(ctx);
    const tickets = buildSplitTickets(payments);
    return { kpis: buildSplitSummary(tickets), tickets };
  }
}
