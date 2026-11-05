// operations.repository.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the api_operations table (migration 553).
// Every read is scoped by realm AND tenant (a salon's request also runs under row-level security), so another salon's
// operation is simply not found. State changes are conditional updates (`where status = …`): two workers never both run
// one export, and a late worker never overwrites a finished operation.
import { sql } from 'kysely';
import type { OperationRealm } from '@aipowersalon/api-contracts';
import { OPERATION_TTL_MS } from './async-export.core';
import { canMoveToSql } from '@aipowersalon/database';
import { API_OPERATION } from './operation-lifecycle';

export interface NewOperation {
  tenantId: string | null; branchId: string | null; realm: OperationRealm; actorUserId: string; actorRole: string;
  kind: string; route: string; permission: string | null;
  params: { query: Record<string, unknown>; path: Record<string, string> };
  principal: { permissions: string[] };
}
export interface OperationResultMeta { filename: string; contentType: string; bytes: number; rows?: number; shape?: unknown }

export class OperationsRepository {
  constructor(private readonly db: any) {}

  async create(op: NewOperation): Promise<string> {
    const r: any = await sql`insert into api_operations (tenant_id, branch_id, realm, actor_user_id, actor_role, kind, route, permission, params, principal)
      values (${op.tenantId}, ${op.branchId}, ${op.realm}, ${op.actorUserId}, ${op.actorRole}, ${op.kind}, ${op.route}, ${op.permission},
              ${JSON.stringify(op.params)}::jsonb, ${JSON.stringify(op.principal)}::jsonb)
      returning id`.execute(this.db);
    return String(r.rows[0].id);
  }
  async setJob(id: string, tenantId: string | null, jobId: string): Promise<void> {
    await sql`update api_operations set job_id = ${jobId}, updated_at = now() where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`}`.execute(this.db);
  }

  /** The worker's read: the operation the job names, in the salon the job was enqueued FOR (jobs.tenant_id). */
  async byId(id: string, tenantId: string | null): Promise<any | null> {
    const r: any = await sql`select * from api_operations where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`}`.execute(this.db);
    return r.rows[0] ?? null;
  }

  /** A realm's read: the realm, and the salon (a platform operation has none). Not found ≠ forbidden. */
  async find(id: string, realm: OperationRealm, tenantId: string | null): Promise<any | null> {
    const r: any = await sql`select * from api_operations where id = ${id} and realm = ${realm}
      and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`}`.execute(this.db);
    return r.rows[0] ?? null;
  }
  async list(realm: OperationRealm, tenantId: string | null, actorUserId: string | null, limit = 50, f: { status?: string; kind?: string } = {}): Promise<any[]> {
    const r: any = await sql`select * from api_operations where ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`}
      and realm = ${realm} ${actorUserId ? sql`and actor_user_id = ${actorUserId}` : sql``}
      ${f.status ? sql`and status = ${f.status}` : sql``} ${f.kind ? sql`and kind = ${f.kind}` : sql``}
      order by created_at desc limit ${Math.max(1, Math.min(200, limit))}`.execute(this.db);
    return r.rows;
  }

  /** queued → running. A retry of the same job (its worker died) may take a `running` one back. false = someone else has it
   *  or it is finished: do nothing. */
  async claim(id: string, tenantId: string | null, allowRetake: boolean): Promise<boolean> {
    const r: any = await sql`update api_operations set status = 'running', started_at = coalesce(started_at, now()), progress = 0, updated_at = now()
      where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`} and (status = 'queued' ${allowRetake ? sql`or status = 'running'` : sql``}) and ${canMoveToSql(API_OPERATION, 'running')} returning id`.execute(this.db);
    return r.rows.length === 1;
  }
  async succeed(id: string, tenantId: string | null, key: string, meta: OperationResultMeta, ttlMs = OPERATION_TTL_MS): Promise<boolean> {
    const r: any = await sql`update api_operations set status = 'succeeded', progress = 100, result_key = ${key}, result_meta = ${JSON.stringify(meta)}::jsonb,
        finished_at = now(), expires_at = now() + ${`${ttlMs} milliseconds`}::interval, error = null, updated_at = now()
      where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`} and status = 'running' and ${canMoveToSql(API_OPERATION, 'succeeded')} returning id`.execute(this.db);
    return r.rows.length === 1;
  }
  async fail(id: string, tenantId: string | null, error: { code: string; message: string }): Promise<boolean> {
    const r: any = await sql`update api_operations set status = 'failed', error = ${JSON.stringify(error)}::jsonb, finished_at = now(), updated_at = now()
      where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`} and status in ('queued', 'running') and ${canMoveToSql(API_OPERATION, 'failed')} returning id`.execute(this.db);
    return r.rows.length === 1;
  }
  /** A retryable failure: back to queued (the job queue retries it with backoff). */
  async requeue(id: string, tenantId: string | null): Promise<void> {
    await sql`update api_operations set status = 'queued', updated_at = now() where id = ${id} and ${tenantId ? sql`tenant_id = ${tenantId}` : sql`tenant_id is null`} and status = 'running' and ${canMoveToSql(API_OPERATION, 'queued')}`.execute(this.db);
  }
}
