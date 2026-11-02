import { describe, it, expect } from 'vitest';
import { runWithTenant, currentDbTenant, withTenantSession } from './tenant-session';

function fakePool() {
  const sent: { client: number; sql: string; params: unknown[] }[] = [];
  const clients = [0, 1].map((id) => ({ id, query: async (sql: string, params: unknown[]) => { sent.push({ client: id, sql, params }); return { rows: [] }; }, release: () => {} }));
  let next = 0;
  const pool: any = { connect: async () => clients[next++ % clients.length], end: async () => {}, totalCount: 2 };
  return { pool, sent };
}
const ON = { DB_TENANT_RLS: '1' } as any;

describe('tenant session (row-level security)', () => {
  it('flag OFF: the pool is returned untouched and nothing is sent', async () => {
    const { pool, sent } = fakePool();
    expect(withTenantSession(pool, {} as any)).toBe(pool);
    await runWithTenant('t1', async () => { await pool.connect(); });
    expect(sent).toEqual([]);
  });
  it("flag ON: a request's connection carries its tenant; outside any request (schedulers, start-up) it carries '*'", async () => {
    const { pool, sent } = fakePool(); const p = withTenantSession(pool, ON);
    await runWithTenant('t1', async () => { await p.connect(); });
    await p.connect();
    expect(sent.map((s) => s.params[0])).toEqual(['t1', '*']);
    expect(sent.every((s) => /set_config\('app\.tenant_id', \$1, false\)/.test(s.sql))).toBe(true);
  });
  it('no round trip when the connection already holds that tenant', async () => {
    const { pool, sent } = fakePool(); const p = withTenantSession(pool, ON);
    await runWithTenant('t1', async () => { await p.connect(); await p.connect(); await p.connect(); });   // clients 0,1,0
    expect(sent.length).toBe(2);
  });
  it('the tenant follows the async context, not the last caller', async () => {
    const seen: string[] = [];
    await Promise.all([runWithTenant('a', async () => { await new Promise((r) => setTimeout(r, 5)); seen.push(currentDbTenant()); }),
                       runWithTenant('b', async () => { seen.push(currentDbTenant()); })]);
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(currentDbTenant()).toBe('');
  });
});

describe('runAcrossTenants', () => {
  it('clears the tenant for its callback only, and demands a reason', async () => {
    const { runAcrossTenants } = await import('./tenant-session');
    await runWithTenant('t1', async () => {
      expect(currentDbTenant()).toBe('t1');
      await runAcrossTenants('owner multi-salon portfolio', async () => { expect(currentDbTenant()).toBe(''); });
      expect(currentDbTenant()).toBe('t1');
    });
    expect(() => runAcrossTenants('  ', () => 1)).toThrow(/needs a reason/);
  });

  it('a later layer assigning pool.connect = … on the wrapped pool (telemetry does this) must not recurse — Oct 3 2026 RLS trial', async () => {
    const { pool } = fakePool(); const p: any = withTenantSession(pool, ON);
    // the telemetry pattern: capture the current connect, assign a wrapper — on the PROXY, which writes through to the raw pool
    const before = p.connect.bind(p); let hooked = 0;
    p.connect = async () => { hooked++; return before(); };
    const c = await runWithTenant('t1', () => p.connect());
    expect(c).toBeTruthy();
    expect(hooked).toBeLessThanOrEqual(1);   // once — never a loop
  });
});

// ---- Phase 10 (Constitution 1 §6, audit build-order 9 + 12): release-time reset, strict mode, the explicit cross-tenant
// marker, and the per-transaction path that survives PgBouncer transaction pooling.
function releasingPool() {
  const sent: { client: number; sql: string; params: unknown[] }[] = [];
  const released: { client: number; err?: unknown }[] = [];
  const clients = [0].map((id) => {
    const c: any = { id, query: async (sql: string, params: unknown[]) => { sent.push({ client: id, sql, params }); return { rows: [] }; } };
    return c;
  });
  // pg-pool assigns a fresh client.release on EVERY checkout — mimic that, so a wrapper installed once would be lost
  const pool: any = { connect: async () => { const c = clients[0]; c.release = (err?: unknown) => { released.push({ client: c.id, err }); }; return c; }, end: async () => {} };
  return { pool, sent, released };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('tenant session — Phase 10', () => {
  it("a request with NO tenant carries '' (not '*'): strict mode refuses it, permissive mode admits it", async () => {
    const { pool, sent } = fakePool(); const p = withTenantSession(pool, ON);
    await runWithTenant('', async () => { await p.connect(); });
    expect(sent.map((s) => s.params[0])).toEqual(['']);
  });
  it("runAcrossTenants marks the session '*' — the deliberate cross-tenant marker the strict policy admits", async () => {
    const { runAcrossTenants } = await import('./tenant-session');
    const { pool, sent } = fakePool(); const p = withTenantSession(pool, ON);
    await runWithTenant('t1', () => runAcrossTenants('owner multi-salon portfolio', async () => { await p.connect(); }));
    expect(sent.map((s) => s.params[0])).toEqual(['*']);
  });
  it('strict mode (DB_TENANT_RLS_STRICT=1) sends app.tenant_strict=on with the tenant; off sends it empty', async () => {
    const a = fakePool(); await runWithTenant('t1', () => withTenantSession(a.pool, { ...ON, DB_TENANT_RLS_STRICT: '1' }).connect());
    expect(a.sent[0].sql).toMatch(/set_config\('app\.tenant_strict', \$2, false\)/);
    expect(a.sent[0].params).toEqual(['t1', 'on']);
    const b = fakePool(); await runWithTenant('t1', () => withTenantSession(b.pool, ON).connect());
    expect(b.sent[0].params).toEqual(['t1', '']);
  });
  it("release resets app.tenant_id to '' BEFORE the connection returns to the pool — no tenant leaks into the next checkout", async () => {
    const { pool, sent, released } = releasingPool(); const p = withTenantSession(pool, ON);
    const c: any = await runWithTenant('t1', () => p.connect());
    c.release(); await flush();
    expect(sent.map((s) => s.params[0])).toEqual(['t1', '']);
    expect(sent[1].sql).toMatch(/set_config\('app\.tenant_id', \$1, false\)/);
    expect(released).toEqual([{ client: 0, err: undefined }]);              // released once, after the reset
    // the next checkout by a no-tenant request needs no round trip: the connection already holds ''
    const c2: any = await runWithTenant('', () => p.connect()); c2.release(); await flush();
    expect(sent.length).toBe(2);
  });
  it('release(err) does not reset — the broken connection is destroyed with its error', async () => {
    const { pool, sent, released } = releasingPool(); const p = withTenantSession(pool, ON);
    const c: any = await runWithTenant('t1', () => p.connect());
    const boom = new Error('broken'); c.release(boom); await flush();
    expect(sent.length).toBe(1);
    expect(released).toEqual([{ client: 0, err: boom }]);
  });
  it('a failed reset destroys the connection instead of returning it with a tenant still set', async () => {
    const { pool, released } = releasingPool(); const p = withTenantSession(pool, ON);
    const c: any = await runWithTenant('t1', () => p.connect());
    c.query = async () => { throw new Error('reset failed'); };
    c.release(); await flush();
    expect(released.length).toBe(1);
    expect(String((released[0].err as Error)?.message)).toMatch(/reset failed/);
  });
  it("DB_TENANT_RLS_SCOPE=transaction (PgBouncer transaction pooling): nothing is set per connection", async () => {
    const { pool, sent } = releasingPool(); const p = withTenantSession(pool, { ...ON, DB_TENANT_RLS_SCOPE: 'transaction' });
    const c: any = await runWithTenant('t1', () => p.connect()); c.release(); await flush();
    expect(sent).toEqual([]);
  });
});

describe('tenantTransaction — the tenant set LOCAL to one transaction', () => {
  function recordingKysely() {
    const sent: { sql: string; params: readonly unknown[] }[] = [];
    const conn = { async executeQuery(q: any) { sent.push({ sql: q.sql, params: q.parameters }); return { rows: [] }; }, async *streamQuery() {} };
    const driver = { async init() {}, async acquireConnection() { return conn; }, async beginTransaction() { sent.push({ sql: 'begin', params: [] }); }, async commitTransaction() { sent.push({ sql: 'commit', params: [] }); }, async rollbackTransaction() {}, async releaseConnection() {}, async destroy() {} };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } = require('kysely');
    const db = new Kysely({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => driver, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
    return { db, sent };
  }
  it('flag ON: set_config(..., true) as the transaction\'s first statement, and the callback runs as that tenant', async () => {
    const { tenantTransaction } = await import('./tenant-session');
    const { db, sent } = recordingKysely(); let inside = '';
    await tenantTransaction(db, 't1', async () => { inside = currentDbTenant(); }, { ...ON, DB_TENANT_RLS_STRICT: '1' } as any);
    expect(sent[0].sql).toBe('begin');
    expect(sent[1].sql).toMatch(/set_config\('app\.tenant_id', \$1, true\).*set_config\('app\.tenant_strict', \$2, true\)/);
    expect(sent[1].params).toEqual(['t1', 'on']);
    expect(inside).toBe('t1');
  });
  it('flag OFF: nothing is sent — only the transaction', async () => {
    const { tenantTransaction } = await import('./tenant-session');
    const { db, sent } = recordingKysely();
    await tenantTransaction(db, 't1', async () => undefined, {} as any);
    expect(sent.map((s) => s.sql)).toEqual(['begin', 'commit']);
  });
  it('refuses an empty tenant — a tenant transaction must name its salon', async () => {
    const { tenantTransaction } = await import('./tenant-session');
    const { db } = recordingKysely();
    await expect(tenantTransaction(db, '', async () => undefined, ON)).rejects.toThrow(/needs a tenant/);
  });
});
