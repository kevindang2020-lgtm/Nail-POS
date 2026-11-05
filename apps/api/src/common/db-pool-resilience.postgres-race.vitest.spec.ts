// db-pool-resilience.postgres-race.vitest.spec.ts — Phase 1 (BUILD_PLAN_2026-10-06): the database pool survives the
// database dropping its connections, and a runaway query is bounded. Pure parts always; real Postgres via PG_RACE_URL.
//
// The bug: the pool was `new Pool({ connectionString, max })` with no 'error' listener. When Postgres closes an IDLE
// pooled connection (a restart, a failover, an admin terminating backends), pg emits 'error' on the pool; with no
// listener Node raises it as an uncaught exception and the process exits — every API instance at the same moment.
import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'kysely';
import pg from 'pg';
import { createDatabase, poolOptions, keepPoolAlive } from '@aipowersalon/database';

describe('pool settings — the rules', () => {
  it('connect, idle, statement and idle-in-transaction timeouts are ON by default and overridable; 0 turns one off', () => {
    const d = poolOptions('postgres://x/y', 10, {});
    expect(d).toMatchObject({ max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, statement_timeout: 120_000, idle_in_transaction_session_timeout: 60_000 });
    const o = poolOptions('postgres://x/y', 4, { PG_STATEMENT_TIMEOUT_MS: '0', PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: '5000', PG_CONNECT_TIMEOUT_MS: 'nonsense' });
    expect(o).not.toHaveProperty('statement_timeout');
    expect(o).toMatchObject({ idle_in_transaction_session_timeout: 5000, connectionTimeoutMillis: 10_000 });
    expect(poolOptions('p', 1, { PROCESS_ROLE: 'worker' }).application_name).toBe('aipowersalon-worker');
  });

  it('an error emitted on the pool is logged, not thrown', () => {
    const pool = new pg.Pool({ connectionString: 'postgres://nowhere/none' });
    const logs: string[] = [];
    keepPoolAlive(pool, (m) => logs.push(m));
    expect(() => pool.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))).not.toThrow();
    expect(logs[0]).toMatch(/57P01/);
    void pool.end();
  });
});

const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('the pool on real Postgres', () => {
  const APP = `aps-pool-resilience-${process.pid}`;
  const env = { REPO_DRIVER: 'postgres', DATABASE_URL: url, PG_POOL_MAX: '3', PG_APPLICATION_NAME: APP, PG_STATEMENT_TIMEOUT_MS: '400' } as NodeJS.ProcessEnv;
  const db = url ? createDatabase({ env })! : (null as any);
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  it('the database terminating the pool\'s idle connections does NOT take the process down; the next query reconnects', async () => {
    // Warm three idle connections.
    await Promise.all([1, 2, 3].map(() => sql`select pg_sleep(0.05)`.execute(db)));
    const killed: any = await admin.query(`select count(pg_terminate_backend(pid))::int n from pg_stat_activity where application_name = $1 and pid <> pg_backend_pid()`, [APP]);
    expect(killed.rows[0].n).toBeGreaterThan(0);
    // Give pg time to notice the closed sockets and emit 'error' on the pool (this is where the process used to exit).
    await new Promise((r) => setTimeout(r, 300));
    const r: any = await sql`select 1 as ok`.execute(db);
    expect(r.rows[0].ok).toBe(1);
  });

  it('a runaway statement is cancelled by statement_timeout instead of holding a connection forever', async () => {
    await expect(sql`select pg_sleep(3)`.execute(db)).rejects.toThrow(/statement timeout/i);
    const r: any = await sql`select current_setting('statement_timeout') as t, current_setting('application_name') as a`.execute(db);
    expect(r.rows[0]).toMatchObject({ t: '400ms', a: APP });
  });
});
