// sync-engine.service.ts — the synchronization engine. Enqueue creates a bounded job (never runs unbounded work in a
// request); a worker/scheduler drains the queue via drainDueJobs, or an operator triggers a bounded drain. runJob is
// the pipeline: resolve connection → verify status + auth + sync capability → load cursor (full ignores it) → fetch
// bounded pages via the adapter → for each record, idempotency-check the ledger (skip if seen) else write through the
// pluggable domain SINK and record it → advance the cursor ONLY on clean success → persist counts + status. Retrying
// re-fetches and skips already-recorded records (no duplication) and re-attempts only the previously-failed ones;
// exhausting max_attempts moves the job to the dead-letter state. Every enqueue/retry/complete is audited.

import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { IntegrationSyncRepo } from './integration-sync.kysely.repository';
import { IntegrationConnectionsRepo } from './integration-connections.kysely.repository';
import { defaultAdapterFactory, getProvider, type AdapterFactory } from './adapters/provider-registry';
import type { SyncRecord } from './adapters/adapter.contract';
import type { ProviderReliabilityService } from './provider-reliability.service';

type Actor = { id?: string; role?: string };
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const MAX_PAGES = 20; const PAGE_SIZE = 100;

// A domain sink applies one validated provider record through an approved domain service. It returns the action or
// throws to signal a (retryable) write failure. Providers with no configured sink use the validating default (which
// records the record in the ledger but performs no domain write) — real domain wiring drops in per category/provider.
export type SyncSink = (record: SyncRecord, ctx: { connectionId: string; tenantId: string | null; providerKey: string }) => Promise<{ action: 'created' | 'updated' }>;
const validatingSink: SyncSink = async () => ({ action: 'created' });

export class SyncEngineService {
  constructor(
    private readonly repo?: IntegrationSyncRepo,
    private readonly connections?: IntegrationConnectionsRepo,
    private readonly db?: any,
    private readonly adapters: AdapterFactory = defaultAdapterFactory,
    private readonly sinks: Record<string, SyncSink> = {},
    private readonly guard?: ProviderReliabilityService,
  ) {}

  private sinkFor(providerKey: string, category: string): SyncSink { return this.sinks[providerKey] ?? this.sinks[category] ?? validatingSink; }

  private async audit(actor: Actor, action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>) {
    if (!this.db) return;
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${tenantId ?? null}::uuid, ${actor.id ?? null}::uuid, 'SUPER_ADMIN', ${action}, 'integration_sync_job', ${entityId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db).catch(() => undefined);
  }

  async enqueueSync(actor: Actor, connectionId?: string, input: { syncType?: string; idempotencyKey?: string } = {}) {
    if (!this.repo || !this.connections) return fail('unavailable', 503);
    const conn = connectionId ? await this.connections.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    if (conn.connection_status === 'disabled' || conn.connection_status === 'compromised' || conn.connection_status === 'retired') return fail('connection_disabled', 409);
    if (conn.authentication_status !== 'valid') return fail('authentication_required', 409);
    const prov = getProvider(conn.provider_key);
    if (!prov?.syncCapable) return fail('sync_not_supported', 400);
    const syncType = ['full', 'incremental', 'scheduled', 'manual', 'backfill', 'validation'].includes(String(input.syncType)) ? String(input.syncType) : 'incremental';
    const job = await this.repo.createJob({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, branchId: conn.branch_id ?? null, syncType, idempotencyKey: input.idempotencyKey ?? null, correlationId: randomUUID(), createdBy: actor.id ?? null });
    if (!job.existing) await this.audit(actor, 'super_admin_integration_sync_enqueued', job.id, conn.tenant_id ?? null, { syncType });
    return { ok: true as const, status: job.existing ? 200 : 202, jobId: job.id, jobStatus: 'queued', deduped: job.existing };
  }

  // The pipeline. Bounded by MAX_PAGES; safe to call from a worker/drain. Returns the finished job summary.
  async runJob(jobId: string): Promise<any> {
    if (!this.repo || !this.connections) return { ok: false, error: 'unavailable' };
    const job = await this.repo.getJob(jobId);
    if (!job) return { ok: false, error: 'not_found' };
    if (!['queued', 'running', 'retry'].includes(job.status) && job.sync_type !== 'retry') return { ok: false, error: 'not_runnable', status: job.status };
    const conn = await this.connections.getConnection(job.connection_id);
    // Guards — a disabled connection stops queued work; bad auth / no sync capability fail with a classified error.
    if (!conn) { await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: job.cursor_before ?? null, counts: { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 }, failedRecordIds: [], errorCategory: 'Invalid Configuration', errorMessage: 'connection missing' }); return { ok: false, jobStatus: 'failed' }; }
    if (['disabled', 'compromised', 'retired'].includes(conn.connection_status)) { await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: job.cursor_before ?? null, counts: { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 }, failedRecordIds: [], errorCategory: 'Integration Disabled', errorMessage: 'connection disabled' }); return { ok: false, jobStatus: 'failed', errorCategory: 'Integration Disabled' }; }
    if (conn.authentication_status !== 'valid') { await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: job.cursor_before ?? null, counts: { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 }, failedRecordIds: [], errorCategory: 'Access Token Expired', errorMessage: 'authentication not valid' }); return { ok: false, jobStatus: 'failed', errorCategory: 'Access Token Expired' }; }
    const prov = getProvider(conn.provider_key); const adapter = this.adapters(conn.provider_key);
    if (!prov?.syncCapable || !adapter?.fetchSyncPage) { await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: job.cursor_before ?? null, counts: { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 }, failedRecordIds: [], errorCategory: 'Feature Not Enabled', errorMessage: 'sync not supported' }); return { ok: false, jobStatus: 'failed', errorCategory: 'Feature Not Enabled' }; }

    const isFull = job.sync_type === 'full' || job.sync_type === 'backfill';
    const startCursor = isFull ? null : await this.repo.getCursor(conn.id, 'incremental');
    await this.repo.setRunning(jobId, startCursor);
    const sink = this.sinkFor(conn.provider_key, conn.category);
    const counts = { read: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    const failedIds: string[] = [];
    let cursor = startCursor; let pages = 0; let lastCursor = startCursor;
    try {
      while (pages < MAX_PAGES) {
        let page;
        if (this.guard) {
          const g = await this.guard.run({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, providerKey: conn.provider_key, operation: 'sync.fetch' }, () => adapter.fetchSyncPage!({ cursor, syncType: job.sync_type, limit: PAGE_SIZE }));
          if (!g.ok) {
            await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: startCursor, counts, failedRecordIds: failedIds, errorCategory: g.errorCategory ?? 'Provider Unavailable', errorMessage: g.error ?? g.blocked ?? 'guard blocked' });
            await this.connections.patchConnection(conn.id, { sync_status: 'failed' });
            return { ok: false, jobStatus: 'failed', errorCategory: g.errorCategory ?? 'Provider Unavailable', counts };
          }
          page = g.result!;
        } else {
          page = await adapter.fetchSyncPage({ cursor, syncType: job.sync_type, limit: PAGE_SIZE });
        }
        pages++;
        for (const rec of page.records) {
          counts.read++;
          if (await this.repo.ledgerHas(conn.id, rec.providerRecordId)) { counts.skipped++; continue; }
          try {
            const res = await sink(rec, { connectionId: conn.id, tenantId: conn.tenant_id ?? null, providerKey: conn.provider_key });
            const inserted = await this.repo.ledgerInsert(conn.id, conn.tenant_id ?? null, rec.providerRecordId, jobId, res.action);
            if (inserted) { if (res.action === 'updated') counts.updated++; else counts.created++; } else counts.skipped++;
          } catch (e: any) { counts.failed++; failedIds.push(rec.providerRecordId); }
        }
        lastCursor = page.nextCursor;
        if (!page.hasMore) { cursor = page.nextCursor; break; }
        cursor = page.nextCursor;
      }
    } catch (e: any) {
      await this.repo.completeJob(jobId, { status: 'failed', cursorAfter: startCursor, counts, failedRecordIds: failedIds, errorCategory: 'Provider Unavailable', errorMessage: adapter.normalizeError(e) });
      await this.connections.patchConnection(conn.id, { sync_status: 'failed' });
      return { ok: false, jobStatus: 'failed', errorCategory: 'Provider Unavailable', counts };
    }

    const status = counts.failed === 0 ? 'successful' : counts.created + counts.updated > 0 ? 'partial' : 'failed';
    // advance the cursor ONLY on a clean success (partial/failed leaves it so a retry re-fetches; the ledger prevents
    // reprocessing the records that already succeeded).
    const cursorAfter = status === 'successful' ? lastCursor : startCursor;
    if (status === 'successful') await this.repo.setCursor(conn.id, 'incremental', lastCursor);
    await this.repo.completeJob(jobId, { status, cursorAfter, counts, failedRecordIds: failedIds, errorCategory: status === 'successful' ? null : 'Downstream Write Failed', errorMessage: status === 'successful' ? null : `${counts.failed} record(s) failed` });
    await this.connections.patchConnection(conn.id, { sync_status: status === 'successful' ? 'successful' : status });
    if (status === 'successful') await sql`update integration_connections set last_successful_sync_at = now(), updated_at = now() where id = ${conn.id}::uuid`.execute(this.db).catch(() => undefined);
    else await sql`update integration_connections set last_failed_sync_at = now(), updated_at = now() where id = ${conn.id}::uuid`.execute(this.db).catch(() => undefined);
    await this.audit({ id: job.created_by_user_id }, 'super_admin_integration_sync_completed', jobId, conn.tenant_id ?? null, { status, ...counts });
    return { ok: status === 'successful', jobStatus: status, counts, failedRecordIds: failedIds };
  }

  async retrySyncJob(actor: Actor, jobId?: string) {
    if (!this.repo) return fail('unavailable', 503);
    const job = jobId ? await this.repo.getJob(String(jobId)) : undefined;
    if (!job) return fail('not_found', 404);
    if (!['partial', 'failed'].includes(job.status)) return fail('not_retryable', 409);
    if (job.retry_count >= job.max_attempts) { await this.repo.markDead(job.id, job.error_category ?? 'Downstream Write Failed', 'max attempts exhausted'); await this.audit(actor, 'super_admin_integration_sync_retry', job.id, job.tenant_id ?? null, { result: 'dead' }); return { ok: false as const, error: 'dead_letter', status: 409, jobStatus: 'dead' }; }
    const rc = await this.repo.incrementRetry(job.id);
    const res = await this.runJob(job.id);
    // if still not successful and we're now out of attempts, move to dead-letter
    if (res.jobStatus !== 'successful' && rc >= job.max_attempts) { await this.repo.markDead(job.id, 'Downstream Write Failed', 'max attempts exhausted'); await this.audit(actor, 'super_admin_integration_sync_retry', job.id, job.tenant_id ?? null, { result: 'dead', retry: rc }); return { ok: false as const, error: 'dead_letter', status: 409, jobStatus: 'dead' }; }
    await this.audit(actor, 'super_admin_integration_sync_retry', job.id, job.tenant_id ?? null, { result: res.jobStatus, retry: rc });
    return { ok: res.jobStatus === 'successful', status: 200, jobStatus: res.jobStatus, retryCount: rc, counts: res.counts };
  }

  // Bounded drain — a worker/scheduler (or an operator action) processes up to `limit` queued jobs. Not unbounded.
  async drainDueJobs(actor: Actor, limit = 10) {
    if (!this.repo) return fail('unavailable', 503);
    const due = await this.repo.dueQueuedJobs(Math.min(50, Math.max(1, limit)));
    const results: any[] = [];
    for (const j of due) results.push({ jobId: j.id, ...(await this.runJob(j.id)) });
    return { ok: true as const, status: 200, processed: results.length, results };
  }

  async listSyncJobs(_actor: Actor, connectionId?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503, jobs: [] as any[] };
    if (!connectionId) return { ok: false as const, error: 'connection_required', status: 400, jobs: [] as any[] };
    return { ok: true as const, status: 200, jobs: await this.repo.listJobs(String(connectionId)) };
  }
}
