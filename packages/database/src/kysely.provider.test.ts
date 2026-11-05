// Verifies the read/write-split seam (Roadmap Phase 1.2). The safety-critical property is the fallback: when no
// replica is configured, DATABASE_READ must reuse the *exact* primary handle so nothing opens a second pool and
// nothing breaks in dev/tests/single-node. We also verify a distinct handle is built when a replica URL is present.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createReadDatabase } from './kysely.provider';

const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; vi.restoreAllMocks(); });

describe('createReadDatabase — read/write split seam', () => {
  it('returns null when REPO_DRIVER is not postgres (in-memory mode)', () => {
    delete process.env.REPO_DRIVER;
    const primary = {} as any;
    expect(createReadDatabase(primary)).toBeNull();
  });

  it('falls back to the SAME primary handle when no DATABASE_REPLICA_URL is set', () => {
    process.env.REPO_DRIVER = 'postgres';
    delete process.env.DATABASE_REPLICA_URL;
    const primary = { __tag: 'primary' } as any;
    // identity, not just equality: reads must share the primary pool, not open a new one
    expect(createReadDatabase(primary)).toBe(primary);
  });

  it('builds a distinct replica handle when DATABASE_REPLICA_URL is set', () => {
    process.env.REPO_DRIVER = 'postgres';
    process.env.DATABASE_REPLICA_URL = 'postgres://replica.example/db';
    const primary = { __tag: 'primary' } as any;
    const read = createReadDatabase(primary);
    expect(read).not.toBeNull();
    expect(read).not.toBe(primary);
  });
});

// Phase 10 (Constitution 1 §60–61): timeouts per role, and a separate worker pool.
import { poolOptions, createWorkerDatabase, createDatabase, workerPoolSettings, ROLE_TIMEOUTS } from './kysely.provider';
import { ActorStampPlugin } from './actor-stamp.plugin';

describe('per-role pool settings', () => {
  it('PROCESS_ROLE=api → 30 s statement / 30 s idle-in-transaction; worker → 600 s / 120 s; all (default) → 120 s / 60 s', () => {
    expect(poolOptions('p', 1, { PROCESS_ROLE: 'api' })).toMatchObject({ statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 });
    expect(poolOptions('p', 1, { PROCESS_ROLE: 'worker' })).toMatchObject({ statement_timeout: 600_000, idle_in_transaction_session_timeout: 120_000 });
    expect(poolOptions('p', 1, {})).toMatchObject({ statement_timeout: 120_000, idle_in_transaction_session_timeout: 60_000 });
    expect(ROLE_TIMEOUTS.api.statement).toBeLessThan(ROLE_TIMEOUTS.worker.statement);
  });
  it('still overridable as before (and 0 turns one off)', () => {
    expect(poolOptions('p', 1, { PROCESS_ROLE: 'api', PG_STATEMENT_TIMEOUT_MS: '5000' })).toMatchObject({ statement_timeout: 5000 });
    expect(poolOptions('p', 1, { PROCESS_ROLE: 'api', PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' })).not.toHaveProperty('idle_in_transaction_session_timeout');
  });
  it("the worker pool ignores the API's override (PG_STATEMENT_TIMEOUT_MS) and reads PG_WORKER_* instead", () => {
    const env = { PROCESS_ROLE: 'api', PG_STATEMENT_TIMEOUT_MS: '5000' };
    expect(poolOptions('p', 5, env, 'worker')).toMatchObject({ statement_timeout: 600_000, idle_in_transaction_session_timeout: 120_000, application_name: 'aipowersalon-worker-pool' });
    expect(poolOptions('p', 5, { PG_WORKER_STATEMENT_TIMEOUT_MS: '900000' }, 'worker')).toMatchObject({ statement_timeout: 900_000 });
  });
});

describe('createWorkerDatabase', () => {
  it('null without Postgres (in-memory mode)', () => {
    expect(createWorkerDatabase({ env: {} })).toBeNull();
    expect(createWorkerDatabase({ env: { REPO_DRIVER: 'postgres' } })).toBeNull();
  });
  it('its own pool: PG_WORKER_POOL_MAX (default 5), PG_WORKER_DATABASE_URL preferred over DATABASE_URL', async () => {
    expect(workerPoolSettings({ REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://primary/db', PG_POOL_MAX: '40' })).toEqual({ connectionString: 'postgres://primary/db', max: 5 });
    expect(workerPoolSettings({ REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://primary/db', PG_WORKER_DATABASE_URL: 'postgres://worker-role/db', PG_WORKER_POOL_MAX: '8' })).toEqual({ connectionString: 'postgres://worker-role/db', max: 8 });
    const db: any = createWorkerDatabase({ env: { REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://primary/db' } });
    expect(db).not.toBeNull(); await db.destroy();
  });
});

describe('the actor-stamp plugin is installed only when the app supplies the actor', () => {
  const plugins = (db: any): unknown[] => db.getExecutor().plugins;
  it('currentActor given → ActorStampPlugin; absent or DB_ACTOR_STAMP=off → none', async () => {
    const env = { REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://x/y' };
    const a: any = createDatabase({ env, currentActor: () => null });
    expect(plugins(a).some((p) => p instanceof ActorStampPlugin)).toBe(true);
    const b: any = createDatabase({ env });
    expect(plugins(b).length).toBe(0);
    const c: any = createDatabase({ env: { ...env, DB_ACTOR_STAMP: 'off' }, currentActor: () => null });
    expect(plugins(c).length).toBe(0);
    await Promise.all([a.destroy(), b.destroy(), c.destroy()]);
  });
});
