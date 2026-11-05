// kysely.provider.ts — provides a Kysely<DB> bound to Postgres when REPO_DRIVER=postgres and DATABASE_URL are set;
// otherwise provides null so feature modules fall back to their in-memory repositories (dev/tests, no DB required).
//
// Scaling seam (Roadmap Phase 1.2 — read/write split): DATABASE is the PRIMARY (all writes + read-after-write).
// DATABASE_READ is a REPLICA handle for read-only, latency-tolerant queries (overview/dashboards/reports/oversight).
// When DATABASE_REPLICA_URL is unset, DATABASE_READ transparently reuses the primary handle, so local/dev/tests and
// any single-node deployment are completely unaffected — routing a repo to DATABASE_READ is a no-risk change.
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './kysely.types';
import { withTenantSession } from './tenant-session';
import { actorStampPlugins } from './actor-stamp.plugin';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_READ = Symbol('DATABASE_READ');
/** The WORKER pool (Constitution 1 §60–61): background jobs get their own connections (PG_WORKER_POOL_MAX, default 5) and
 *  their own, longer timeouts, so a burst of jobs can never take the connections an HTTP request needs. Optional
 *  PG_WORKER_DATABASE_URL points it at a separate, least-privilege database role later (no code change). */
export const DATABASE_WORKER = Symbol('DATABASE_WORKER');
export type AppDatabase = Kysely<DB> | null;

/** A hook applied to every pool this package creates — the API passes its query telemetry (Constitution 11 §40–43).
 *  Injected, because @aipowersalon/database is a platform package and never imports the app (Constitution 13 §72, §105). */
export type PoolHook = (pool: Pool, poolMax: number) => Pool;
export interface DatabaseOptions {
  env?: NodeJS.ProcessEnv; poolHook?: PoolHook;
  /** Called once with the primary handle as soon as it exists — before any module's onModuleInit runs (the API uses it
   *  to install the scheduler lease coordinator, so no scheduler's first tick can run uncoordinated). */
  onPrimary?: (db: Kysely<DB>) => void;
  /** The person behind the current statement (a uuid), for the actor-stamp plugin (created_by / updated_by / deleted_by).
   *  Injected — the API reads it from its request context. Absent: nothing is stamped. DB_ACTOR_STAMP=off disables it. */
  currentActor?: () => string | null | undefined;
}

const intEnv = (v: string | undefined, dflt: number): number => {
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
};

/** Per-role timeout defaults (Constitution 1 §60–61, Phase 10): an HTTP request that runs 30 s is already a failure, so
 *  the API's pool cancels it there and never lets a transaction sit idle longer; a worker's batch legitimately runs
 *  minutes. 'all' (one process doing both — the default deployment) keeps the earlier middle ground. */
export const ROLE_TIMEOUTS: Readonly<Record<'api' | 'worker' | 'all', { statement: number; idleInTx: number }>> = {
  api: { statement: 30_000, idleInTx: 30_000 },
  worker: { statement: 600_000, idleInTx: 120_000 },
  all: { statement: 120_000, idleInTx: 60_000 },
};
export type PoolRole = keyof typeof ROLE_TIMEOUTS;
const roleOf = (env: NodeJS.ProcessEnv): PoolRole => {
  const r = String(env.PROCESS_ROLE ?? 'all').trim().toLowerCase();
  return r === 'api' || r === 'worker' ? r : 'all';
};

/** The pool's connection settings (Constitution 1 §60, Constitution 4 §51–55). Before Oct 6 2026 the pool had only
 *  `max`: no connect timeout (a dead primary hung every request), and no statement / idle-in-transaction timeout (one
 *  runaway query or a transaction left open held a connection — and its locks — forever). Defaults follow the pool's
 *  role (ROLE_TIMEOUTS: PROCESS_ROLE for the primary pool, 'worker' for the worker pool); each is overridable
 *  (PG_STATEMENT_TIMEOUT_MS / PG_IDLE_IN_TRANSACTION_TIMEOUT_MS, or PG_WORKER_* for the worker pool); 0 turns a timeout
 *  off. Migrations do not use this pool (scripts/migrate.mjs has its own client). */
export function poolOptions(connectionString: string, poolMax: number, env: NodeJS.ProcessEnv = process.env, pool: 'primary' | 'worker' = 'primary') {
  const role: PoolRole = pool === 'worker' ? 'worker' : roleOf(env);
  const d = ROLE_TIMEOUTS[role];
  const statement = intEnv(pool === 'worker' ? env.PG_WORKER_STATEMENT_TIMEOUT_MS : env.PG_STATEMENT_TIMEOUT_MS, d.statement);
  const idleInTx = intEnv(pool === 'worker' ? env.PG_WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS : env.PG_IDLE_IN_TRANSACTION_TIMEOUT_MS, d.idleInTx);
  return {
    connectionString,
    max: poolMax,
    connectionTimeoutMillis: intEnv(env.PG_CONNECT_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: intEnv(env.PG_IDLE_TIMEOUT_MS, 30_000),
    application_name: pool === 'worker'
      ? (env.PG_WORKER_APPLICATION_NAME || `${env.PG_APPLICATION_NAME || 'aipowersalon'}-worker-pool`)
      : (env.PG_APPLICATION_NAME || `aipowersalon-${env.PROCESS_ROLE || 'all'}`),
    ...(statement > 0 ? { statement_timeout: statement } : {}),
    ...(idleInTx > 0 ? { idle_in_transaction_session_timeout: idleInTx } : {}),
  };
}

/** An idle client's error (the database restarted, a failover, a connection killed by the server) is emitted on the
 *  POOL. With no 'error' listener Node treats it as an unhandled 'error' event and the whole process exits — every
 *  instance at once on a database restart. The pool already discards the broken client; this keeps the process up and
 *  says what happened. */
export function keepPoolAlive(pool: Pool, log: (msg: string) => void = (m) => console.error(m)): Pool {
  pool.on('error', (err: Error & { code?: string }) => {
    log(`[database] an idle connection failed and was discarded (${err?.code ?? 'no code'}): ${String(err?.message ?? err).slice(0, 200)}`);
  });
  return pool;
}

function makeDb(connectionString: string, poolMax: number, hook?: PoolHook, env: NodeJS.ProcessEnv = process.env, opts: { currentActor?: DatabaseOptions['currentActor']; pool?: 'primary' | 'worker' } = {}): Kysely<DB> {
  // Telemetry wraps the RAW pool's connect (it assigns pool.connect = …); the tenant session wraps outside it (row-level
  // security; inert unless DB_TENANT_RLS=1) and captures that connect once. The reverse order — session inside, telemetry
  // assigning onto the session proxy — wrote the telemetry wrapper onto the raw pool and recursed forever (Oct 3 2026).
  const raw = keepPoolAlive(new Pool(poolOptions(connectionString, poolMax, env, opts.pool ?? 'primary')));
  const instrumented = hook ? hook(raw, poolMax) : raw;
  const pool = withTenantSession(instrumented, env);
  const dialect = new PostgresDialect({ pool });
  // The actor-stamp plugin (created_by / updated_by / deleted_by) — only when the app supplies who the actor is.
  return new Kysely<DB>({ dialect, plugins: actorStampPlugins(opts.currentActor, env) });
}

export function createDatabase(opts: DatabaseOptions = {}): AppDatabase {
  const env = opts.env ?? process.env;
  if (env.REPO_DRIVER !== 'postgres') return null;
  const connectionString = env.DATABASE_URL;
  if (!connectionString) return null;
  const db = makeDb(connectionString, Number(env.PG_POOL_MAX) || 10, opts.poolHook, env, { currentActor: opts.currentActor });
  opts.onPrimary?.(db);
  return db;
}

/** The worker handle (DATABASE_WORKER): its own pool — PG_WORKER_POOL_MAX connections (default 5), the 'worker' timeouts,
 *  PG_WORKER_DATABASE_URL when set (a least-privilege role later) else DATABASE_URL. pg opens connections lazily, so a
 *  process that never runs a job never opens one. Null without Postgres (in-memory mode). */
export function workerPoolSettings(env: NodeJS.ProcessEnv = process.env): { connectionString: string; max: number } | null {
  if (env.REPO_DRIVER !== 'postgres') return null;
  const connectionString = env.PG_WORKER_DATABASE_URL || env.DATABASE_URL;
  if (!connectionString) return null;
  return { connectionString, max: intEnv(env.PG_WORKER_POOL_MAX, 5) || 5 };
}
export function createWorkerDatabase(opts: DatabaseOptions = {}): AppDatabase {
  const env = opts.env ?? process.env;
  const s = workerPoolSettings(env);
  if (!s) return null;
  return makeDb(s.connectionString, s.max, opts.poolHook, env, { currentActor: opts.currentActor, pool: 'worker' });
}

// The read handle. Falls back to the primary factory when no replica URL is configured so nothing breaks without a
// replica. `primary` is injected so that, in the fallback case, reads share the exact same primary connection pool
// rather than opening a second one.
export function createReadDatabase(primary: AppDatabase, opts: DatabaseOptions = {}): AppDatabase {
  const env = opts.env ?? process.env;
  if (env.REPO_DRIVER !== 'postgres') return null;
  const replicaUrl = env.DATABASE_REPLICA_URL;
  if (!replicaUrl) return primary; // no replica configured → read from the primary handle (no extra pool)
  return makeDb(replicaUrl, Number(env.PG_READ_POOL_MAX) || Number(env.PG_POOL_MAX) || 10, opts.poolHook, env, { currentActor: opts.currentActor });
}
