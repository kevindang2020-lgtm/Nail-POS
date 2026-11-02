// migrate-lock.postgres-race.vitest.spec.ts — Phase 1 (BUILD_PLAN_2026-10-06): two containers starting at once must not
// race the migrations. Runs the REAL scripts/migrate.mjs twice, concurrently, against a fresh database (PG_RACE_URL).
//
// Before Oct 6 2026 the runner took no lock: both runners saw file 001 unapplied, both ran it, and the loser failed
// with "relation already exists" — on Railway that container crash-looped while the other came up half-way through.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

describe.skipIf(!url)('scripts/migrate.mjs — concurrent runners', () => {
  const dbName = `mig_lock_${process.pid}`;
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined); await admin.end(); } });

  it('two runners started together both succeed, each migration is applied exactly once, and the second waited', async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const target = new URL(url!); target.pathname = `/${dbName}`;
    const dir = mkdtempSync(join(tmpdir(), 'migs-'));
    // Slow enough that the two runners overlap for certain.
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE lock_probe_a (id int); SELECT pg_sleep(0.6);');
    writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE lock_probe_b (id int); SELECT pg_sleep(0.3);');
    const env = { DATABASE_URL: target.toString(), MIGRATIONS_DIR: dir };

    const [a, b] = await Promise.all([run(env), run(env)]);
    expect([a.code, b.code], a.out + '\n---\n' + b.out).toEqual([0, 0]);
    expect(a.out + b.out).toMatch(/waiting for it to finish/);
    expect((a.out + b.out).match(/2 applied/g)?.length).toBe(1);           // one runner did the work…
    expect((a.out + b.out).match(/0 applied, 2 already present/g)?.length).toBe(1);   // …the other found it done

    const c = new pg.Client({ connectionString: target.toString() });
    await c.connect();
    try {
      const r = await c.query('SELECT filename FROM schema_migrations ORDER BY filename');
      expect(r.rows.map((x: any) => x.filename)).toEqual(['001_a.sql', '002_b.sql']);
    } finally { await c.end(); }
  }, 60_000);
});
