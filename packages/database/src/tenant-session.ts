// tenant-session.ts — Postgres row-level security's half of the connection (Constitution 12 defence in depth; Constitution 1
// §6 and the Oct 6 2026 audit's build order 9 + 12).
//
// A row-level-security policy reads the CURRENT SALON from a session setting, `app.tenant_id` (migrations 458, 517, 544):
//   '<uuid>'  a salon's request — only that salon's rows;
//   '*'       deliberate cross-tenant work — Super Admin, runAcrossTenants(reason), and code running OUTSIDE any request
//             (schedulers, workers, start-up), which is platform code by construction;
//   ''        a request that carries no tenant — permissive by default, NOTHING when strict (DB_TENANT_RLS_STRICT=1, which
//             also sends app.tenant_strict='on').
// This module keeps that setting correct on every pooled connection the app checks out:
//   * a request's tenant is carried in AsyncLocalStorage — runWithTenant(tenantId, next) in the tenant-context middleware;
//   * withTenantSession(pool) wraps pool.connect(): when DB_TENANT_RLS=1 it sets app.tenant_id on the checked-out
//     connection (skipping the round trip when the connection already holds that value), and resets it to '' when the
//     connection is RELEASED, so a tenant never rides a pooled connection into the next checkout (or into a pool.query()
//     that bypasses this wrapper);
//   * tenantTransaction(db, tenantId, fn) sets the tenant LOCAL to one transaction (set_config(..., true)) — the only form
//     that is safe behind PgBouncer transaction pooling, where consecutive statements may land on different server
//     connections. DB_TENANT_RLS_SCOPE=transaction turns the per-connection setting off for that deployment.
// With DB_TENANT_RLS unset nothing is sent and the policies (permissive while app.tenant_id is empty) change nothing — so
// shipping this is inert until the flag is turned on.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';

const store = new AsyncLocalStorage<{ tenantId: string; across?: boolean }>();
/** The value that marks deliberate cross-tenant work for the policies (migration 544's app_session_unrestricted()). */
export const ACROSS_TENANTS = '*';

/** Run `fn` with `tenantId` as the database session's tenant for every query it makes (sync or async). */
export function runWithTenant<T>(tenantId: string | null | undefined, fn: () => T): T {
  return store.run({ tenantId: tenantId ? String(tenantId) : '' }, fn);
}
/** The tenant the current async context runs as ('' when none, and inside runAcrossTenants). */
export function currentDbTenant(): string { return store.getStore()?.tenantId ?? ''; }

/** What app.tenant_id should hold for the current async context: the request's tenant; '*' inside runAcrossTenants or
 *  outside any request (schedulers, workers, start-up); '' for a request that carries no tenant. */
export function currentDbSessionSetting(): string {
  const s = store.getStore();
  if (!s || s.across) return ACROSS_TENANTS;
  return s.tenantId;
}

const truthy = (v: unknown) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
export function tenantSessionEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return truthy(env.DB_TENANT_RLS); }
/** Strict mode: a session with NO tenant sees nothing (instead of everything). Only meaningful with DB_TENANT_RLS=1. */
export function tenantSessionStrict(env: NodeJS.ProcessEnv = process.env): boolean { return truthy(env.DB_TENANT_RLS_STRICT); }
/** 'connection' (default): set per checked-out connection + reset on release. 'transaction': only tenantTransaction sets
 *  it (PgBouncer transaction pooling — a session-level setting would be shared by whoever gets that server connection). */
export function tenantSessionScope(env: NodeJS.ProcessEnv = process.env): 'connection' | 'transaction' {
  return String(env.DB_TENANT_RLS_SCOPE ?? '').trim().toLowerCase() === 'transaction' ? 'transaction' : 'connection';
}

/** Wrap a pg Pool so every checked-out connection carries the current tenant in `app.tenant_id` (when enabled). */
export function withTenantSession(pool: Pool, env: NodeJS.ProcessEnv = process.env): Pool {
  if (!tenantSessionEnabled(env)) return pool;
  if (tenantSessionScope(env) === 'transaction') return pool;   // tenantTransaction sets it LOCAL; nothing per connection
  const strict = tenantSessionStrict(env) ? 'on' : '';
  const held = new WeakMap<PoolClient, string>();
  // Capture the pool's connect NOW. A later layer that assigns `pool.connect = …` on the returned proxy lands on the raw
  // pool (a Proxy without a set trap writes through), and calling `pool.connect()` from here would then re-enter that
  // layer, which re-enters this one — the infinite recursion the Oct 3 2026 RLS trial hit on every connection
  // (telemetry wraps connect exactly that way).
  const rawConnect: () => Promise<PoolClient> = pool.connect.bind(pool);
  const connect = async (): Promise<PoolClient> => {
    const client = await rawConnect();
    const want = currentDbSessionSetting();
    if (held.get(client) !== want) {
      try {
        await client.query(`select set_config('app.tenant_id', $1, false), set_config('app.tenant_strict', $2, false)`, [want, strict]);
        held.set(client, want);
      } catch (e) { held.delete(client); client.release(e as Error); throw e; }   // never hand out a connection with an unknown tenant
    }
    // pg-pool assigns client.release afresh on every checkout, so the reset is installed on every checkout too. Holding
    // '' already (a no-tenant request) needs no round trip; a failed reset destroys the connection rather than returning
    // it to the pool with a tenant still set.
    const release = client.release.bind(client);
    let done = false;
    (client as any).release = (err?: Error | boolean) => {
      if (done) return release(err as any);
      done = true;
      if (err || held.get(client) === '') return release(err as any);
      client.query(`select set_config('app.tenant_id', $1, false)`, ['']).then(
        () => { held.set(client, ''); release(); },
        (e: Error) => { held.delete(client); release(e); },
      );
    };
    return client;
  };
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'connect') return (cb?: (err: Error | undefined, client?: PoolClient, done?: () => void) => void) => {
        if (!cb) return connect();
        connect().then((c) => cb(undefined, c, () => c.release()), (e) => cb(e));
        return undefined;
      };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Run `fn` with NO tenant on the database session — the ONLY sanctioned way for code inside a tenant request to read
 *  across salons (an owner's multi-salon portfolio, a customer who spans salons, a shared gift-card program). `reason`
 *  names the business rule; it is required so a cross-salon read is never accidental, and so it can be found by grep. */
export function runAcrossTenants<T>(reason: string, fn: () => T): T {
  if (!reason || !reason.trim()) throw new Error('runAcrossTenants needs a reason — a cross-salon read must be deliberate');
  return store.run({ tenantId: '', across: true }, fn);
}

/** Cross salons INSIDE an open transaction. runAcrossTenants works by choosing the tenant a connection is checked out
 *  with, so inside a transaction — whose connection is already checked out, carrying the request's tenant — it has no
 *  effect. This clears app.tenant_id LOCALLY for the transaction while `fn` runs, then puts the request's tenant back
 *  (set_config(..., true) cannot outlive the transaction either way). Outside a transaction it defers to runAcrossTenants.
 *  With DB_TENANT_RLS off it sends nothing. */
export async function acrossTenantsIn<T>(exec: { isTransaction?: boolean; executeQuery?: unknown }, reason: string, fn: () => Promise<T>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  if (!reason || !reason.trim()) throw new Error('acrossTenantsIn needs a reason — a cross-salon read must be deliberate');
  if (!(exec as any)?.isTransaction) return runAcrossTenants(reason, fn);
  if (!tenantSessionEnabled(env)) return fn();
  const { sql } = await import('kysely');
  const restore = currentDbSessionSetting();
  await sql`select set_config('app.tenant_id', ${ACROSS_TENANTS}, true)`.execute(exec as any);
  try { return await runAcrossTenants(reason, fn); }
  finally { await sql`select set_config('app.tenant_id', ${restore}, true)`.execute(exec as any); }
}

/** Run `fn` inside ONE transaction whose app.tenant_id is `tenantId`, set LOCAL to the transaction (set_config(..., true))
 *  as its first statement — correct even behind PgBouncer transaction pooling, where a session-level setting is not. The
 *  callback also runs as that tenant (currentDbTenant()), so anything it checks out carries the same tenant. With
 *  DB_TENANT_RLS off it is a plain transaction (nothing extra is sent). */
export async function tenantTransaction<DBT, T>(
  db: { transaction(): { execute(cb: (trx: any) => Promise<T>): Promise<T> } } & DBT,
  tenantId: string, fn: (trx: any) => Promise<T>, env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const tenant = String(tenantId ?? '').trim();
  if (!tenant) throw new Error('tenantTransaction needs a tenant — use runAcrossTenants for deliberate cross-salon work');
  const on = tenantSessionEnabled(env);
  const strict = tenantSessionStrict(env) ? 'on' : '';
  const { sql } = await import('kysely');
  return runWithTenant(tenant, () => db.transaction().execute(async (trx: any) => {
    if (on) await sql`select set_config('app.tenant_id', ${tenant}, true), set_config('app.tenant_strict', ${strict}, true)`.execute(trx);
    return fn(trx);
  }));
}
