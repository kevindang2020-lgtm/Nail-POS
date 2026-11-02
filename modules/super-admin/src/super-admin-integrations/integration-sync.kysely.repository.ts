// integration-sync.kysely.repository.ts — raw-SQL persistence for the sync engine: jobs, cursors, and the
// idempotency ledger. The ledger's UNIQUE (connection_id, provider_record_id) is what makes re-running a sync safe.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export type JobCounts = { read: number; created: number; updated: number; skipped: number; failed: number };

export class IntegrationSyncRepo {
  constructor(private readonly db: Kysely<DB>) {}

  // Create a queued job; if an idempotency key collides with an existing job for this connection+type, return that
  // existing job instead of creating a duplicate.
  async createJob(i: { connectionId: string; tenantId?: string | null; branchId?: string | null; syncType: string; idempotencyKey?: string | null; correlationId: string; createdBy?: string | null }): Promise<{ id: string; existing: boolean }> {
    if (i.idempotencyKey) {
      const dup: any = await sql<any>`select id::text as id from integration_sync_jobs where connection_id = ${i.connectionId}::uuid and sync_type = ${i.syncType} and idempotency_key = ${i.idempotencyKey} limit 1`.execute(this.db);
      if (dup.rows[0]) return { id: dup.rows[0].id, existing: true };
    }
    const r: any = await sql<any>`insert into integration_sync_jobs (connection_id, tenant_id, branch_id, sync_type, idempotency_key, correlation_id, created_by_user_id)
      values (${i.connectionId}::uuid, ${i.tenantId ?? null}::uuid, ${i.branchId ?? null}::uuid, ${i.syncType}, ${i.idempotencyKey ?? null}, ${i.correlationId}::uuid, ${i.createdBy ?? null}::uuid)
      returning id::text as id`.execute(this.db);
    return { id: r.rows[0].id, existing: false };
  }

  async getJob(id: string): Promise<any | undefined> {
    const r: any = await sql<any>`select id::text as id, connection_id::text as connection_id, tenant_id::text as tenant_id, branch_id::text as branch_id,
      sync_type, status, cursor_before, cursor_after, items_read, items_created, items_updated, items_skipped, items_failed,
      idempotency_key, retry_count, max_attempts, failed_record_ids, error_category, error_message, correlation_id::text as correlation_id,
      to_char(started_at,'YYYY-MM-DD"T"HH24:MI:SS') as started_at, to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS') as completed_at
      from integration_sync_jobs where id = ${id}::uuid`.execute(this.db);
    return r.rows[0];
  }

  async setRunning(id: string, cursorBefore: string | null): Promise<void> {
    await sql`update integration_sync_jobs set status = 'running', cursor_before = ${cursorBefore}, started_at = coalesce(started_at, now()), updated_at = now() where id = ${id}::uuid`.execute(this.db);
  }

  async completeJob(id: string, p: { status: string; cursorAfter: string | null; counts: JobCounts; failedRecordIds: string[]; errorCategory?: string | null; errorMessage?: string | null }): Promise<void> {
    await sql`update integration_sync_jobs set status = ${p.status}, cursor_after = ${p.cursorAfter},
      items_read = ${p.counts.read}, items_created = ${p.counts.created}, items_updated = ${p.counts.updated}, items_skipped = ${p.counts.skipped}, items_failed = ${p.counts.failed},
      failed_record_ids = ${p.failedRecordIds}, error_category = ${p.errorCategory ?? null}, error_message = ${p.errorMessage ?? null},
      completed_at = now(), updated_at = now() where id = ${id}::uuid`.execute(this.db);
  }

  async incrementRetry(id: string): Promise<number> {
    const r: any = await sql<any>`update integration_sync_jobs set retry_count = retry_count + 1, status = 'running', sync_type = 'retry', started_at = now(), updated_at = now() where id = ${id}::uuid returning retry_count`.execute(this.db);
    return n(r.rows[0]?.retry_count);
  }

  async markDead(id: string, errorCategory: string | null, errorMessage: string | null): Promise<void> {
    await sql`update integration_sync_jobs set status = 'dead', error_category = ${errorCategory}, error_message = ${errorMessage}, next_attempt_at = null, updated_at = now() where id = ${id}::uuid`.execute(this.db);
  }

  async getCursor(connectionId: string, syncType: string): Promise<string | null> {
    const r: any = await sql<any>`select cursor_value from integration_sync_cursors where connection_id = ${connectionId}::uuid and sync_type = ${syncType}`.execute(this.db);
    return r.rows[0]?.cursor_value ?? null;
  }

  async setCursor(connectionId: string, syncType: string, value: string | null): Promise<void> {
    await sql`insert into integration_sync_cursors (connection_id, sync_type, cursor_value, updated_at) values (${connectionId}::uuid, ${syncType}, ${value}, now())
      on conflict (connection_id, sync_type) do update set cursor_value = ${value}, updated_at = now()`.execute(this.db);
  }

  async ledgerHas(connectionId: string, providerRecordId: string): Promise<boolean> {
    const r: any = await sql<any>`select 1 from integration_sync_records where connection_id = ${connectionId}::uuid and provider_record_id = ${providerRecordId} limit 1`.execute(this.db);
    return !!r.rows[0];
  }

  // Idempotent insert — returns true only if this record was newly recorded (ON CONFLICT DO NOTHING).
  async ledgerInsert(connectionId: string, tenantId: string | null, providerRecordId: string, jobId: string, action: string): Promise<boolean> {
    const r: any = await sql<any>`insert into integration_sync_records (connection_id, tenant_id, provider_record_id, last_sync_job_id, action)
      values (${connectionId}::uuid, ${tenantId ?? null}::uuid, ${providerRecordId}, ${jobId}::uuid, ${action})
      on conflict (connection_id, provider_record_id) do nothing returning id`.execute(this.db);
    return (r.rows?.length ?? 0) > 0;
  }

  async listJobs(connectionId: string, limit = 20): Promise<any[]> {
    const r: any = await sql<any>`select id::text as id, sync_type, status, items_read, items_created, items_skipped, items_failed, retry_count,
      error_category, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') as created_at, to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS') as completed_at
      from integration_sync_jobs where connection_id = ${connectionId}::uuid order by created_at desc limit ${Math.min(200, Math.max(1, limit))}`.execute(this.db);
    return r.rows ?? [];
  }

  async dueQueuedJobs(limit: number): Promise<any[]> {
    const r: any = await sql<any>`select id::text as id from integration_sync_jobs where status = 'queued' order by created_at asc limit ${Math.min(100, Math.max(1, limit))}`.execute(this.db);
    return r.rows ?? [];
  }
}
