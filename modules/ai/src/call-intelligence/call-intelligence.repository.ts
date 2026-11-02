// call-intelligence.repository.ts — repo contract. record() is idempotent on (tenantId, providerCallId): a re-delivered
// telephony webhook updates the existing row instead of inserting a duplicate (spec §13). Scope from session, never client.
import { summarize, type CallEventInput, type CallEventRow, type CallIntelSummary } from './call-intelligence.dto';

export interface CallIntelScope { tenantId: string; branchId: string | null; }
export interface CallIntelRepo {
  record(e: CallEventInput): Promise<{ id: string; deduped: boolean }>;
  summary(scope: CallIntelScope): Promise<CallIntelSummary>;
  listRecent(scope: CallIntelScope, limit: number): Promise<CallEventRow[]>;
}

export class InMemoryCallIntelRepo implements CallIntelRepo {
  public rows: CallEventRow[] = [];
  async record(e: CallEventInput): Promise<{ id: string; deduped: boolean }> {
    const existing = this.rows.find((r) => r.tenantId === e.tenantId && r.providerCallId === e.providerCallId);
    if (existing) { Object.assign(existing, e); return { id: existing.id, deduped: true }; }
    const row: CallEventRow = {
      id: 'call_' + (this.rows.length + 1), direction: e.direction ?? 'inbound', aiHandled: e.aiHandled ?? false,
      durationSeconds: e.durationSeconds ?? 0, outcome: e.outcome ?? 'no_action', startedAt: e.startedAt ?? new Date().toISOString(), ...e,
    } as CallEventRow;
    this.rows.push(row); return { id: row.id, deduped: false };
  }
  async summary(scope: CallIntelScope): Promise<CallIntelSummary> {
    return summarize(this.rows.filter((r) => r.tenantId === scope.tenantId && (!scope.branchId || r.branchId === scope.branchId || r.branchId == null)));
  }
  async listRecent(scope: CallIntelScope, limit: number): Promise<CallEventRow[]> {
    return this.rows
      .filter((r) => r.tenantId === scope.tenantId && (!scope.branchId || r.branchId === scope.branchId || r.branchId == null))
      .slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, Math.max(1, Math.min(200, limit)));
  }
}
