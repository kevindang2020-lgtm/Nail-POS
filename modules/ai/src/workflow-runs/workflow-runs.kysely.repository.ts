// workflow-runs.kysely.repository.ts — Postgres WorkflowRunsRepo. Idempotent insert (ON CONFLICT do nothing).
// Tenant/branch scoped from session, never client.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { WorkflowRunsRepo, WorkflowScope } from './workflow-runs.repository';
import { summarizeRuns, type WorkflowRunInput, type WorkflowRunRow, type WorkflowStat } from './workflow-runs.dto';

export class KyselyWorkflowRunsRepo implements WorkflowRunsRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async record(e: WorkflowRunInput): Promise<{ id: string; deduped: boolean }> {
    const r: any = await sql`
      insert into workflow_runs (tenant_id, branch_id, workflow_key, dedupe_key, status, customer_id, appointment_id, detail, ran_at)
      values (${e.tenantId}, ${e.branchId ?? null}, ${e.workflowKey}, ${e.dedupeKey}, ${e.status ?? 'sent'},
        ${e.customerId ?? null}, ${e.appointmentId ?? null}, ${e.detail ?? null}, ${e.ranAt ?? new Date().toISOString()})
      on conflict (tenant_id, dedupe_key) do nothing
      returning id
    `.execute(this.db as any);
    const id = r.rows?.[0]?.id;
    return { id, deduped: !id };
  }
  async summary(scope: WorkflowScope): Promise<Record<string, WorkflowStat>> {
    let q = this.db.selectFrom('workflow_runs').where('tenant_id', '=', scope.tenantId).where('ran_at', '>=', sql<Date>`now() - interval '7 days'`);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    const rows: any[] = await q.selectAll().execute().catch(() => []);
    const mapped: WorkflowRunRow[] = rows.map((x) => ({
      id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, workflowKey: x.workflow_key, dedupeKey: x.dedupe_key,
      status: x.status, customerId: x.customer_id, appointmentId: x.appointment_id, detail: x.detail,
      ranAt: typeof x.ran_at === 'string' ? x.ran_at : new Date(x.ran_at).toISOString(),
    }));
    return summarizeRuns(mapped);
  }
}
