// workflow-runs.service.ts — records automation runs idempotently and serves per-workflow stats. Producers
// (campaigns / communications / end-of-day-followups) call record() with a stable dedupeKey (e.g. workflowKey+target+day).
import type { WorkflowRunsRepo, WorkflowScope } from './workflow-runs.repository';
import type { WorkflowRunInput, WorkflowStat } from './workflow-runs.dto';

export class WorkflowRunsService {
  constructor(private readonly repo: WorkflowRunsRepo) {}
  record(tenantId: string, branchId: string | null, e: Omit<WorkflowRunInput, 'tenantId'>) {
    if (!e.dedupeKey || !e.workflowKey) throw Object.assign(new Error('workflow_key_and_dedupe_required'), { status: 400 });
    return this.repo.record({ ...e, tenantId, branchId: e.branchId ?? branchId });
  }
  summary(scope: WorkflowScope): Promise<Record<string, WorkflowStat>> { return this.repo.summary(scope); }
}
