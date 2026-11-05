import { describe, it, expect } from 'vitest';
import { SyncEngineService, type SyncSink } from './sync-engine.service';
import { defaultAdapterFactory } from './adapters/provider-registry';

// In-memory doubles — the pgtest proves the engine on real Postgres; this gives fast unit coverage of the branches.
function doubles() {
  const conns: Record<string, any> = {};
  const jobs: Record<string, any> = {};
  const cursors: Record<string, string | null> = {};
  const ledger = new Set<string>();
  let seq = 0;
  const connections = {
    _conns: conns,
    add(c: any) { const id = `conn${++seq}`; conns[id] = { id, connection_status: 'active', authentication_status: 'valid', tenant_id: null, branch_id: null, ...c }; return id; },
    async getConnection(id: string) { return conns[id]; },
    async patchConnection(id: string, p: any) { Object.assign(conns[id], p); },
  };
  const repo = {
    _jobs: jobs, _ledger: ledger,
    async createJob(i: any) { if (i.idempotencyKey) { const ex = Object.values(jobs).find((j: any) => j.connection_id === i.connectionId && j.sync_type === i.syncType && j.idempotency_key === i.idempotencyKey); if (ex) return { id: (ex as any).id, existing: true }; } const id = `job${++seq}`; jobs[id] = { id, connection_id: i.connectionId, tenant_id: i.tenantId ?? null, sync_type: i.syncType, status: 'queued', retry_count: 0, max_attempts: 5, idempotency_key: i.idempotencyKey ?? null, cursor_before: null, created_by_user_id: i.createdBy ?? null }; return { id, existing: false }; },
    async getJob(id: string) { return jobs[id]; },
    async setRunning(id: string, cb: string | null) { jobs[id].status = 'running'; jobs[id].cursor_before = cb; },
    async completeJob(id: string, p: any) { Object.assign(jobs[id], { status: p.status, cursor_after: p.cursorAfter, items_read: p.counts.read, items_created: p.counts.created, items_updated: p.counts.updated, items_skipped: p.counts.skipped, items_failed: p.counts.failed, failed_record_ids: p.failedRecordIds, error_category: p.errorCategory }); },
    async incrementRetry(id: string) { jobs[id].retry_count++; jobs[id].status = 'running'; jobs[id].sync_type = 'retry'; return jobs[id].retry_count; },
    async markDead(id: string) { jobs[id].status = 'dead'; },
    async getCursor(cid: string) { return cursors[cid] ?? null; },
    async setCursor(cid: string, _t: string, v: string | null) { cursors[cid] = v; },
    async ledgerHas(cid: string, rid: string) { return ledger.has(`${cid}:${rid}`); },
    async ledgerInsert(cid: string, _t: any, rid: string) { const k = `${cid}:${rid}`; if (ledger.has(k)) return false; ledger.add(k); return true; },
    async listJobs(cid: string) { return Object.values(jobs).filter((j: any) => j.connection_id === cid); },
    async dueQueuedJobs() { return Object.values(jobs).filter((j: any) => j.status === 'queued'); },
  };
  return { connections, repo };
}

describe('SyncEngineService', () => {
  it('rejects enqueue for disabled / bad-auth / non-sync providers', async () => {
    const { connections, repo } = doubles();
    const eng = new SyncEngineService(repo as any, connections as any, undefined);
    const disabled = connections.add({ provider_key: 'quickbooks', category: 'Accounting', connection_status: 'disabled' });
    expect((await eng.enqueueSync({}, disabled, {})).error).toBe('connection_disabled');
    const badAuth = connections.add({ provider_key: 'quickbooks', category: 'Accounting', authentication_status: 'expired' });
    expect((await eng.enqueueSync({}, badAuth, {})).error).toBe('authentication_required');
    const twilio = connections.add({ provider_key: 'twilio', category: 'Communication' });
    expect((await eng.enqueueSync({}, twilio, {})).error).toBe('sync_not_supported');
  });

  it('runs a full sync then is idempotent on re-run', async () => {
    const { connections, repo } = doubles();
    const eng = new SyncEngineService(repo as any, connections as any, undefined);
    const c = connections.add({ provider_key: 'quickbooks', category: 'Accounting' });
    const e1: any = await eng.enqueueSync({}, c, { syncType: 'full' }); expect(e1.status).toBe(202);
    const r1: any = await eng.runJob(e1.jobId); expect(r1.jobStatus).toBe('successful'); expect(r1.counts.created).toBe(5);
    const e2: any = await eng.enqueueSync({}, c, { syncType: 'full', idempotencyKey: 'again' });
    const r2: any = await eng.runJob(e2.jobId); expect(r2.counts.created).toBe(0); expect(r2.counts.skipped).toBe(5);
    expect(repo._ledger.size).toBe(5);
  });

  it('partial failure → targeted retry applies only the failed record', async () => {
    const { connections, repo } = doubles();
    let failRec2 = true;
    const sink: SyncSink = async (rec) => { if (rec.providerRecordId === 'rec-2' && failRec2) throw new Error('x'); return { action: 'created' }; };
    const eng = new SyncEngineService(repo as any, connections as any, undefined, defaultAdapterFactory, { xero: sink });
    const c = connections.add({ provider_key: 'xero', category: 'Accounting' });
    const e: any = await eng.enqueueSync({}, c, { syncType: 'full' });
    const r: any = await eng.runJob(e.jobId); expect(r.jobStatus).toBe('partial'); expect(r.counts.created).toBe(4); expect(r.counts.failed).toBe(1);
    failRec2 = false;
    const retry: any = await eng.retrySyncJob({}, e.jobId);
    expect(retry.jobStatus).toBe('successful'); expect(retry.counts.created).toBe(1); expect(retry.counts.skipped).toBe(4);
    expect(repo._ledger.size).toBe(5);
  });

  it('moves a permanently failing job to the dead-letter queue', async () => {
    const { connections, repo } = doubles();
    const sink: SyncSink = async () => { throw new Error('always'); };
    const eng = new SyncEngineService(repo as any, connections as any, undefined, defaultAdapterFactory, { clover: sink });
    const c = connections.add({ provider_key: 'clover', category: 'Payments' });
    const e: any = await eng.enqueueSync({}, c, { syncType: 'full' });
    repo._jobs[e.jobId].max_attempts = 1;
    await eng.runJob(e.jobId);
    const dead: any = await eng.retrySyncJob({}, e.jobId);
    expect(dead.jobStatus).toBe('dead');
  });

  it('a disabled connection stops a queued job at run time', async () => {
    const { connections, repo } = doubles();
    const eng = new SyncEngineService(repo as any, connections as any, undefined);
    const c = connections.add({ provider_key: 'quickbooks', category: 'Accounting' });
    const e: any = await eng.enqueueSync({}, c, { syncType: 'full' });
    connections._conns[c].connection_status = 'disabled';
    const r: any = await eng.runJob(e.jobId); expect(r.jobStatus).toBe('failed'); expect(r.errorCategory).toBe('Integration Disabled');
  });
});
