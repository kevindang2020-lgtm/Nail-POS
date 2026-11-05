// database.repository.ts — BUILD_PLAN Phase 10 (agent E): the PostgreSQL reads and the three audited maintenance actions
// behind the Super Admin Database page. Platform-global by design (catalogue + statistics views; no tenant data).
//
// Every read is a catalogue / statistics view (pg_stat_*, pg_class, pg_index, pg_constraint) or a Phase 10 ledger
// (schema_migrations, schema_deferred_constraints, schema_backfills, data_retention_purge_runs, db_table_size_snapshots,
// db_slow_query_samples). Nothing selects a tenant row. Activity rows carry the running query as a SHAPE (queryShape in
// the core) — the raw text never leaves this file.
//
// THE ACTIONS. Cancel = pg_cancel_backend (never terminate) of a client backend in THIS database that is not this one.
// VACUUM ANALYZE takes an identifier the service has already checked against the catalogue, quoted with sql.id, on a
// dedicated connection with its statement timeout lifted (VACUUM cannot run in a transaction, and the API role's 30 s
// default would kill it half-way). Retry runs the ledger row's retry_sql — the service checked its shape first.
import { utcDate } from '@aipowersalon/date-time';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { retryNeedsNoTransaction } from './database-core';

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

export interface ServerStats {
  version: string; versionNum: number; uptimeSeconds: number | null; databaseBytes: number; tableCount: number; indexCount: number;
  connections: { total: number; active: number; idle: number; idleInTransaction: number; waiting: number; max: number };
  blksHit: number; blksRead: number; deadlocks: number; tempBytes: number; statsResetAt: string | null; walBytes: number | null;
  checkpoints: { timed: number; requested: number } | null; extensions: string[];
}
export interface TableStat { table: string; totalBytes: number; tableBytes: number; indexBytes: number; rowEstimate: number; liveTuples: number; deadTuples: number; seqScans: number; idxScans: number; lastVacuum: string | null; lastAutovacuum: string | null; lastAnalyze: string | null; lastAutoanalyze: string | null }
export interface IndexStat { index: string; table: string; bytes: number; scans: number; definition: string; unique: boolean; primary: boolean; valid: boolean; constraint: boolean }
export interface ActivityStat { pid: number; applicationName: string; state: string; waitEventType: string | null; waitEvent: string | null; xactSeconds: number | null; querySeconds: number | null; query: string; backendType: string; blockingPids: number[]; relation: string | null; mode: string | null }
export interface DeferredRow { id: string; name: string; table: string; kind: string; migration: string; reason: string; blockingRows: number | null; retrySql: string | null; createdAt: string; resolvedAt: string | null }

export class KyselyDatabaseOpsRepository {
  constructor(private readonly db: AppDatabase, private readonly replica: AppDatabase | null = null) {}
  private get x(): any { return this.db as any; }
  private q = async <T = any>(s: any, on: any = this.x): Promise<T[]> => (await s.execute(on)).rows as T[];

  async server(): Promise<ServerStats> {
    const [s] = await this.q(sql`select version() as version, current_setting('server_version_num')::int as num,
        extract(epoch from now() - pg_postmaster_start_time())::float8 as uptime, pg_database_size(current_database())::float8 as db_bytes,
        (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p'))::int as tables,
        (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('i', 'I'))::int as indexes,
        current_setting('max_connections')::int as max_conn`);
    const [a] = await this.q(sql`select count(*)::int as total, count(*) filter (where state = 'active')::int as active, count(*) filter (where state = 'idle')::int as idle,
        count(*) filter (where state like 'idle in transaction%')::int as iit, count(*) filter (where wait_event_type = 'Lock')::int as waiting
        from pg_stat_activity where datname = current_database() and backend_type = 'client backend'`);
    const [d] = await this.q(sql`select blks_hit::float8 as hit, blks_read::float8 as rd, deadlocks::float8 as deadlocks, temp_bytes::float8 as temp, stats_reset
        from pg_stat_database where datname = current_database()`);
    let walBytes: number | null = null;
    try { const [w] = await this.q(sql`select pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::float8 as b`); walBytes = nn(w?.b); } catch { walBytes = null; }   // a standby has no current WAL position
    let checkpoints: ServerStats['checkpoints'] = null;
    try {
      const [c] = Number(s.num) >= 170000
        ? await this.q(sql`select num_timed::float8 as timed, num_requested::float8 as req from pg_stat_checkpointer`)
        : await this.q(sql`select checkpoints_timed::float8 as timed, checkpoints_req::float8 as req from pg_stat_bgwriter`);
      checkpoints = c ? { timed: n(c.timed), requested: n(c.req) } : null;
    } catch { checkpoints = null; }
    const ext = await this.q<{ extname: string }>(sql`select extname from pg_extension order by extname`);
    return {
      version: String(s.version).split(' on ')[0], versionNum: Number(s.num), uptimeSeconds: nn(s.uptime), databaseBytes: n(s.db_bytes), tableCount: n(s.tables), indexCount: n(s.indexes),
      connections: { total: n(a?.total), active: n(a?.active), idle: n(a?.idle), idleInTransaction: n(a?.iit), waiting: n(a?.waiting), max: n(s.max_conn) },
      blksHit: n(d?.hit), blksRead: n(d?.rd), deadlocks: n(d?.deadlocks), tempBytes: n(d?.temp), statsResetAt: iso(d?.stats_reset), walBytes, checkpoints,
      extensions: ext.map((r) => r.extname),
    };
  }

  async ledger(): Promise<string[]> {
    return (await this.q<{ filename: string }>(sql`select filename from schema_migrations order by filename`)).map((r) => r.filename);
  }

  /** On the primary: connected standbys and slots. */
  async standbys(): Promise<{ standbys: Array<{ applicationName: string; state: string; replayLagSeconds: number | null }>; slots: number | null }> {
    const rows = await this.q(sql`select application_name, state, extract(epoch from replay_lag)::float8 as lag from pg_stat_replication order by application_name`).catch(() => [] as any[]);
    const [sl] = await this.q(sql`select count(*)::int as n from pg_replication_slots`).catch(() => [{ n: null }]);
    return { standbys: rows.map((r: any) => ({ applicationName: String(r.application_name ?? ''), state: String(r.state ?? ''), replayLagSeconds: nn(r.lag) })), slots: nn(sl?.n) };
  }
  /** On the read handle (a replica when DATABASE_REPLICA_URL is set): recovery state and apply lag. */
  async replicaState(): Promise<{ inRecovery: boolean; lagSeconds: number | null } | null> {
    if (!this.replica) return null;
    const [r] = await this.q(sql`select pg_is_in_recovery() as rec, extract(epoch from now() - pg_last_xact_replay_timestamp())::float8 as lag`, this.replica as any);
    return { inRecovery: !!r?.rec, lagSeconds: r?.rec ? nn(r?.lag) : null };
  }

  async lastBackup(): Promise<{ lastSuccessAt: string | null; lastStatus: string | null; pitrEnabled: boolean | null }> {
    const [last] = await this.q(sql`select status, pitr_enabled from backup_reports where kind = 'backup' order by completed_at desc limit 1`);
    const [ok] = await this.q(sql`select completed_at from backup_reports where kind = 'backup' and status = 'success' order by completed_at desc limit 1`);
    return { lastSuccessAt: iso(ok?.completed_at), lastStatus: last?.status ?? null, pitrEnabled: last ? (last.pitr_enabled ?? null) : null };
  }

  async tables(limit: number): Promise<TableStat[]> {
    const rows = await this.q(sql`select s.relname as t, pg_total_relation_size(s.relid)::float8 as total, pg_relation_size(s.relid)::float8 as heap,
        pg_indexes_size(s.relid)::float8 as idx, c.reltuples::float8 as est, s.n_live_tup::float8 as live, s.n_dead_tup::float8 as dead,
        s.seq_scan::float8 as seq, coalesce(s.idx_scan, 0)::float8 as idxs, s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
      from pg_stat_user_tables s join pg_class c on c.oid = s.relid where s.schemaname = 'public'
      order by pg_total_relation_size(s.relid) desc, s.relname limit ${limit}`);
    return rows.map((r: any) => ({ table: r.t, totalBytes: n(r.total), tableBytes: n(r.heap), indexBytes: n(r.idx), rowEstimate: Math.max(0, n(r.est)), liveTuples: n(r.live), deadTuples: n(r.dead),
      seqScans: n(r.seq), idxScans: n(r.idxs), lastVacuum: iso(r.last_vacuum), lastAutovacuum: iso(r.last_autovacuum), lastAnalyze: iso(r.last_analyze), lastAutoanalyze: iso(r.last_autoanalyze) }));
  }

  async indexes(): Promise<IndexStat[]> {
    const rows = await this.q(sql`select ic.relname as idx, tc.relname as tbl, pg_relation_size(i.indexrelid)::float8 as bytes, coalesce(s.idx_scan, 0)::float8 as scans,
        pg_get_indexdef(i.indexrelid) as def, i.indisunique as uniq, i.indisprimary as prim, i.indisvalid as valid,
        exists (select 1 from pg_constraint k where k.conindid = i.indexrelid) as con
      from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid
      left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
      where tc.relnamespace = 'public'::regnamespace order by tc.relname, ic.relname`);
    return rows.map((r: any) => ({ index: r.idx, table: r.tbl, bytes: n(r.bytes), scans: n(r.scans), definition: String(r.def), unique: !!r.uniq, primary: !!r.prim, valid: !!r.valid, constraint: !!r.con }));
  }

  async statsResetAt(): Promise<string | null> {
    const [d] = await this.q(sql`select stats_reset from pg_stat_database where datname = current_database()`);
    return iso(d?.stats_reset);
  }

  /** pg_stat_statements when the extension is installed AND preloaded (the view raises otherwise). */
  async statementStats(limit: number): Promise<Array<{ hash: string; query: string; calls: number; meanMs: number; maxMs: number; totalMs: number; rows: number }>> {
    const rows = await this.q(sql`select queryid::text as id, query, calls::float8 as calls, mean_exec_time::float8 as mean, max_exec_time::float8 as max, total_exec_time::float8 as total, rows::float8 as rows
      from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database()) order by total_exec_time desc limit ${limit}`);
    return rows.map((r: any) => ({ hash: String(r.id), query: String(r.query ?? ''), calls: n(r.calls), meanMs: Math.round(n(r.mean)), maxMs: Math.round(n(r.max)), totalMs: Math.round(n(r.total)), rows: n(r.rows) }));
  }

  async slowSamples(sinceDays: number): Promise<Array<{ hash: string; fingerprint: string; table: string; durationMs: number; rows: number; at: string }>> {
    const rows = await this.q(sql`select query_hash, fingerprint, table_name, duration_ms, row_count, sampled_at from db_slow_query_samples
      where sampled_at >= now() - make_interval(days => ${sinceDays}) order by sampled_at desc limit 5000`);
    return rows.map((r: any) => ({ hash: r.query_hash, fingerprint: r.fingerprint, table: r.table_name, durationMs: n(r.duration_ms), rows: n(r.row_count), at: iso(r.sampled_at)! }));
  }

  async insertSlowSamples(rows: Array<{ at: number; hash: string; fingerprint: string; operation: string; table: string; durationMs: number; rows: number; requestId: string | null; tenantId: string | null }>, processRole: string | null): Promise<number> {
    if (!rows.length) return 0;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    await this.x.insertInto('db_slow_query_samples').values(rows.map((r) => ({
      sampled_at: new Date(r.at), query_hash: r.hash, fingerprint: String(r.fingerprint).slice(0, 500), operation: String(r.operation).slice(0, 20), table_name: String(r.table).slice(0, 63),
      duration_ms: Math.max(0, Math.round(r.durationMs)), row_count: Math.max(0, Math.round(r.rows)), request_id: r.requestId ? String(r.requestId).slice(0, 100) : null,
      tenant_id: r.tenantId && UUID.test(r.tenantId) ? r.tenantId : null, process_role: processRole,
    }))).execute();
    return rows.length;
  }
  async purgeSlowSamples(olderThanDays: number): Promise<number> {
    const r: any = await sql`delete from db_slow_query_samples where sampled_at < now() - make_interval(days => ${olderThanDays})`.execute(this.x);
    return Number(r.numAffectedRows ?? 0);
  }

  async activity(): Promise<ActivityStat[]> {
    const rows = await this.q(sql`select a.pid, coalesce(a.application_name, '') as app, coalesce(a.state, '') as state, a.wait_event_type, a.wait_event,
        extract(epoch from now() - a.xact_start)::float8 as xact, extract(epoch from now() - a.query_start)::float8 as qs, coalesce(a.query, '') as query,
        coalesce(a.backend_type, '') as btype, pg_blocking_pids(a.pid) as blockers,
        (select l.relation::regclass::text from pg_locks l where l.pid = a.pid and not l.granted and l.relation is not null limit 1) as rel,
        (select l.mode from pg_locks l where l.pid = a.pid and not l.granted limit 1) as mode
      from pg_stat_activity a where a.datname = current_database() and a.pid <> pg_backend_pid() order by a.xact_start nulls last`);
    return rows.map((r: any) => ({ pid: Number(r.pid), applicationName: r.app, state: r.state, waitEventType: r.wait_event_type ?? null, waitEvent: r.wait_event ?? null,
      xactSeconds: nn(r.xact), querySeconds: nn(r.qs), query: r.query, backendType: r.btype, blockingPids: (Array.isArray(r.blockers) ? r.blockers : []).map(Number), relation: r.rel ?? null, mode: r.mode ?? null }));
  }

  async deferred(openOnly: boolean): Promise<DeferredRow[]> {
    const rows = await this.q(sql`select id, name, table_name, kind, migration, reason, blocking_rows, retry_sql, created_at, resolved_at from schema_deferred_constraints
      ${openOnly ? sql`where resolved_at is null` : sql``} order by created_at desc limit 500`);
    return rows.map(mapDeferred);
  }
  async deferredById(id: string): Promise<DeferredRow | null> {
    const [r] = await this.q(sql`select id, name, table_name, kind, migration, reason, blocking_rows, retry_sql, created_at, resolved_at from schema_deferred_constraints where id = ${id}::uuid`);
    return r ? mapDeferred(r) : null;
  }
  async notValidConstraints(): Promise<Array<{ table: string; name: string; type: 'foreign_key' | 'check' }>> {
    const rows = await this.q(sql`select c.conrelid::regclass::text as tbl, c.conname, c.contype from pg_constraint c
      where not c.convalidated and c.contype in ('f', 'c') and c.connamespace = 'public'::regnamespace order by 1, 2`);
    return rows.map((r: any) => ({ table: r.tbl, name: r.conname, type: r.contype === 'f' ? 'foreign_key' as const : 'check' as const }));
  }
  async backfills(): Promise<Array<{ name: string; status: string; rowsDone: number; batchesDone: number; lastKey: string | null; updatedAt: string; lastError: string | null }>> {
    const rows = await this.q(sql`select name, status, rows_done::float8 as rows_done, batches_done, last_key, updated_at, last_error from schema_backfills
      order by (status = 'completed'), updated_at desc limit 100`);
    return rows.map((r: any) => ({ name: r.name, status: r.status, rowsDone: n(r.rows_done), batchesDone: n(r.batches_done), lastKey: r.last_key ?? null, updatedAt: iso(r.updated_at)!, lastError: r.last_error ?? null }));
  }

  async retentionRuns(limit: number): Promise<any[]> {
    return this.q(sql`select * from data_retention_purge_runs order by occurred_at desc limit ${limit}`);
  }

  async snapshots(days: number): Promise<Array<{ day: string; table: string; totalBytes: number; rowEstimate: number }>> {
    const rows = await this.q(sql`select to_char(snapshot_date, 'YYYY-MM-DD') as day, table_name, total_bytes::float8 as total, row_estimate::float8 as est
      from db_table_size_snapshots where snapshot_date >= ${utcDate(new Date(Date.now() - days * 86_400_000))}::date order by snapshot_date, table_name`);
    return rows.map((r: any) => ({ day: r.day, table: r.table_name, totalBytes: n(r.total), rowEstimate: n(r.est) }));
  }

  // The snapshot date is a PLATFORM day (one database, no salon), named in UTC by the shared helper (§87).
  /** One row per public table for today's UTC date (upsert — the last run of the day wins); purges past the keep window. */
  async writeSizeSnapshot(keepDays: number): Promise<{ written: number; purged: number }> {
    const w: any = await sql`insert into db_table_size_snapshots (snapshot_date, taken_at, table_name, total_bytes, table_bytes, index_bytes, row_estimate, dead_tuples, seq_scans, idx_scans)
      select ${utcDate(new Date())}::date, now(), s.relname, pg_total_relation_size(s.relid), pg_relation_size(s.relid), pg_indexes_size(s.relid),
             greatest(c.reltuples, 0)::bigint, s.n_dead_tup, s.seq_scan, coalesce(s.idx_scan, 0)
        from pg_stat_user_tables s join pg_class c on c.oid = s.relid where s.schemaname = 'public'
      on conflict (snapshot_date, table_name) do update set taken_at = excluded.taken_at, total_bytes = excluded.total_bytes, table_bytes = excluded.table_bytes,
        index_bytes = excluded.index_bytes, row_estimate = excluded.row_estimate, dead_tuples = excluded.dead_tuples, seq_scans = excluded.seq_scans, idx_scans = excluded.idx_scans`.execute(this.x);
    const p: any = await sql`delete from db_table_size_snapshots where snapshot_date < ${utcDate(new Date(Date.now() - keepDays * 86_400_000))}::date`.execute(this.x);
    return { written: Number(w.numAffectedRows ?? 0), purged: Number(p.numAffectedRows ?? 0) };
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────────────────────────
  async backend(pid: number): Promise<{ pid: number; backendType: string; own: boolean } | null> {
    const [r] = await this.q(sql`select pid, coalesce(backend_type, '') as btype, pid = pg_backend_pid() as own from pg_stat_activity where pid = ${pid}::int and datname = current_database()`);
    return r ? { pid: Number(r.pid), backendType: r.btype, own: !!r.own } : null;
  }
  async cancelBackend(pid: number): Promise<boolean> {
    const [r] = await this.q(sql`select pg_cancel_backend(${pid}::int) as ok`);
    return !!r?.ok;
  }
  async tableExists(name: string): Promise<boolean> {
    const [r] = await this.q(sql`select 1 as ok from pg_class where relname = ${name} and relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'm')`);
    return !!r;
  }
  async vacuumAnalyze(name: string): Promise<void> {
    await this.x.connection().execute(async (c: any) => {
      await sql`set statement_timeout = 0`.execute(c);
      try { await sql`vacuum (analyze) ${sql.id('public', name)}`.execute(c); }
      finally { await sql`reset statement_timeout`.execute(c).catch(() => undefined); }
    });
  }
  /** Run a ledger row's retry statement (shape already checked); mark it resolved on success. */
  async runRetry(row: DeferredRow, actorUserId: string | null): Promise<void> {
    const stmt = String(row.retrySql).trim().replace(/;\s*$/, '');
    if (retryNeedsNoTransaction(stmt)) {
      await this.x.connection().execute(async (c: any) => {
        await sql`set statement_timeout = 0`.execute(c);
        try { await sql.raw(stmt).execute(c); } finally { await sql`reset statement_timeout`.execute(c).catch(() => undefined); }
      });
      await sql`update schema_deferred_constraints set resolved_at = now(), resolved_by = ${actorUserId ?? 'super_admin'} where id = ${row.id}::uuid and resolved_at is null`.execute(this.x);
      return;
    }
    await this.x.transaction().execute(async (trx: any) => {
      await sql`set local statement_timeout = 0`.execute(trx);
      await sql.raw(stmt).execute(trx);
      await sql`update schema_deferred_constraints set resolved_at = now(), resolved_by = ${actorUserId ?? 'super_admin'} where id = ${row.id}::uuid and resolved_at is null`.execute(trx);
    });
  }
}

function mapDeferred(r: any): DeferredRow {
  return { id: String(r.id), name: r.name, table: r.table_name, kind: r.kind, migration: r.migration, reason: r.reason, blockingRows: nn(r.blocking_rows), retrySql: r.retry_sql ?? null, createdAt: iso(r.created_at)!, resolvedAt: iso(r.resolved_at) };
}
