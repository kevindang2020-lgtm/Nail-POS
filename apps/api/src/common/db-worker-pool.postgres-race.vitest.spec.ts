import { randomBytes } from 'node:crypto';
// db-worker-pool.postgres-race — Phase 10 (Constitution 1 §6, §60–61) on REAL Postgres (PG_RACE_URL):
//   * the API pool and the WORKER pool are separate pools with role-specific timeouts — a statement the API pool cancels
//     at its limit finishes on the worker pool, and the two show up as different application_names;
//   * with DB_TENANT_RLS=1 a connection never carries a salon into the next checkout (release-time reset), runAcrossTenants
//     and out-of-request code carry '*', strict mode is set on the session, and tenantTransaction's tenant is LOCAL to its
//     transaction — and on the migrated schema, as a NON-superuser, the policies actually filter.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { sql } from 'kysely';
import pg from 'pg';
import { createDatabase, createWorkerDatabase, runWithTenant, runAcrossTenants, tenantTransaction } from '@aipowersalon/database';

const url = process.env.PG_RACE_URL;
const A = 'aaaaaaaa-0000-4000-8000-0000000d0a01';
const B = 'bbbbbbbb-0000-4000-8000-0000000d0b02';
const setting = async (db: any) => (await sql<{ t: string; s: string }>`select current_setting('app.tenant_id', true) as t, current_setting('app.tenant_strict', true) as s`.execute(db)).rows[0];

describe.skipIf(!url)('the worker pool is a separate pool with its own timeouts', () => {
  const APP = `aps-p10-pool-${process.pid}`;
  const env = { REPO_DRIVER: 'postgres', DATABASE_URL: url, PROCESS_ROLE: 'api', PG_POOL_MAX: '2', PG_APPLICATION_NAME: APP, PG_STATEMENT_TIMEOUT_MS: '300' } as NodeJS.ProcessEnv;
  const api = url ? createDatabase({ env })! : (null as any);
  const worker = url ? createWorkerDatabase({ env })! : (null as any);
  afterAll(async () => { await api?.destroy(); await worker?.destroy(); });

  it('statement_timeout differs by role: the API pool cancels a 1 s statement, the worker pool finishes it', async () => {
    await expect(sql`select pg_sleep(1)`.execute(api)).rejects.toThrow(/statement timeout/i);
    await expect(sql`select pg_sleep(1)`.execute(worker)).resolves.toBeTruthy();
    const a: any = (await sql`select current_setting('statement_timeout') st, current_setting('idle_in_transaction_session_timeout') it, current_setting('application_name') app`.execute(api)).rows[0];
    const w: any = (await sql`select current_setting('statement_timeout') st, current_setting('idle_in_transaction_session_timeout') it, current_setting('application_name') app`.execute(worker)).rows[0];
    expect(a).toEqual({ st: '300ms', it: '30s', app: APP });
    expect(w).toEqual({ st: '10min', it: '2min', app: `${APP}-worker-pool` });
  });
  it('the two pools hold different backend connections', async () => {
    const [pa, pw]: any[] = await Promise.all([sql`select pg_backend_pid() p`.execute(api), sql`select pg_backend_pid() p`.execute(worker)]);
    expect(pa.rows[0].p).not.toBe(pw.rows[0].p);
  });
});

describe.skipIf(!url)('tenant session on real Postgres (DB_TENANT_RLS=1)', () => {
  const ROLE = `rls_p10_d_${process.pid}`;
  const ROLE_PASSWORD = `p${randomBytes(12).toString('hex')}`;
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  let db: any; let strictDb: any; let raw: any;
  beforeAll(async () => {
    // Oct 22 2026: the throwaway role gets a random password — a Postgres that requires one (scram for host connections,
    // as production does) refused the passwordless login ("client password must be a string"); a trusting one ignores it
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login; end if; end $$`);
    await admin.query(`alter role ${ROLE} password '${ROLE_PASSWORD}'`);
    await admin.query(`grant usage on schema public to ${ROLE}; grant select, insert, update, delete on all tables in schema public to ${ROLE}; grant execute on all functions in schema public to ${ROLE}`);
    for (const t of [A, B]) {
      await admin.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values ($1, 'T', 'T', $2, $2, 'active') on conflict do nothing`, [t, `p10d-${t.slice(0, 4)}`]);
      await admin.query(`insert into pos_queue_items (tenant_id, customer_name) values ($1, 'race-d')`, [t]);
    }
    const u = new URL(url!); u.username = ROLE; u.password = ROLE_PASSWORD;
    const base = { REPO_DRIVER: 'postgres', DATABASE_URL: u.toString(), PG_POOL_MAX: '1', DB_TENANT_RLS: '1' } as NodeJS.ProcessEnv;
    db = createDatabase({ env: base, poolHook: (p) => { raw = p; return p; } });   // the hook hands us the raw pool (telemetry's seat)
    strictDb = createDatabase({ env: { ...base, DB_TENANT_RLS_STRICT: '1' } });
  });
  afterAll(async () => {
    await db?.destroy(); await strictDb?.destroy();
    await admin.query(`delete from pos_queue_items where customer_name = 'race-d'`);
    await admin.query(`delete from tenants where id in ($1, $2)`, [A, B]).catch(() => undefined);
    await admin.query(`drop owned by ${ROLE}; drop role if exists ${ROLE}`).catch(() => undefined);
    await admin.end();
  });
  const seen = async (h: any) => (await sql<{ tenant_id: string }>`select tenant_id from pos_queue_items where customer_name = 'race-d' order by tenant_id`.execute(h)).rows.map((r) => (r.tenant_id === A ? 'A' : 'B'));

  it("one pooled connection: salon A's request, then code outside any request — the second never inherits A", async () => {
    expect(await runWithTenant(A, () => seen(db))).toEqual(['A']);
    expect(await setting(db)).toMatchObject({ t: '*' });          // the reset on release + '*' at checkout
    expect(await seen(db)).toEqual(['A', 'B']);
  });
  it("pool.query() that bypasses the wrapper (the raw pool) finds '' — not salon A — after A's request released the connection", async () => {
    expect(await runWithTenant(A, () => seen(db))).toEqual(['A']);
    const r = await raw.query(`select current_setting('app.tenant_id', true) t`);
    expect(r.rows[0].t).toBe('');
  });
  it('runAcrossTenants inside a request → every salon; a request with no tenant (non-strict) → every salon', async () => {
    expect(await runWithTenant(B, () => runAcrossTenants('race test', () => seen(db)))).toEqual(['A', 'B']);
    expect(await runWithTenant('', () => seen(db))).toEqual(['A', 'B']);
  });
  it('STRICT: a request with no tenant sees nothing; a salon sees its own; cross-tenant work still sees all', async () => {
    expect(await runWithTenant('', () => seen(strictDb))).toEqual([]);
    expect(await runWithTenant(B, () => seen(strictDb))).toEqual(['B']);
    expect(await runAcrossTenants('race test', () => seen(strictDb))).toEqual(['A', 'B']);
    expect((await runWithTenant(B, () => setting(strictDb))).s).toBe('on');
  });
  it("tenantTransaction: the tenant is LOCAL — inside it A only, after commit the connection's own setting is back", async () => {
    const inside = await tenantTransaction(db, A, async (trx) => ({ rows: await seen(trx), t: (await setting(trx)).t }));
    expect(inside).toEqual({ rows: ['A'], t: A });
    expect((await setting(db)).t).toBe('*');
  });
});
