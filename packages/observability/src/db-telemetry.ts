// db-telemetry.ts — Constitution 11 §40–43, §195, §313, §367: database observability at the ONE place every query
// passes through.
//
// HOW. Kysely's PostgresDialect calls `pool.connect()` and then `client.query(sql, params)`. Wrapping the client
// that connect() hands back is the ONE choke point every query passes through, it sees the exact compiled SQL,
// and it is transparent to Kysely and to every repository (§195: "do not manually instrument every SQL
// statement"). A first draft also added a Kysely plugin; it would have double-counted every query and cannot even
// see the SQL in transformResult, so it was removed — one mechanism. The pool exposes its own counts, read on
// demand by the gauges (§40: active connections, utilisation, waiting callers).
//
// THE FINGERPRINT (§42). Compiled SQL already has placeholders — `where "tenant_id" = $1` — so parameter VALUES are
// never part of it (§41, §367: no PII in query telemetry). What varies is shape: `in ($1, $2, $3)` versus
// `in ($1, $2)`, and `values ($1, $2), ($3, $4)` for batched inserts. Both collapse to one fingerprint so a
// 3-row insert and a 300-row insert are the same query. Whitespace is normalised, the result is truncated, and
// the LABEL is the fingerprint's hash plus the first table name — a hash keeps a 2 KB query out of a metric label
// while the table name keeps the label readable. The full fingerprint is kept in a bounded in-process table for
// the diagnostics API (§43: slow-query telemetry names the shape, the service, the duration and the rows).
//
// N+1 (§43). The ambient request context carries a per-request query counter; the request-scope reader in
// http-metrics reports it, so a route that runs 300 queries per request shows up as a histogram outlier, not as
// 300 individual samples.
//
// WHAT THIS DOES NOT DO: log SQL. Never. And a plugin error never fails a query — every hook is wrapped.
import { createHash } from 'node:crypto';
import { registry } from './metrics';
import { getContext } from './request-context';
import { startSpan, tracingEnabled, nowMs, type Span } from './tracing/span';

// §364: buckets tuned for OLTP queries, in seconds — most are sub-10 ms; a 1 s query is already an incident.
export const DB_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export const dbQueries = registry.counter('aipowersalon_db_queries_total', 'Queries executed', ['operation', 'table']);
export const dbQueryErrors = registry.counter('aipowersalon_db_query_errors_total', 'Queries that raised', ['operation', 'table']);
export const dbQueryDuration = registry.histogram('aipowersalon_db_query_duration_seconds', 'Query latency', ['operation', 'table'], DB_BUCKETS);
export const dbSlowQueries = registry.counter('aipowersalon_db_slow_queries_total', 'Queries over the slow threshold', ['operation', 'table']);
export const dbPoolTotal = registry.gauge('aipowersalon_db_pool_connections', 'Pool connections by state', ['state']);
export const dbPoolUtilisation = registry.gauge('aipowersalon_db_pool_utilisation_ratio', 'Connections in use / pool max (0–1)', []);
export const dbQueriesPerRequest = registry.histogram('aipowersalon_db_queries_per_request', 'Queries issued while serving one request (N+1 detector)', [],
  [1, 2, 5, 10, 20, 50, 100, 200, 500]);

export const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS ?? 250);

/** §42: same shape ⇒ same fingerprint. Parameter values are never present in compiled SQL. */
export function fingerprint(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\$\d+(?:\s*,\s*\$\d+)*\s*\)/g, '($?)')             // in ($1, $2, $3) → in ($?)
    .replace(/(\(\$\?\)\s*,\s*)+\(\$\?\)/g, '($?)')                     // values ($?), ($?), ($?) → values ($?)
    .replace(/\$\d+/g, '$?')                                           // any remaining $7 → $?
    .replace(/\b\d{2,}\b/g, 'N')                                       // limit 500 / offset 20 → N (literal ints only)
    .trim()
    .slice(0, 500);
}

/** The operation and first table, for LABELS (low cardinality); everything else stays in the fingerprint table. */
export function classify(sql: string): { operation: string; table: string } {
  const s = sql.trimStart().toLowerCase();
  const operation = /^(select|insert|update|delete|with)\b/.exec(s)?.[1] ?? 'other';
  const m = /\b(?:from|into|update|join)\s+"?([a-z_][a-z0-9_]*)"?/.exec(s);
  return { operation: operation === 'with' ? 'select' : operation, table: m?.[1] ?? 'unknown' };
}

export interface SlowQueryRecord { hash: string; fingerprint: string; operation: string; table: string; durationMs: number; rows: number; at: number; requestId: string | null; tenantId: string | null }

// §43 diagnostics: the slowest recent shapes, bounded so a runaway query cannot grow the process.
const SLOW_LOG_MAX = 200;
const slowLog: SlowQueryRecord[] = [];
export function recentSlowQueries(): SlowQueryRecord[] { return [...slowLog].sort((a, b) => b.durationMs - a.durationMs); }
export function resetSlowQueries(): void { slowLog.length = 0; }

/** The shared record path, used by both the plugin and the executor hook. Exported for tests. */
export function record(q: { sql: string; durationMs: number; rows: number; error?: boolean }): void {
  const { operation, table } = classify(q.sql);
  const labels = { operation, table };
  if (q.error) { dbQueryErrors.inc(labels); return; }
  dbQueries.inc(labels);
  dbQueryDuration.observe(q.durationMs / 1000, labels);
  const ctx = getContext();
  if (ctx) { ctx.dbQueries = (ctx.dbQueries ?? 0) + 1; ctx.dbMs = (ctx.dbMs ?? 0) + q.durationMs; }
  if (q.durationMs >= SLOW_QUERY_MS) {
    dbSlowQueries.inc(labels);
    const fp = fingerprint(q.sql);
    slowLog.push({ hash: createHash('sha1').update(fp).digest('hex').slice(0, 12), fingerprint: fp, operation, table,
      durationMs: Math.round(q.durationMs), rows: q.rows, at: Date.now(), requestId: ctx?.requestId ?? null, tenantId: ctx?.tenantId ?? null });
    if (slowLog.length > SLOW_LOG_MAX) slowLog.splice(0, slowLog.length - SLOW_LOG_MAX);
  }
}

/**
 * BUILD_PLAN Phase 11: a DB span per query issued inside a request/job/event context — a child of that context's span.
 * The statement attribute is the FINGERPRINT (placeholders, `in ($?)`), never a parameter value. Outside any context
 * (a scheduler's lease query, the migration runner) no span is made: it would be a one-span trace about nothing.
 */
function querySpan(sql: string): Span | null {
  try {
    if (!tracingEnabled() || !getContext()) return null;
    const { operation, table } = classify(sql);
    return startSpan(`db ${operation} ${table}`, { kind: 'client', startMs: nowMs(), attributes: {
      'db.system': 'postgresql', 'db.operation': operation, 'db.sql.table': table, 'db.statement': fingerprint(sql),
    } });
  } catch { return null; }
}

/**
 * Wraps a pg Pool so every query is timed with its EXACT compiled SQL (fingerprinted, never logged) and so the
 * pool's counts feed the gauges. Kysely's PostgresDialect calls `pool.connect()` and then `client.query()`; wrapping
 * the client returned by connect() is the single choke point, and it is transparent to Kysely.
 */
export function attachDbTelemetry<P extends { connect: () => Promise<any>; totalCount?: number; idleCount?: number; waitingCount?: number; options?: { max?: number } }>(pool: P, poolMax: number): P {
  const originalConnect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await originalConnect();
    if (client && !client.__aipowersalonInstrumented) {
      const originalQuery = client.query.bind(client);
      client.query = async (config: any, ...rest: any[]) => {
        const sql: string = typeof config === 'string' ? config : config?.text ?? '';
        const span = querySpan(sql);
        const startedAt = performance.now();
        try {
          const res = await originalQuery(config, ...rest);
          record({ sql, durationMs: performance.now() - startedAt, rows: Array.isArray(res?.rows) ? res.rows.length : 0 });
          span?.setAttribute('db.response.returned_rows', Array.isArray(res?.rows) ? res.rows.length : 0).end();
          return res;
        } catch (e) {
          record({ sql, durationMs: performance.now() - startedAt, rows: 0, error: true });
          const code = (e as { code?: string })?.code;
          span?.setStatus('error', code ? `SQLSTATE ${code}` : 'Error').end();   // the SQLSTATE, never the message (it can quote a value)
          throw e;
        }
      };
      client.__aipowersalonInstrumented = true;
    }
    return client;
  };
  // §40: pool state on demand. Gauges are read at scrape/health time; nothing polls.
  registry.onCollect(() => {
    const total = Number(pool.totalCount ?? 0), idle = Number(pool.idleCount ?? 0), waiting = Number(pool.waitingCount ?? 0);
    dbPoolTotal.set(total, { state: 'total' }); dbPoolTotal.set(idle, { state: 'idle' });
    dbPoolTotal.set(total - idle, { state: 'active' }); dbPoolTotal.set(waiting, { state: 'waiting' });
    dbPoolUtilisation.set(poolMax > 0 ? (total - idle) / poolMax : 0);
  });
  return pool;
}
