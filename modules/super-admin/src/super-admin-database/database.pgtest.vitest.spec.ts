// database.pgtest.vitest.spec — BUILD_PLAN Phase 10 (E): the Database page repository against the REAL migrated schema
// (PGlite): every read answers from the catalogue, the size snapshot is one row per table per day (idempotent), the
// slow-query samples round-trip, VACUUM ANALYZE runs, and a deferred constraint is retried for real — resolved when
// the data allows it, still blocked (and still open) when it does not. Also: migrations 545/546 defer nothing on a
// fresh database, and 546's indexes do not duplicate an index another migration (B's 537) already created.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RecordingAuditSink } from '@aipowersalon/audit';
import { KyselyDatabaseOpsRepository } from './database.repository';
import { DatabaseOpsService } from './database.service';
import { indexKey } from './database-core';

let db: any; let repo: KyselyDatabaseOpsRepository; let svc: DatabaseOpsService; const audit = new RecordingAuditSink();
const rows = async (q: any) => (await q.execute(db)).rows as any[];
beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new KyselyDatabaseOpsRepository(db);
  svc = new DatabaseOpsService(repo, audit, { migrationsDir: MIGRATIONS_DIR });
}, 180_000);
const A = { userId: null, role: 'SUPER_ADMIN' };

describe('Database page repository (migrated schema)', () => {
  it('overview: real version, counts, the migration version equals the ledger max and nothing is pending', async () => {
    // the pgtest replay does not write schema_migrations; write the ledger the runner would have written
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())`.execute(db);
    for (const f of files) await sql`insert into schema_migrations (filename) values (${f}) on conflict do nothing`.execute(db);
    const o = await svc.overview();
    expect(o.server.versionNum).toBeGreaterThanOrEqual(150000);
    expect(o.size.tableCount).toBeGreaterThan(500);
    expect(o.size.indexCount).toBeGreaterThan(o.size.tableCount);
    expect(o.migrations).toMatchObject({ latest: files[files.length - 1], applied: files.length, files: files.length, pending: [], ledgerIntegrity: 'ok' });
    await sql`insert into schema_migrations (filename) values ('999_never_shipped.sql')`.execute(db);
    expect((await svc.overview()).migrations).toMatchObject({ ledgerIntegrity: 'broken', unknownLedgerRows: ['999_never_shipped.sql'] });
    await sql`delete from schema_migrations where filename = '999_never_shipped.sql'`.execute(db);
    expect(o.connections.max).toBeGreaterThan(0);
    expect(o.cacheHitRatio === null || (o.cacheHitRatio >= 0 && o.cacheHitRatio <= 1)).toBe(true);
  });
  it('tables / indexes / activity / schema health / growth answer from the catalogue', async () => {
    const t = await svc.tables(10);
    expect(t.rows.length).toBe(10);
    expect(t.rows[0].totalBytes).toBeGreaterThanOrEqual(t.rows[9].totalBytes);
    const ix = await svc.indexes();
    expect(Array.isArray(ix.unused)).toBe(true); expect(ix.invalid).toEqual([]);
    const act = await svc.activity();
    expect(Array.isArray(act.byApplication)).toBe(true);
    const h = await svc.schemaHealth();
    expect(h.deferred).toEqual([]);   // a fresh database defers nothing
  });
  it('the size snapshot is one row per public table per UTC day — a second run updates, never duplicates', async () => {
    const a = await svc.takeSizeSnapshot();
    const [{ n: tables }] = await rows(sql`select count(*)::int as n from pg_stat_user_tables where schemaname = 'public'`);
    expect(a.written).toBe(tables);
    await sql`update db_table_size_snapshots set row_estimate = -1, seq_scans = -1`.execute(db);   // the second run must overwrite the day's row
    await svc.takeSizeSnapshot();
    expect((await rows(sql`select count(*)::int as n from db_table_size_snapshots where row_estimate = -1 or seq_scans = -1`))[0].n).toBe(0);
    const [{ n, d }] = await rows(sql`select count(*)::int as n, count(distinct snapshot_date)::int as d from db_table_size_snapshots`);
    expect(n).toBe(tables); expect(d).toBe(1);
    const g = await svc.growth(90);
    expect(g.totals).toHaveLength(1);
    expect(g.tables.length).toBeGreaterThan(0);
  });
  it('slow-query samples round-trip as shapes and aggregate per hash', async () => {
    await repo.insertSlowSamples([
      { at: Date.now(), hash: 'abc123abc123', fingerprint: 'select * from payments where tenant_id = $?', operation: 'select', table: 'payments', durationMs: 400, rows: 3, requestId: 'req-1', tenantId: null },
      { at: Date.now(), hash: 'abc123abc123', fingerprint: 'select * from payments where tenant_id = $?', operation: 'select', table: 'payments', durationMs: 600, rows: 1, requestId: 'req-2', tenantId: 'not-a-uuid' },
    ], 'api');
    const s = await svc.slowQueries();
    expect(s.source).toBe('app_telemetry');
    expect(s.rows.find((r) => r.hash === 'abc123abc123')).toMatchObject({ calls: 2, meanMs: 500, maxMs: 600, rows: 4 });
    expect((await rows(sql`select count(*)::int as n from db_slow_query_samples where tenant_id is not null`))[0].n).toBe(0);
    expect(await repo.purgeSlowSamples(30)).toBe(0);
  });
  it('VACUUM ANALYZE runs on a real table and is audited', async () => {
    const r = await svc.vacuumAnalyze(A, 'db_table_size_snapshots', 'pgtest: vacuum after the snapshot');
    expect(r.ok).toBe(true);
    expect(audit.entries.at(-1)).toMatchObject({ action: 'vacuum_analyze', resourceId: 'db_table_size_snapshots' });
  });
  it('a deferred constraint is retried for real: still blocked while the data is bad (row stays open), resolved once it is fixed', async () => {
    await sql`create table if not exists pgt_dup (id serial primary key, k text)`.execute(db);
    await sql`insert into pgt_dup (k) values ('a'), ('a')`.execute(db);
    await sql`select schema_defer_constraint('uq_pgt_dup_k', 'pgt_dup', 'unique', '546_pgtest.sql', '1 duplicate groups', 1, 'CREATE UNIQUE INDEX IF NOT EXISTS uq_pgt_dup_k ON pgt_dup (k)')`.execute(db);
    const [{ id }] = await rows(sql`select id from schema_deferred_constraints where name = 'uq_pgt_dup_k'`);
    expect((await svc.schemaHealth()).deferred.map((d) => d.name)).toEqual(['uq_pgt_dup_k']);
    const blocked = await svc.retryDeferred(A, id, 'pgtest: retry while duplicated');
    expect(blocked.resolved).toBe(false);
    expect((await rows(sql`select resolved_at from schema_deferred_constraints where id = ${id}::uuid`))[0].resolved_at).toBeNull();
    await sql`delete from pgt_dup where id = (select max(id) from pgt_dup)`.execute(db);
    const ok = await svc.retryDeferred(A, id, 'pgtest: duplicates removed now');
    expect(ok.resolved).toBe(true);
    expect((await rows(sql`select indexname from pg_indexes where indexname = 'uq_pgt_dup_k'`))).toHaveLength(1);
    expect((await svc.schemaHealth()).deferred).toEqual([]);
    await sql`delete from schema_deferred_constraints where id = ${id}::uuid`.execute(db);
    await sql`drop table pgt_dup`.execute(db);
  });
  it('migration 546: every index it creates exists, and none duplicates another index on the same table (B\'s 537 included)', async () => {
    const text = readFileSync(join(MIGRATIONS_DIR, '546_explain_pass_indexes.sql'), 'utf8');
    const names = [...text.matchAll(/CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    const all = await rows(sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`);
    for (const nm of names) {
      const mine = all.find((r) => r.indexname === nm);
      expect(mine, `${nm} exists`).toBeTruthy();
      const twins = all.filter((r) => r.tablename === mine.tablename && r.indexname !== nm && indexKey(r.indexdef) === indexKey(mine.indexdef));
      expect(twins.map((t) => t.indexname), `${nm} duplicates`).toEqual([]);
    }
  });
});
