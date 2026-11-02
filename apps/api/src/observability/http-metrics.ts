// http-metrics.ts — Constitution 11 §36–37, §191, §246, §284–289, §311: API instrumentation without a row per
// request.
//
// One interceptor does three things, none of which can slow or fail a request:
//   1. records into the in-process registry (counter by method/route/status class; latency histogram; in-flight
//      gauge) — the source for the API dashboard and Prometheus exposition;
//   2. accumulates a per-minute aggregate per (method, route template, status class) in memory and flushes it to
//      platform_request_metrics_minute with one upsert per key every FLUSH_MS (migration 443). This REPLACES the
//      one-row-per-request write of the old HealthMetricsInterceptor (§246/§395);
//   3. writes ONE structured access-log line per request (§191): method, route template, status, duration, and the
//      ambient ids — never the body;
//   4. (Phase 11, Constitution 4 §35 noisy neighbour) accumulates per TENANT per minute: requests, request time and DB
//      statement time (the request context's dbMs), flushed additively to tenant_load_minute (migration 552) in ONE
//      statement per flush. Bounded by MAX_TENANTS_PER_MINUTE; tenants past it are counted, not stored.
//
// Cardinality is bounded twice: the registry caps label values, and the flush buffer caps distinct routes per
// minute (MAX_KEYS) — past that, a route is folded into "other". A raw-URL leak degrades gracefully.
//
// Failure policy (§284–289): the buffer is bounded; a failed flush drops that minute's aggregates and logs one
// warning. It never retries into a queue, never grows without limit, never throws into the request path.
import { dbQueriesPerRequest, registry, BUCKETS, log, enrichContext, getContext, runJob } from '@aipowersalon/observability';
import { routeTemplateOf } from '@aipowersalon/observability/nest';
import { recordSli } from './sli';
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { performance } from 'node:perf_hooks';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';

// MS_BUCKETS lives in @aipowersalon/observability: the writer (this file) and the reader (the Super Admin latency
// report) must agree on the bucket boundaries, and the reader is a module now (Constitution 13).
import { MS_BUCKETS } from '@aipowersalon/observability';
export { MS_BUCKETS };
const LE_COLS = ['le_5', 'le_10', 'le_25', 'le_50', 'le_100', 'le_250', 'le_500', 'le_1000', 'le_2500', 'le_5000', 'le_10000', 'le_inf'] as const;
export const FLUSH_MS = 15_000;
export const MAX_KEYS = 4_000;
export const MAX_TENANTS_PER_MINUTE = 5_000;

export const httpRequests = registry.counter('aipowersalon_api_requests_total', 'HTTP requests', ['method', 'route', 'status_class']);
export const httpDuration = registry.histogram('aipowersalon_api_request_duration_seconds', 'HTTP request latency', ['method', 'route'], BUCKETS.api);
export const httpInFlight = registry.gauge('aipowersalon_api_requests_in_flight', 'HTTP requests currently being handled');
export const http429 = registry.counter('aipowersalon_api_rate_limited_total', 'HTTP 429 responses', ['route']);
export const tenantLoadDropped = registry.counter('aipowersalon_tenant_load_dropped_total', 'Per-tenant load samples not stored (past MAX_TENANTS_PER_MINUTE)');

interface MinuteAgg { minute: Date; method: string; route: string; statusClass: number; count: number; count429: number; sumMs: number; maxMs: number; le: number[] }

export function statusClassOf(status: number): number { return status >= 200 && status < 600 ? Math.floor(status / 100) : 0; }
export function bucketIndex(ms: number): number { let i = 0; while (i < MS_BUCKETS.length && ms > MS_BUCKETS[i]) i++; return i; }
export const minuteOf = (t: number) => new Date(Math.floor(t / 60_000) * 60_000);

/** The in-memory aggregator, separable from Nest so it can be tested and reused by the job wrapper. */
export class MinuteAggregator {
  private buf = new Map<string, MinuteAgg>();
  constructor(readonly maxKeys = MAX_KEYS) {}
  record(method: string, route: string, status: number, ms: number, now = Date.now()): void {
    const minute = minuteOf(now); const statusClass = statusClassOf(status);
    let r = route;
    let k = `${minute.getTime()}|${method}|${r}|${statusClass}`;
    if (!this.buf.has(k) && this.buf.size >= this.maxKeys) { r = 'other'; k = `${minute.getTime()}|${method}|other|${statusClass}`; }
    let a = this.buf.get(k);
    if (!a) { a = { minute, method, route: r, statusClass, count: 0, count429: 0, sumMs: 0, maxMs: 0, le: new Array(12).fill(0) }; this.buf.set(k, a); }
    a.count++; if (status === 429) a.count429++; a.sumMs += ms; if (ms > a.maxMs) a.maxMs = ms; a.le[bucketIndex(ms)]++;
  }
  /** Hands over everything accumulated so far and starts fresh — the caller owns the flush. */
  drain(): MinuteAgg[] { const out = [...this.buf.values()]; this.buf.clear(); return out; }
  size(): number { return this.buf.size; }
}

export interface TenantMinute { minute: Date; tenantId: string; count: number; sumMs: number; dbMs: number; dbQueries: number }
/** Per-tenant per-minute load, in memory until the flush. Separate from MinuteAggregator so neither's cap starves the other. */
export class TenantMinuteAggregator {
  private buf = new Map<string, TenantMinute>();
  constructor(readonly maxTenants = MAX_TENANTS_PER_MINUTE) {}
  record(tenantId: string, ms: number, dbMs: number, dbQueries: number, now = Date.now()): void {
    const minute = minuteOf(now); const k = `${minute.getTime()}|${tenantId}`;
    let a = this.buf.get(k);
    if (!a) {
      if (this.buf.size >= this.maxTenants) { tenantLoadDropped.inc(); return; }
      a = { minute, tenantId, count: 0, sumMs: 0, dbMs: 0, dbQueries: 0 }; this.buf.set(k, a);
    }
    a.count++; a.sumMs += ms; a.dbMs += dbMs; a.dbQueries += dbQueries;
  }
  drain(): TenantMinute[] { const out = [...this.buf.values()]; this.buf.clear(); return out; }
  size(): number { return this.buf.size; }
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor, OnModuleInit, OnModuleDestroy {
  readonly agg = new MinuteAggregator();
  readonly tenants = new TenantMinuteAggregator();
  private timer: NodeJS.Timeout | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (!this.db) return;   // dev/tests: registry metrics still work, nothing is persisted
    // Instrumented like every other scheduler (the coverage guard admits no exemptions), so a flusher that
    // stops ticking is visible in the job registry like any other job. No loop: runJob touches in-memory
    // counters and the log sink, never this flush (§349).
    this.timer = setInterval(() => { void runJob({ jobType: 'metrics.flush', jobClass: 'standard' }, () => this.flush()).catch(() => undefined); }, FLUSH_MS);
    this.timer.unref?.();
  }
  async onModuleDestroy(): Promise<void> { if (this.timer) clearInterval(this.timer); await this.flush(); }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req: any = ctx.switchToHttp().getRequest();
    const res: any = ctx.switchToHttp().getResponse();
    const start = performance.now();   // §311: monotonic
    const route = routeTemplateOf(req);
    const method = String(req.method || 'GET');
    enrichContext({ operation: `api.${method} ${route}` });
    httpInFlight.inc();
    const done = (status: number, err?: unknown) => {
      httpInFlight.dec();
      const ms = performance.now() - start;
      const sc = statusClassOf(status);
      try {
        httpRequests.inc({ method, route, status_class: String(sc) });
        httpDuration.observe(ms / 1000, { method, route });
        // §43 N+1: how many queries this one request issued. Recorded WITHOUT a route label on purpose — the
        // histogram is the detector; the offending route is in the same access-log line (dbQueries field).
        const c = getContext();
        const q = c?.dbQueries ?? 0;
        if (q > 0) dbQueriesPerRequest.observe(q);
        if (status === 429) http429.inc({ route });
        recordSli(method, route, status, err);   // §71: business workflow outcome, classified from status + domain code
        this.agg.record(method, route, status, ms);
        if (c?.tenantId && UUID_RE.test(c.tenantId)) this.tenants.record(c.tenantId, ms, c.dbMs ?? 0, q);
        log.info('request.completed', { method, route, status, durationMs: Math.round(ms), dbQueries: q,
          // BUILD_PLAN Phase 13 (Constitution 6 §12, §149): the calling app's labels (names only — never the device id)
          ...(c?.clientApp ? { clientApp: c.clientApp, clientVersion: c.clientVersion, clientPlatform: c.clientPlatform } : {}) });
      } catch { /* never into the request path */ }
    };
    return next.handle().pipe(tap({
      next: () => done(Number(res?.statusCode) || 200),
      error: (e: any) => done(Number(e?.status ?? e?.getStatus?.()) || 500, e),
    }));
  }

  /** One upsert per (minute, method, route, class). Additive on conflict, so two instances of the API can share a table. */
  async flush(): Promise<void> {
    if (!this.db) return;
    await this.flushTenants();
    const rows = this.agg.drain();
    if (!rows.length) return;
    try {
      for (const r of rows) {
        const cols = LE_COLS.map((c, i) => sql`${sql.ref(c)} = ${sql.ref('platform_request_metrics_minute.' + c)} + ${r.le[i]}`);
        await sql`
          INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count, count_429, sum_ms, max_ms,
            le_5, le_10, le_25, le_50, le_100, le_250, le_500, le_1000, le_2500, le_5000, le_10000, le_inf)
          VALUES (${r.minute}, ${r.method}, ${r.route}, ${r.statusClass}, ${r.count}, ${r.count429}, ${Math.round(r.sumMs)}, ${Math.round(r.maxMs)},
            ${r.le[0]}, ${r.le[1]}, ${r.le[2]}, ${r.le[3]}, ${r.le[4]}, ${r.le[5]}, ${r.le[6]}, ${r.le[7]}, ${r.le[8]}, ${r.le[9]}, ${r.le[10]}, ${r.le[11]})
          ON CONFLICT (bucket_minute, method, route, status_class) DO UPDATE SET
            count = platform_request_metrics_minute.count + EXCLUDED.count,
            count_429 = platform_request_metrics_minute.count_429 + EXCLUDED.count_429,
            sum_ms = platform_request_metrics_minute.sum_ms + EXCLUDED.sum_ms,
            max_ms = GREATEST(platform_request_metrics_minute.max_ms, EXCLUDED.max_ms),
            ${sql.join(cols, sql`, `)}`.execute(this.db);
      }
    } catch (e) {
      // §285: drop this batch, say so once, keep serving. Never accumulate.
      log.warn('metrics.flush_failed', { dropped: rows.length, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** One statement for every tenant this flush; additive on conflict (several API processes share the table). A row for a
   *  tenant that no longer exists is skipped by the join, never failing the batch. */
  async flushTenants(): Promise<void> {
    const rows = this.tenants.drain();
    if (!rows.length || !this.db) return;
    try {
      await sql`
        INSERT INTO tenant_load_minute (bucket_minute, tenant_id, request_count, sum_ms, db_ms, db_queries)
        SELECT u.m, u.t, u.n, u.s, u.d, u.q
          FROM unnest(${rows.map((r) => r.minute.toISOString())}::timestamptz[], ${rows.map((r) => r.tenantId)}::uuid[], ${rows.map((r) => r.count)}::int[],
                      ${rows.map((r) => Math.round(r.sumMs))}::bigint[], ${rows.map((r) => Math.round(r.dbMs))}::bigint[], ${rows.map((r) => r.dbQueries)}::int[]) AS u(m, t, n, s, d, q)
          JOIN tenants t ON t.id = u.t
        ON CONFLICT (bucket_minute, tenant_id) DO UPDATE SET
          request_count = tenant_load_minute.request_count + EXCLUDED.request_count,
          sum_ms = tenant_load_minute.sum_ms + EXCLUDED.sum_ms,
          db_ms = tenant_load_minute.db_ms + EXCLUDED.db_ms,
          db_queries = tenant_load_minute.db_queries + EXCLUDED.db_queries`.execute(this.db);
    } catch (e) {
      log.warn('metrics.tenant_flush_failed', { dropped: rows.length, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
