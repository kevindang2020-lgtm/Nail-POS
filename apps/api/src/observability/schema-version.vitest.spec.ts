// schema-version.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §131): latest applied migration, count, pending
// files from the image, checksum mismatches — on System Operations and as /health `schemaVersion` (no secrets).
// The real-database half runs with PG_RACE_URL (a migrated database; read-only against it).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { compareSchema, imageMigrations, migrationsDir, readSchemaVersion, cachedSchemaVersion, summarizeSchema, _resetSchemaVersionCache } from './schema-version';
import { HealthController } from '../health/health.controller';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('compareSchema (pure)', () => {
  const files = new Map([['001_a.sql', sha('a')], ['002_b.sql', sha('b')], ['003_c.sql', sha('c')]]);
  it('all applied, same checksums → ok, latest = the newest file', () => {
    const v = compareSchema([{ filename: '001_a.sql', checksum: sha('a'), applied_at: '2026-10-01T00:00:00Z' }, { filename: '002_b.sql', checksum: sha('b'), applied_at: '2026-10-02T00:00:00Z' }, { filename: '003_c.sql', checksum: null, applied_at: '2026-10-03T00:00:00Z' }], files, '/m');
    expect(v).toMatchObject({ status: 'ok', latest: '003_c.sql', latestAppliedAt: '2026-10-03T00:00:00.000Z', applied: 3, files: 3, pending: [], unknown: [], mismatches: [] });
  });
  it('a file the database has not run → pending (named)', () => {
    expect(compareSchema([{ filename: '001_a.sql', checksum: sha('a'), applied_at: null }], files, '/m')).toMatchObject({ status: 'pending', pending: ['002_b.sql', '003_c.sql'], latest: '001_a.sql' });
  });
  it('a ledger row with no file here → ahead (rolled back to an older image)', () => {
    const v = compareSchema([...['001_a.sql', '002_b.sql', '003_c.sql'].map((f) => ({ filename: f, checksum: null, applied_at: null })), { filename: '004_d.sql', checksum: null, applied_at: null }], files, '/m');
    expect(v).toMatchObject({ status: 'ahead', unknown: ['004_d.sql'] });
  });
  it('a file edited after it ran → drift (mismatch named)', () => {
    const v = compareSchema(['001_a.sql', '002_b.sql', '003_c.sql'].map((f) => ({ filename: f, checksum: f === '002_b.sql' ? sha('b-original') : null, applied_at: null })), files, '/m');
    expect(v).toMatchObject({ status: 'drift', mismatches: ['002_b.sql'] });
  });
  it('the /health summary carries counts and the latest name only', () => {
    const s = summarizeSchema(compareSchema([{ filename: '001_a.sql', checksum: sha('a'), applied_at: null }], files, '/m'));
    expect(s).toEqual({ status: 'pending', latest: '001_a.sql', applied: 1, pending: 2, mismatches: 0, unknown: 0 });
  });
});

describe('the image\'s migrations', () => {
  it('are found next to the code and hashed exactly like scripts/migrate.mjs', () => {
    const dir = migrationsDir({});
    expect(dir).toBeTruthy();
    const sums = imageMigrations(dir!);
    expect(sums.size).toBe(readdirSync(dir!).filter((f) => f.endsWith('.sql')).length);
    expect([...sums.keys()]).toContain('549_payment_attempt_stranded.sql');
  });
  it('no database → unknown, never a fake ok; /health still answers ok with schemaVersion', async () => {
    _resetSchemaVersionCache();
    expect((await readSchemaVersion(undefined)).status).toBe('unknown');
    const h: any = await new HealthController(undefined).health();
    expect(h.status).toBe('ok');
    expect(h.schemaVersion).toMatchObject({ status: 'unknown', latest: null });
    expect(JSON.stringify(h)).not.toMatch(/postgres:\/\/|password|DATABASE_URL/i);
  });
});

const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('against a real migrated database (read-only)', () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 2 }) : null;
  const db = pool ? new Kysely<any>({ dialect: new PostgresDialect({ pool }) }) : null;
  const tmp: string[] = [];
  beforeEach(() => _resetSchemaVersionCache());
  afterAll(async () => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); await db?.destroy(); });

  it('a fully migrated database matches this image: ok, latest = the newest file, nothing pending or drifted', async () => {
    const dir = migrationsDir({})!;
    const v = await readSchemaVersion(db, dir);
    const newest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().pop();
    expect(v).toMatchObject({ status: 'ok', latest: newest, pending: [], mismatches: [] });
    expect(v.applied).toBe(imageMigrations(dir).size);
  });
  it('an image with a new file → that file is pending; an edited file → a mismatch; /health shows the counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p11b-mig-')); tmp.push(dir);
    cpSync(migrationsDir({})!, dir, { recursive: true });
    writeFileSync(join(dir, '999_future.sql'), 'select 1;');
    writeFileSync(join(dir, '001_auth_foundation.sql'), '-- edited after it ran\n');
    const v = await readSchemaVersion(db, dir);
    expect(v.status).toBe('pending');
    expect(v.pending).toEqual(['999_future.sql']);
    expect(v.mismatches).toEqual(['001_auth_foundation.sql']);
    process.env.MIGRATIONS_DIR = dir;
    try {
      const h: any = await new HealthController(db).health();
      expect(h.schemaVersion).toMatchObject({ status: 'pending', pending: 1, mismatches: 1 });
    } finally { delete process.env.MIGRATIONS_DIR; }
  });
  it('cached: a second read inside the TTL does not query again', async () => {
    let queries = 0;
    const counting = new Proxy(db!, { get(t, p, r) { if (p === 'executeQuery') queries++; return Reflect.get(t, p, r); } });
    await cachedSchemaVersion(counting); const after1 = queries;
    await cachedSchemaVersion(counting);
    expect(queries).toBe(after1);
  });
});
