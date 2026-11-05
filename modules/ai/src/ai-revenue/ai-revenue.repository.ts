// ai-revenue.repository.ts — repo contract. record() is idempotent on (tenantId, dedupeKey): the same accepted AI
// suggestion is never double-counted (spec §19/§35). Scope from session, never client.
import { summarizeRevenue, type RevenueAttributionInput, type RevenueAttributionRow, type AiRevenueSummary } from './ai-revenue.dto';

export interface AiRevenueScope { tenantId: string; branchId: string | null }
export interface AiRevenueRepo {
  record(e: RevenueAttributionInput): Promise<{ id: string; deduped: boolean }>;
  summary(scope: AiRevenueScope): Promise<AiRevenueSummary>;
}

export class InMemoryAiRevenueRepo implements AiRevenueRepo {
  public rows: RevenueAttributionRow[] = [];
  async record(e: RevenueAttributionInput): Promise<{ id: string; deduped: boolean }> {
    const ex = this.rows.find((r) => r.tenantId === e.tenantId && r.dedupeKey === e.dedupeKey);
    if (ex) { return { id: ex.id, deduped: true }; }
    const row: RevenueAttributionRow = { id: 'rev_' + (this.rows.length + 1), kind: e.kind ?? 'upsell', acceptedAt: e.acceptedAt ?? new Date().toISOString(), ...e } as RevenueAttributionRow;
    this.rows.push(row); return { id: row.id, deduped: false };
  }
  async summary(scope: AiRevenueScope): Promise<AiRevenueSummary> {
    return summarizeRevenue(this.rows.filter((r) => r.tenantId === scope.tenantId && (!scope.branchId || r.branchId === scope.branchId || r.branchId == null)));
  }
}
