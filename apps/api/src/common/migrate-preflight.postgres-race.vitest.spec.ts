// migrate-preflight.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 10 (Constitution 1 §68–71, §98): the REAL
// scripts/db-preflight.mjs, run before migrate.mjs on every deploy, against a real Postgres (PG_RACE_URL).
// Hard failures (exit 1): no DATABASE_URL, cannot connect, Postgres too old, a ledger row whose file is gone (and is
// not a known rename). Everything else is a warning (exit 0): the pending list, a pending ALTER on a big table, a
// long transaction or a lock held on a table a pending file touches, an out-of-order file, an edited applied file.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const url = process.env.PG_RACE_URL;
const PREFLIGHT = resolve(__dirname, '..', '..', 'scripts', 'db-preflight.mjs');
const MIGRATE = resolve(__dirname, '..', '..', 'scripts', 'migrate.mjs');

function run(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const e = { ...process.env, ...env };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
    const p = spawn(process.execPath, [script], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
}

describe('scripts/db-preflight.mjs — without a database', () => {
  it('no DATABASE_URL is a hard failure', async () => {
    const r = await run(PREFLIGHT, { DATABASE_URL: undefined });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DATABASE_URL is required/);
  });
  it('an unreachable server is a hard failure', async () => {
    const r = await run(PREFLIGHT, { DATABASE_URL: 'postgres://postgres@127.0.0.1:1/none', PREFLIGHT_CONNECT_TIMEOUT_MS: '2000' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+connectivity/);
  });
});

describe.skipIf(!url)('scripts/db-preflight.mjs — against Postgres', () => {
  const dbName = `preflight_${process.pid}`;
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined); await admin.end(); } });

  it('reports version, extensions, pending files, big tables, locks; hard-fails on a ledger row with no file and on an old server', async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const target = new URL(url!); target.pathname = `/${dbName}`;
    const db = target.toString();
    const dir = mkdtempSync(join(tmpdir(), 'pf-'));
    writeFileSync(join(dir, '001_t.sql'), 'CREATE TABLE t (id int); INSERT INTO t SELECT generate_series(1, 500); ANALYZE t;');
    writeFileSync(join(dir, '017a_pos_settings_integrations.sql'), 'SELECT 1;');
    const env = { DATABASE_URL: db, MIGRATIONS_DIR: dir };

    // Fresh database: no ledger yet — everything pending, exit 0.
    const fresh = await run(PREFLIGHT, env);
    expect(fresh.code, fresh.out).toBe(0);
    expect(fresh.out).toMatch(/OK\s+postgres\s+1[4-9]|OK\s+postgres\s+[2-9]\d/);
    expect(fresh.out).toMatch(/pgcrypto/);
    expect(fresh.out).toMatch(/2 pending/);

    expect((await run(MIGRATE, env)).code).toBe(0);
    const c = new pg.Client({ connectionString: db }); await c.connect();
    try {
      // A pending ALTER on a table over the (lowered) big-table threshold, while another session holds a lock on it.
      writeFileSync(join(dir, '002_alter.sql'), 'ALTER TABLE t ADD COLUMN IF NOT EXISTS v int;\nCREATE INDEX IF NOT EXISTS idx_t_v ON t (v);');
      await c.query('BEGIN'); await c.query('LOCK TABLE t IN ACCESS SHARE MODE');
      const busy = await run(PREFLIGHT, { ...env, PREFLIGHT_BIG_TABLE_ROWS: '100', PREFLIGHT_LONG_TX_SECONDS: '0' });
      await c.query('ROLLBACK');
      expect(busy.code, busy.out).toBe(0);
      expect(busy.out).toMatch(/1 pending: 002_alter\.sql/);
      expect(busy.out).toMatch(/WARN\s+big table\s+t ~500 rows.*002_alter\.sql/);
      expect(busy.out).toMatch(/WARN\s+non-concurrent index.*idx_t_v.*t/);
      expect(busy.out).toMatch(/WARN\s+lock\s+t AccessShareLock held by pid \d+/);
      expect(busy.out).toMatch(/WARN\s+long transaction\s+pid \d+/);
      expect(busy.out).not.toMatch(/LOCK TABLE/);   // never print another session's query text

      // A known rename's OLD name in the ledger is fine; a row whose file is simply gone is a hard failure.
      await c.query(`UPDATE schema_migrations SET filename = '017_pos_settings_integrations.sql' WHERE filename = '017a_pos_settings_integrations.sql'`);
      const renamed = await run(PREFLIGHT, env);
      expect(renamed.code, renamed.out).toBe(0);
      expect(renamed.out).toMatch(/017_pos_settings_integrations\.sql → 017a_pos_settings_integrations\.sql/);
      await c.query(`INSERT INTO schema_migrations (filename) VALUES ('000_gone.sql')`);
      const gone = await run(PREFLIGHT, env);
      expect(gone.code).toBe(1);
      expect(gone.out).toMatch(/FAIL\s+ledger\s+000_gone\.sql/);
      await c.query(`DELETE FROM schema_migrations WHERE filename = '000_gone.sql'`);

      const old = await run(PREFLIGHT, { ...env, PREFLIGHT_MIN_PG_MAJOR: '99' });
      expect(old.code).toBe(1);
      expect(old.out).toMatch(/FAIL\s+postgres/);
    } finally { await c.end(); rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
