// migrate-hardening.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 10 (Constitution 1 §68–71, §98): the REAL
// scripts/migrate.mjs against a real Postgres (PG_RACE_URL), on a tiny fixture migration set per test.
//   * a `-- migrate: no-transaction` file builds CONCURRENTLY; when the build fails it leaves an INVALID index and no
//     ledger row; once the data is fixed the next run drops the INVALID index and builds it (no manual cleanup);
//   * every applied file's sha256 is recorded; a file edited after it was applied is reported on the next run
//     (the edit never reaches that database — the warning says so) without failing the deploy;
//   * a pending file that sorts BEFORE the newest applied file (a merged branch with a lower number) is applied and
//     reported as out of order;
//   * a ledger row whose file no longer exists is reported.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const url = process.env.PG_RACE_URL;
const RUNNER = resolve(__dirname, '..', '..', 'scripts', 'migrate.mjs');

function run(env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [RUNNER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
}

describe.skipIf(!url)('scripts/migrate.mjs — Phase 10 hardening', () => {
  const dbName = `mig_hard_${process.pid}`;
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined); await admin.end(); } });

  async function freshDb() {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const target = new URL(url!); target.pathname = `/${dbName}`;
    return target.toString();
  }
  async function q(dbUrl: string, sql: string) {
    const c = new pg.Client({ connectionString: dbUrl }); await c.connect();
    try { return (await c.query(sql)).rows; } finally { await c.end(); }
  }

  it('an interrupted CONCURRENTLY build leaves an INVALID index; the next run drops and rebuilds it', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'migs-'));
    writeFileSync(join(dir, '001_t.sql'), "CREATE TABLE IF NOT EXISTS t (id int, email text); INSERT INTO t VALUES (1, 'a'), (2, 'a');");
    writeFileSync(join(dir, '002_idx.sql'), '-- migrate: no-transaction\n-- unique email\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_t_email ON t (email);\n');
    const first = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
    expect(first.code).not.toBe(0);
    expect(await q(db, `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'uq_t_email'`)).toEqual([{ indisvalid: false }]);
    expect(await q(db, `SELECT filename FROM schema_migrations WHERE filename = '002_idx.sql'`)).toEqual([]);

    await q(db, `DELETE FROM t WHERE id = 2`);
    const second = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
    expect(second.code, second.out).toBe(0);
    expect(second.out).toMatch(/dropping INVALID index uq_t_email/);
    expect(await q(db, `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'uq_t_email'`)).toEqual([{ indisvalid: true }]);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('records a checksum per file and reports an applied file that was edited, an out-of-order file and a ledger row with no file', async () => {
    const db = await freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'migs-'));
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id int);');
    writeFileSync(join(dir, '003_c.sql'), 'CREATE TABLE c (id int);');
    const one = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
    expect(one.code, one.out).toBe(0);
    const sums = await q(db, `SELECT filename, checksum FROM schema_migrations ORDER BY 1`);
    expect(sums.map((r: any) => r.filename)).toEqual(['001_a.sql', '003_c.sql']);
    for (const r of sums) expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id int, extra text);');   // edited after it was applied
    writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (id int);');               // merged in with a lower number
    await q(db, `INSERT INTO schema_migrations (filename) VALUES ('000_vanished.sql')`);
    const two = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
    expect(two.code, two.out).toBe(0);
    expect(two.out).toMatch(/001_a\.sql changed since it was applied/);
    expect(two.out).toMatch(/002_b\.sql is out of order/);
    expect(two.out).toMatch(/000_vanished\.sql is in the ledger but has no file/);
    expect(await q(db, `SELECT to_regclass('b') IS NOT NULL AS ok`)).toEqual([{ ok: true }]);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
