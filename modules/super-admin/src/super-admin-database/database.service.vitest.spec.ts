// database.service.vitest.spec — BUILD_PLAN Phase 10 (E): the Database page service with an in-memory repository —
// what each action refuses, what it audits, and how a section degrades.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingAuditSink } from '@aipowersalon/audit';
import { DatabaseOpsService, DbOpsError } from './database.service';
import { SlowQueryFlusher } from './slow-query-flush.scheduler';

const ID = 'de000000-0000-4000-8000-000000000001';
function fakeRepo(over: Record<string, any> = {}) {
  const calls: string[] = [];
  const repo: any = {
    calls,
    server: async () => ({ version: 'PostgreSQL 16.15', versionNum: 160015, uptimeSeconds: 10, databaseBytes: 100, tableCount: 3, indexCount: 4,
      connections: { total: 10, active: 1, idle: 8, idleInTransaction: 1, waiting: 0, max: 100 }, blksHit: 99, blksRead: 1, deadlocks: 0, tempBytes: 0, statsResetAt: null, walBytes: 5, checkpoints: null, extensions: ['pg_trgm', 'pgcrypto'] }),
    ledger: async () => ['001_a.sql', '002_b.sql'],
    standbys: async () => ({ standbys: [], slots: 0 }),
    replicaState: async () => null,
    lastBackup: async () => { throw new Error('relation "backup_reports" does not exist'); },
    backend: async (pid: number) => (pid === 1 ? { pid: 1, backendType: 'client backend', own: true } : pid === 2 ? { pid: 2, backendType: 'autovacuum worker', own: false } : pid === 3 ? { pid: 3, backendType: 'client backend', own: false } : null),
    cancelBackend: async (pid: number) => { calls.push(`cancel ${pid}`); return true; },
    tableExists: async (t: string) => ['payments', 'customers'].includes(t),
    vacuumAnalyze: async (t: string) => { calls.push(`vacuum ${t}`); },
    deferredById: async (id: string) => (id === ID ? { id, name: 'uq_x', table: 'users', kind: 'unique', migration: '538_x.sql', reason: '2 duplicate groups', blockingRows: 2, retrySql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_x ON users (tenant_id, lower(email))', createdAt: 'x', resolvedAt: null } : null),
    runRetry: async () => { calls.push('retry'); },
    statementStats: async () => { throw new Error('pg_stat_statements must be loaded via shared_preload_libraries'); },
    slowSamples: async () => [{ hash: 'ab12cd', fingerprint: 'select 1', table: 'x', durationMs: 300, rows: 1, at: '2026-10-08T00:00:00Z' }],
    ...over,
  };
  return repo;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dbops-')); writeFileSync(join(dir, '001_a.sql'), ''); writeFileSync(join(dir, '002_b.sql'), ''); writeFileSync(join(dir, '003_c.sql'), ''); });
const A = { userId: 'u1', role: 'SUPER_ADMIN', ip: '10.0.0.1' };

describe('DatabaseOpsService', () => {
  it('overview: migration version from the ledger, pending from the files, an unreadable backups table is "unavailable", not empty', async () => {
    const svc = new DatabaseOpsService(fakeRepo(), null, { migrationsDir: dir });
    const o = await svc.overview();
    expect(o.migrations).toMatchObject({ latest: '002_b.sql', applied: 2, files: 3, pending: ['003_c.sql'], ledgerIntegrity: 'ok' });
    expect(o.backups).toMatchObject({ available: false });
    expect(o.cacheHitRatio).toBe(0.99);
    expect(o.connections.utilisation).toBe(0.1);
    expect(o.replica.configured).toBe(false);
    expect(o.extensions.pgStatStatements).toBe(false);
  });
  it('every action needs a reason of 10+ characters — and nothing runs without it', async () => {
    const repo = fakeRepo(); const svc = new DatabaseOpsService(repo, null, {});
    await expect(svc.vacuumAnalyze(A, 'payments', 'short')).rejects.toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
    await expect(svc.cancelBackend(A, 3, undefined)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(svc.retryDeferred(A, ID, '')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect(repo.calls).toEqual([]);
  });
  it('VACUUM ANALYZE: only a plain identifier that exists in the catalogue (and the registry when it is loaded); audited', async () => {
    const repo = fakeRepo(); const audit = new RecordingAuditSink();
    const svc = new DatabaseOpsService(repo, audit, {});
    await expect(svc.vacuumAnalyze(A, 'payments; drop table users', 'reason long enough')).rejects.toMatchObject({ status: 400 });
    await expect(svc.vacuumAnalyze(A, 'no_such_table', 'reason long enough')).rejects.toMatchObject({ status: 404 });
    const ok = await svc.vacuumAnalyze(A, 'payments', 'dead tuples after import');
    expect(ok).toMatchObject({ ok: true, table: 'payments' });
    expect(repo.calls).toEqual(['vacuum payments']);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ module: 'database', action: 'vacuum_analyze', resourceId: 'payments', userId: 'u1', metadata: { reason: 'dead tuples after import', table: 'payments' } });
    const reg = new DatabaseOpsService(repo, null, { allowedTables: () => new Set(['customers']) });
    await expect(reg.vacuumAnalyze(A, 'payments', 'reason long enough')).rejects.toMatchObject({ status: 404 });
  });
  it('cancel: unknown pid 404, its own backend 409, a server process 409, a client backend is cancelled and audited', async () => {
    const repo = fakeRepo(); const audit = new RecordingAuditSink(); const svc = new DatabaseOpsService(repo, audit, {});
    await expect(svc.cancelBackend(A, 99, 'blocking the board')).rejects.toMatchObject({ status: 404 });
    await expect(svc.cancelBackend(A, 1, 'blocking the board')).rejects.toMatchObject({ status: 409, code: 'OWN_BACKEND' });
    await expect(svc.cancelBackend(A, 2, 'blocking the board')).rejects.toMatchObject({ status: 409, code: 'NOT_A_CLIENT' });
    await expect(svc.cancelBackend(A, 'abc', 'blocking the board')).rejects.toMatchObject({ status: 400 });
    expect(await svc.cancelBackend(A, '3', 'blocking the board')).toEqual({ ok: true, pid: 3, cancelled: true });
    expect(repo.calls).toEqual(['cancel 3']);
    expect(audit.entries[0]).toMatchObject({ action: 'backend_cancelled', resourceId: '3' });
  });
  it('retry: runs the ledger statement when its shape is allowed; refuses others (422); a failure is "still blocked", audited', async () => {
    const repo = fakeRepo(); const audit = new RecordingAuditSink(); const svc = new DatabaseOpsService(repo, audit, {});
    expect(await svc.retryDeferred(A, ID, 'duplicates were merged')).toMatchObject({ resolved: true });
    expect(repo.calls).toEqual(['retry']);
    const bad = fakeRepo({ deferredById: async () => ({ id: ID, name: 'x', table: 't', kind: 'other', migration: 'm', reason: 'r', blockingRows: 0, retrySql: 'DROP TABLE users', createdAt: 'x', resolvedAt: null }) });
    await expect(new DatabaseOpsService(bad, null, {}).retryDeferred(A, ID, 'duplicates were merged')).rejects.toMatchObject({ status: 422, code: 'NOT_RETRYABLE' });
    expect(bad.calls).toEqual([]);
    const failing = fakeRepo({ runRetry: async () => { throw new Error('could not create unique index "uq_x"\nDETAIL: Key (email)=(a@b.c) is duplicated.'); } });
    const r = await new DatabaseOpsService(failing, audit, {}).retryDeferred(A, ID, 'duplicates were merged');
    expect(r.resolved).toBe(false);
    expect(r.message).toContain('could not create unique index');
    expect(r.message).not.toContain('a@b.c');   // the DETAIL line (row contents) never reaches the page
    expect(audit.entries.at(-1)).toMatchObject({ action: 'deferred_constraint_retried', status: 'failed' });
    await expect(svc.retryDeferred(A, 'not-a-uuid', 'duplicates were merged')).rejects.toMatchObject({ status: 404 });
  });
  it('retry goes through agent B\'s retrier when one is bound', async () => {
    const repo = fakeRepo(); const seen: string[] = [];
    const svc = new DatabaseOpsService(repo, null, {}, { retry: async (id) => { seen.push(id); return { resolved: true, message: 'validated by db-validate-constraints' }; } });
    expect(await svc.retryDeferred(A, ID, 'duplicates were merged')).toMatchObject({ resolved: true, message: 'validated by db-validate-constraints' });
    expect(seen).toEqual([ID]); expect(repo.calls).toEqual([]);
  });
  it('slow queries: pg_stat_statements absent → the app\'s own shapes, labelled', async () => {
    const r = await new DatabaseOpsService(fakeRepo(), null, {}).slowQueries();
    expect(r.source).toBe('app_telemetry');
    expect(r.note).toContain('pg_stat_statements is not available');
    expect(r.rows[0]).toMatchObject({ hash: 'ab12cd', calls: 1, meanMs: 300 });
  });
  it('no database → 503, never a fake page', async () => {
    await expect(new DatabaseOpsService(null, null, {}).overview()).rejects.toBeInstanceOf(DbOpsError);
  });
});

describe('SlowQueryFlusher', () => {
  it('writes each sample once (watermark), and purges every flush', async () => {
    const written: any[] = []; let purged = 0;
    const samples = [{ hash: 'aa11', fingerprint: 'select $?', operation: 'select', table: 'x', durationMs: 300, rows: 1, at: 1000, requestId: 'r1', tenantId: null }];
    const f = new SlowQueryFlusher({ insertSlowSamples: async (rows: any[]) => { written.push(...rows); return rows.length; }, purgeSlowSamples: async () => { purged++; return 0; } } as any, () => samples, () => 'api');
    expect(await f.flush()).toEqual({ written: 1 });
    expect(await f.flush()).toEqual({ written: 0 });
    samples.push({ ...samples[0], at: 2000 });
    expect(await f.flush()).toEqual({ written: 1 });
    expect(written.map((w) => w.at)).toEqual([1000, 2000]);
    expect(purged).toBe(3);
  });
  it('a failed write keeps the samples for the next flush', async () => {
    let fail = true; const written: any[] = [];
    const f = new SlowQueryFlusher({ insertSlowSamples: async (rows: any[]) => { if (fail) throw new Error('db down'); written.push(...rows); return rows.length; }, purgeSlowSamples: async () => 0 } as any,
      () => [{ hash: 'aa11', fingerprint: 'select $?', operation: 'select', table: 'x', durationMs: 300, rows: 1, at: 1000, requestId: null, tenantId: null }], () => null);
    await expect(f.flush()).rejects.toThrow('db down');
    fail = false;
    expect(await f.flush()).toEqual({ written: 1 });
  });
});
