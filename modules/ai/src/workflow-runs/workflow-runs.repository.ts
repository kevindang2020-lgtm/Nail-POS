// workflow-runs.repository.ts — repo contract. record() idempotent on (tenantId, dedupeKey): a retried job never
// double-counts a send (spec §23). Scope from session, never client.
import { summarizeRuns, type WorkflowRunInput, type WorkflowRunRow, type WorkflowStat } from './workflow-runs.dto';

export interface WorkflowScope { tenantId: string; branchId: string | null }
export interface WorkflowRunsRepo {
  record(e: WorkflowRunInput): Promise<{ id: string; deduped: boolean }>;
  summary(scope: WorkflowScope): Promise<Record<string, WorkflowStat>>;
}

export class InMemoryWorkflowRunsRepo implements WorkflowRunsRepo {
  public rows: WorkflowRunRow[] = [];
  async record(e: WorkflowRunInput): Promise<{ id: string; deduped: boolean }> {
    const ex = this.rows.find((r) => r.tenantId === e.tenantId && r.dedupeKey === e.dedupeKey);
    if (ex) return { id: ex.id, deduped: true };
    const row: WorkflowRunRow = { id: 'wf_' + (this.rows.length + 1), status: e.status ?? 'sent', ranAt: e.ranAt ?? new Date().toISOString(), ...e } as WorkflowRunRow;
    this.rows.push(row); return { id: row.id, deduped: false };
  }
  async summary(scope: WorkflowScope): Promise<Record<string, WorkflowStat>> {
    return summarizeRuns(this.rows.filter((r) => r.tenantId === scope.tenantId && (!scope.branchId || r.branchId === scope.branchId || r.branchId == null)));
  }
}
