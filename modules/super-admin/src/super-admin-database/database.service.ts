// database.service.ts — BUILD_PLAN Phase 10 (agent E): Super Admin → System Operations → Database (Constitution 1
// §94–98). Read-only figures plus three audited actions; no "run SQL" (§98).
//
//   overview        server version / uptime, database size, table + index counts, connections vs max_connections, cache hit
//                   ratio, deadlocks, temp bytes, checkpoints, WAL position, migration version + pending + ledger integrity,
//                   replica (configured? lag), last backup report, extensions present
//   tables          top 50 by total size: rows, dead tuples (+ bloat estimate), last (auto)vacuum / analyze, seq vs idx scans
//   indexes         unused since the stats reset (not PK / unique / constraint-backing), INVALID, duplicate definitions
//   slow-queries    pg_stat_statements when it answers; else the app's own slow-query SHAPES (db_slow_query_samples, 7 days)
//   activity        connections by application + state, transactions open > 30 s, idle in transaction, lock waits
//   schema-health   open deferred constraints (retry action), NOT VALID constraints, backfills
//   retention-runs  the retention executor's recorded runs (data_retention_purge_runs)
//   growth          90-day size series per table (db_table_size_snapshots, written by the database.size_snapshot job)
//   actions         cancel a backend / VACUUM ANALYZE a table / retry a deferred constraint — step-up (controller), a reason,
//                   an audit row (platform audit_logs: database.<action>)
// A section that cannot be read says so (DbUnavailable / a 503 for that section) — the page shows "unknown", never zero.
import { readdirSync } from 'node:fs';
import type { AuditSink } from '@aipowersalon/audit';
import type {
  DbActivity, DbCancelBackendResult, DbGrowth, DbIndexes, DbOverview, DbRetentionRuns, DbRetryConstraintResult, DbSchemaHealth, DbSlowQueries, DbTables, DbUnavailable, DbVacuumResult,
} from '@aipowersalon/api-contracts/platform';
import {
  actionReason, aggregateSlowSamples, bloatEstimateBytes, duplicateIndexGroups, growthFromSnapshots, isSafeTableName, migrationLedger, MIN_DB_ACTION_REASON, queryShape, retrySqlAllowed,
} from './database-core';
import type { KyselyDatabaseOpsRepository, DeferredRow } from './database.repository';

export class DbOpsError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 422 | 503, readonly code: string, message: string) { super(message); this.name = 'DbOpsError'; }
}
export interface DbActor { userId: string | null; role?: string | null; ip?: string | null }

/** Agent B's constraint service (db-validate-constraints logic) when the API binds it; the built-in retry otherwise. */
export interface DbConstraintRetrier { retry(id: string, actor: DbActor): Promise<{ resolved: boolean; message: string }> }
export const DB_CONSTRAINT_RETRIER = 'DbConstraintRetrier';

export interface DbOpsOptions {
  migrationsDir?: string | null;                 // where the migration files are (MIGRATIONS_DIR); null = unknown
  replicaConfigured?: boolean;                   // DATABASE_REPLICA_URL set
  allowedTables?: () => Set<string> | null;      // the ownership registry's table list when present (A); null = catalogue only
  now?: () => number;
}

const LONG_TX_SECONDS = 30;
const unavailable = (e: unknown): DbUnavailable => ({ available: false, reason: String((e as any)?.message ?? e).slice(0, 160) });

export class DatabaseOpsService {
  constructor(
    private readonly repo: KyselyDatabaseOpsRepository | null,
    private readonly audit: AuditSink | null,
    private readonly opts: DbOpsOptions = {},
    private readonly retrier: DbConstraintRetrier | null = null,
  ) {}

  private db(): KyselyDatabaseOpsRepository { if (!this.repo) throw new DbOpsError(503, 'UNAVAILABLE', 'The Database page needs the database.'); return this.repo; }
  private nowIso(): string { return new Date((this.opts.now ?? Date.now)()).toISOString(); }
  private migrationFiles(): string[] | null {
    if (!this.opts.migrationsDir) return null;
    try { return readdirSync(this.opts.migrationsDir).filter((f) => f.endsWith('.sql')).sort(); } catch { return null; }
  }

  async overview(): Promise<DbOverview> {
    const r = this.db();
    const s = await r.server();
    const files = this.migrationFiles();
    const ledger = migrationLedger(files, await r.ledger());
    const st = await r.standbys();
    let rep: { inRecovery: boolean; lagSeconds: number | null } | null = null; let note: string | null = null;
    try { rep = await r.replicaState(); } catch (e: any) { note = `the read replica did not answer: ${String(e?.message ?? e).slice(0, 120)}`; }
    if (!this.opts.replicaConfigured) note = note ?? 'No read replica is configured (DATABASE_REPLICA_URL) — reads use the primary.';
    else if (rep && !rep.inRecovery) note = note ?? 'DATABASE_REPLICA_URL answers but is not in recovery — it is not a standby.';
    let backups: DbOverview['backups'];
    try { backups = await r.lastBackup(); } catch (e) { backups = unavailable(e); }
    const hits = s.blksHit + s.blksRead;
    return {
      observedAt: this.nowIso(),
      server: { version: s.version, versionNum: s.versionNum, uptimeSeconds: s.uptimeSeconds },
      size: { databaseBytes: s.databaseBytes, tableCount: s.tableCount, indexCount: s.indexCount },
      connections: { ...s.connections, utilisation: s.connections.max ? Math.round((s.connections.total / s.connections.max) * 1000) / 1000 : 0 },
      cacheHitRatio: hits ? Math.round((s.blksHit / hits) * 10000) / 10000 : null,
      deadlocks: s.deadlocks, tempBytes: s.tempBytes, statsResetAt: s.statsResetAt,
      checkpoints: s.checkpoints ?? { available: false, reason: 'checkpoint statistics are not readable by this role' },
      walBytes: s.walBytes,
      migrations: ledger,
      replica: { configured: !!this.opts.replicaConfigured, inRecovery: rep?.inRecovery ?? null, lagSeconds: rep?.lagSeconds ?? null, replicationSlots: st.slots, standbys: st.standbys, note },
      backups,
      extensions: { pgStatStatements: s.extensions.includes('pg_stat_statements'), pgTrgm: s.extensions.includes('pg_trgm'), pgcrypto: s.extensions.includes('pgcrypto') },
    };
  }

  async tables(limit = 50): Promise<DbTables> {
    const rows = await this.db().tables(Math.max(1, Math.min(200, Number(limit) || 50)));
    return {
      observedAt: this.nowIso(),
      rows: rows.map((t) => ({
        table: t.table, totalBytes: t.totalBytes, tableBytes: t.tableBytes, indexBytes: t.indexBytes, rowEstimate: t.rowEstimate, deadTuples: t.deadTuples,
        deadRatio: t.liveTuples + t.deadTuples ? Math.round((t.deadTuples / (t.liveTuples + t.deadTuples)) * 1000) / 1000 : 0,
        seqScans: t.seqScans, idxScans: t.idxScans, lastVacuum: t.lastVacuum, lastAutovacuum: t.lastAutovacuum, lastAnalyze: t.lastAnalyze, lastAutoanalyze: t.lastAutoanalyze,
        bloatEstimateBytes: bloatEstimateBytes(t.tableBytes, t.liveTuples, t.deadTuples),
      })),
    };
  }

  /** B-30 (Oct 20 2026): the index report reads pg_get_indexdef + the size of EVERY index (2,369 on the Oct 20 schema) — 2.7–3.1 s
   *  on a cold catalog cache, over the route-sweep budget. Computed once per process and served from a 10-minute cache
   *  (`computedAt` says when; `cached` says so); `refresh` recomputes on demand. A failed recompute surfaces — nothing stale
   *  is ever served as fresh. Per replica: it is a report, not a decision. */
  private static readonly INDEXES_TTL_MS = 10 * 60_000;
  private indexesCache: { computedAtMs: number; report: Omit<DbIndexes, 'observedAt' | 'cached'> } | null = null;
  /** Round 2 (third full run): concurrent cold requests share ONE computation (single-flight) — the sweep's many-at-once
   *  requests each recomputed the catalog and the first one still took 3.1 s. */
  private indexesInflight: Promise<void> | null = null;
  /** Called once when the API starts (DatabaseIndexesWarmup): the report is ready before the first request. Never throws. */
  async warmIndexes(): Promise<void> {
    if (!this.repo) return;
    try { await this.indexes({ refresh: true }); } catch { /* a warm-up is an optimisation — the first request computes it */ }
  }
  async indexes(opts: { refresh?: boolean } = {}): Promise<DbIndexes> {
    const nowMs = (this.opts.now ?? Date.now)();
    const hit = this.indexesCache;
    if (hit && !opts.refresh && nowMs - hit.computedAtMs < DatabaseOpsService.INDEXES_TTL_MS) return { ...hit.report, observedAt: this.nowIso(), cached: true };
    if (this.indexesInflight) {
      await this.indexesInflight;
      const shared = this.indexesCache;
      if (shared) return { ...shared.report, observedAt: this.nowIso(), cached: false };
    }
    let done!: () => void; this.indexesInflight = new Promise<void>((r) => { done = r; });
    try { return await this.computeIndexes(nowMs); } finally { this.indexesInflight = null; done(); }
  }
  private async computeIndexes(nowMs: number): Promise<DbIndexes> {
    const r = this.db();
    const all = await r.indexes();
    const row = (i: (typeof all)[number]) => ({ index: i.index, table: i.table, bytes: i.bytes, scans: i.scans, definition: i.definition });
    const report = {
      computedAt: new Date(nowMs).toISOString(), statsResetAt: await r.statsResetAt(),
      unused: all.filter((i) => i.valid && i.scans === 0 && !i.primary && !i.unique && !i.constraint).sort((a, b) => b.bytes - a.bytes).slice(0, 200).map(row),
      invalid: all.filter((i) => !i.valid).map(row),
      duplicates: duplicateIndexGroups(all.filter((i) => i.valid)),
    };
    this.indexesCache = { computedAtMs: nowMs, report };
    return { ...report, observedAt: this.nowIso(), cached: false };
  }

  async slowQueries(): Promise<DbSlowQueries> {
    const r = this.db();
    try {
      const rows = await r.statementStats(50);
      return { observedAt: this.nowIso(), source: 'pg_stat_statements', note: 'Normalised statements from pg_stat_statements (parameters appear as $n; literals are replaced).',
        rows: rows.map((x) => ({ hash: x.hash, shape: queryShape(x.query), calls: x.calls, meanMs: x.meanMs, maxMs: x.maxMs, totalMs: x.totalMs, rows: x.rows, lastSeenAt: null, table: null })) };
    } catch {
      const samples = await r.slowSamples(7);
      return { observedAt: this.nowIso(), source: 'app_telemetry',
        note: 'pg_stat_statements is not available on this database (it must be in shared_preload_libraries). Showing the API\'s own slow-query shapes over DB_SLOW_QUERY_MS from the last 7 days — parameters are never recorded.',
        rows: aggregateSlowSamples(samples).slice(0, 50) };
    }
  }

  async activity(): Promise<DbActivity> {
    const rows = await this.db().activity();
    const by = new Map<string, number>();
    for (const a of rows.filter((x) => x.backendType === 'client backend')) { const k = `${a.applicationName}\u0000${a.state}`; by.set(k, (by.get(k) ?? 0) + 1); }
    const view = (a: (typeof rows)[number]) => ({ pid: a.pid, applicationName: a.applicationName, state: a.state, waitEventType: a.waitEventType, waitEvent: a.waitEvent,
      xactSeconds: a.xactSeconds === null ? null : Math.round(a.xactSeconds), querySeconds: a.querySeconds === null ? null : Math.round(a.querySeconds), queryShape: queryShape(a.query), backendType: a.backendType });
    return {
      observedAt: this.nowIso(),
      byApplication: [...by.entries()].map(([k, count]) => { const [applicationName, state] = k.split('\u0000'); return { applicationName, state, count }; }).sort((a, b) => b.count - a.count),
      longTransactions: rows.filter((a) => (a.xactSeconds ?? 0) > LONG_TX_SECONDS).map(view),
      idleInTransaction: rows.filter((a) => a.state.startsWith('idle in transaction')).map(view),
      lockWaits: rows.filter((a) => a.blockingPids.length > 0).map((a) => ({ waitingPid: a.pid, blockingPids: a.blockingPids, waitingSeconds: a.querySeconds === null ? null : Math.round(a.querySeconds), relation: a.relation, mode: a.mode })),
    };
  }

  async schemaHealth(): Promise<DbSchemaHealth> {
    const r = this.db();
    const deferred = await r.deferred(true);
    return {
      observedAt: this.nowIso(),
      deferred: deferred.map((d) => ({ id: d.id, name: d.name, table: d.table, kind: d.kind, migration: d.migration, reason: d.reason, blockingRows: d.blockingRows, createdAt: d.createdAt, retryable: !!this.retrier || retrySqlAllowed(d.retrySql) })),
      notValidConstraints: await r.notValidConstraints(),
      backfills: await r.backfills(),
    };
  }

  async retentionRuns(limit = 50): Promise<DbRetentionRuns> {
    const rows = await this.db().retentionRuns(Math.max(1, Math.min(200, Number(limit) || 50)));
    const num = (...v: unknown[]) => { for (const x of v) if (x !== undefined && x !== null) return Number(x); return 0; };
    return {
      observedAt: this.nowIso(),
      rows: rows.map((x: any) => ({ id: String(x.id), dataClass: String(x.data_class ?? x.table_name ?? ''), mode: String(x.mode ?? ''), cutoff: x.cutoff ? new Date(x.cutoff).toISOString() : null,
        eligible: num(x.eligible_count), affected: num(x.affected_count, x.deleted_count, x.net_count), actorUserId: x.actor_user_id ?? null, occurredAt: new Date(x.occurred_at ?? x.created_at).toISOString() })),
    };
  }

  async growth(days = 90): Promise<DbGrowth> {
    const d = Math.max(1, Math.min(400, Number(days) || 90));
    const g = growthFromSnapshots(await this.db().snapshots(d), 25);
    return { observedAt: this.nowIso(), days: d, ...g };
  }

  // ── jobs ───────────────────────────────────────────────────────────────────────────────────────────────────────
  static readonly SNAPSHOT_KEEP_DAYS = 400;
  static readonly SLOW_SAMPLE_KEEP_DAYS = 30;
  async takeSizeSnapshot(): Promise<{ written: number; purged: number }> { return this.db().writeSizeSnapshot(DatabaseOpsService.SNAPSHOT_KEEP_DAYS); }

  /** Manual "snapshot now" from the page (manage key; audited) — the same write the job does. */
  async snapshotNow(actor: DbActor): Promise<{ ok: true; written: number }> {
    const r = await this.takeSizeSnapshot();
    await this.audit?.record({ userId: actor.userId, role: actor.role ?? 'SUPER_ADMIN', module: 'database', action: 'size_snapshot', resourceType: 'database', resourceId: null, ip: actor.ip ?? null,
      summary: `Table size snapshot taken (${r.written} tables)`, metadata: { written: r.written, purged: r.purged } });
    return { ok: true, written: r.written };
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────────────────────────
  private reason(raw: unknown): string {
    const r = actionReason(raw);
    if (!r) throw new DbOpsError(400, 'REASON_REQUIRED', `A reason of at least ${MIN_DB_ACTION_REASON} characters is required — it is recorded in the audit log.`);
    return r;
  }

  async cancelBackend(actor: DbActor, rawPid: unknown, rawReason: unknown): Promise<DbCancelBackendResult> {
    const why = this.reason(rawReason);
    const pid = Number(rawPid);
    if (!Number.isInteger(pid) || pid <= 0) throw new DbOpsError(400, 'VALIDATION', 'A backend pid is a positive integer.');
    const b = await this.db().backend(pid);
    if (!b) throw new DbOpsError(404, 'NOT_FOUND', 'No backend with that pid is connected to this database.');
    if (b.own) throw new DbOpsError(409, 'OWN_BACKEND', 'That is the connection serving this request.');
    if (b.backendType !== 'client backend') throw new DbOpsError(409, 'NOT_A_CLIENT', `Only client backends can be cancelled here (this one is ${b.backendType || 'a server process'}).`);
    const cancelled = await this.db().cancelBackend(pid);
    await this.audit?.record({ userId: actor.userId, role: actor.role ?? 'SUPER_ADMIN', module: 'database', action: 'backend_cancelled', resourceType: 'pg_backend', resourceId: String(pid), ip: actor.ip ?? null,
      summary: `Cancelled the running query of backend ${pid}`, severity: 'high', metadata: { reason: why, pid, cancelled } });
    return { ok: true, pid, cancelled };
  }

  async vacuumAnalyze(actor: DbActor, rawTable: unknown, rawReason: unknown): Promise<DbVacuumResult> {
    const why = this.reason(rawReason);
    if (!isSafeTableName(rawTable)) throw new DbOpsError(400, 'VALIDATION', 'A table name is a plain lower-case identifier.');
    const allowed = this.opts.allowedTables?.() ?? null;
    if ((allowed && !allowed.has(rawTable)) || !(await this.db().tableExists(rawTable))) throw new DbOpsError(404, 'NOT_FOUND', 'No such table in the platform schema.');
    const started = (this.opts.now ?? Date.now)();
    await this.db().vacuumAnalyze(rawTable);
    const durationMs = Math.max(0, (this.opts.now ?? Date.now)() - started);
    await this.audit?.record({ userId: actor.userId, role: actor.role ?? 'SUPER_ADMIN', module: 'database', action: 'vacuum_analyze', resourceType: 'table', resourceId: rawTable, ip: actor.ip ?? null,
      summary: `VACUUM ANALYZE ${rawTable}`, metadata: { reason: why, table: rawTable, durationMs } });
    return { ok: true, table: rawTable, durationMs };
  }

  async retryDeferred(actor: DbActor, rawId: unknown, rawReason: unknown): Promise<DbRetryConstraintResult> {
    const why = this.reason(rawReason);
    const id = String(rawId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new DbOpsError(404, 'NOT_FOUND', 'Deferred constraint not found.');
    const row = await this.db().deferredById(id);
    if (!row) throw new DbOpsError(404, 'NOT_FOUND', 'Deferred constraint not found.');
    if (row.resolvedAt) return { ok: true, id, resolved: true, message: 'Already resolved.' };
    let out: { resolved: boolean; message: string };
    if (this.retrier) out = await this.retrier.retry(id, actor);
    else out = await this.builtInRetry(row, actor);
    await this.audit?.record({ userId: actor.userId, role: actor.role ?? 'SUPER_ADMIN', module: 'database', action: 'deferred_constraint_retried', resourceType: 'schema_deferred_constraint', resourceId: id, ip: actor.ip ?? null,
      summary: `Retry ${row.kind} ${row.name} on ${row.table}: ${out.resolved ? 'resolved' : 'still blocked'}`, status: out.resolved ? 'success' : 'failed',
      metadata: { reason: why, name: row.name, table: row.table, kind: row.kind, migration: row.migration, resolved: out.resolved } });
    return { ok: true, id, resolved: out.resolved, message: out.message };
  }

  private async builtInRetry(row: DeferredRow, actor: DbActor): Promise<{ resolved: boolean; message: string }> {
    if (!retrySqlAllowed(row.retrySql)) throw new DbOpsError(422, 'NOT_RETRYABLE', 'This row has no retry statement of a shape the page may run — fix the data and run scripts/db-validate-constraints.mjs from a deployment.');
    try { await this.db().runRetry(row, actor.userId); return { resolved: true, message: `${row.name} applied.` }; }
    catch (e: any) { return { resolved: false, message: `Still blocked: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}` }; }
  }
}
