// ai-revenue.service.ts — records AI-influenced revenue idempotently and serves the summary. Producer = the
// AI-suggestion-accept path at checkout calling record() with a stable dedupeKey (e.g. the ticket_service_line id).
import type { AiRevenueRepo, AiRevenueScope } from './ai-revenue.repository';
import type { RevenueAttributionInput, AiRevenueSummary } from './ai-revenue.dto';

export class AiRevenueService {
  constructor(private readonly repo: AiRevenueRepo) {}
  record(tenantId: string, branchId: string | null, e: Omit<RevenueAttributionInput, 'tenantId'>) {
    if (!e.dedupeKey) throw Object.assign(new Error('dedupe_key_required'), { status: 400 });
    if (!(e.amountCents >= 0)) throw Object.assign(new Error('amount_cents_invalid'), { status: 400 });
    return this.repo.record({ ...e, tenantId, branchId: e.branchId ?? branchId });
  }
  summary(scope: AiRevenueScope): Promise<AiRevenueSummary> { return this.repo.summary(scope); }
}
