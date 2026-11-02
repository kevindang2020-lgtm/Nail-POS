// telemetry-store.ts — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292, D7): the API half of the platform's own log +
// trace store (migration 561). Four pieces:
//
//   1. TelemetryStoreLifecycle — installs the package's sink (@aipowersalon/observability telemetry-store.ts) with a writer
//      bound to the WORKER pool (DATABASE_WORKER: its own connections, so a telemetry burst can never take a connection an
//      HTTP request needs; the primary handle only when no worker pool exists). TELEMETRY_STORE=off disables it; never
//      under NODE_ENV=test. The sink is bounded, batched and fail-open — see that file for the promise.
//   2. TelemetryStoreRetention — hourly (runTick, single owner across the fleet) batched deletes of rows older than
//      TELEMETRY_STORE_RETENTION_DAYS (default 14; retention-policy.json). Hourly, not daily: the store's worst-case
//      ingestion (the sink's per-process row cap) is cleared in a few dozen batches an hour instead of millions once a day.
//   3. TelemetrySearchService — request / correlation / trace / log search. Values reach SQL only as bound parameters.
//   4. TelemetrySearchController — GET /super-admin/observability/{requests, requests/:requestId, correlations/:id,
//      traces/:traceId, logs}. super_admin.telemetry.view reads; §181: without super_admin.telemetry.sensitive.view every
//      row is projected to the aggregate-safe view (tenant ids removed, id segments of routes collapsed to `:id`, error
//      messages and non-whitelisted fields removed) and filtering by tenant is refused.
import { BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable, Logger, OnApplicationShutdown, OnModuleDestroy, OnModuleInit, Optional, Param, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { DATABASE, DATABASE_READ, DATABASE_WORKER, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { runsBackgroundJob } from '@aipowersalon/config';
import { installTelemetrySink, installedTelemetrySink, log, runTick, telemetryStoreConfigFromEnv, type TelemetryBatch } from '@aipowersalon/observability';
import {
  TELEMETRY_SENSITIVE_PERMISSION, type TelemetryCorrelationView, type TelemetryLevel, type TelemetryLogLine, type TelemetryLogList,
  type TelemetryRequestDetail, type TelemetryRequestList, type TelemetryRequestSummary, type TelemetrySpanNode, type TelemetryTraceView,
} from '@aipowersalon/api-contracts';
import { TelemetrySearchControllerListQueries } from './telemetry-store.list-queries';

// ── 1. the writer + lifecycle ────────────────────────────────────────────────────────────────────────────────────────
const jsonb = (v: unknown): RawBuilder<unknown> => sql`${JSON.stringify(v ?? {})}::jsonb`;

/** One multi-row INSERT per table. The rows are already redacted and shaped to the table's CHECKs by the sink. */
export async function writeTelemetryBatch(db: any, b: TelemetryBatch): Promise<void> {
  // Field by field (check:mass-assignment): only the table's columns, never whatever else an object might carry.
  if (b.logs.length) await db.insertInto('telemetry_log_events').values(b.logs.map((l) => ({
    ts: l.ts, level: l.level, service: l.service, process_role: l.process_role, request_id: l.request_id, correlation_id: l.correlation_id,
    trace_id: l.trace_id, span_id: l.span_id, tenant_id: l.tenant_id, route: l.route, status: l.status, duration_ms: l.duration_ms,
    msg: l.msg, fields: jsonb(l.fields),
  }))).execute();
  if (b.spans.length) await db.insertInto('telemetry_spans').values(b.spans.map((s) => ({
    trace_id: s.trace_id, span_id: s.span_id, parent_span_id: s.parent_span_id, name: s.name, kind: s.kind, service: s.service,
    start_ts: s.start_ts, duration_ms: s.duration_ms, status: s.status, status_message: s.status_message, attributes: jsonb(s.attributes), tenant_id: s.tenant_id,
  }))).execute();
}

@Injectable()
export class TelemetryStoreLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Optional() @Inject(DATABASE_WORKER) private readonly worker?: any, @Optional() @Inject(DATABASE) private readonly primary?: any) {}
  onModuleInit(): void {
    const cfg = telemetryStoreConfigFromEnv();
    const db = this.worker ?? this.primary;
    if (!cfg.enabled || !db || process.env.NODE_ENV === 'test') return;
    installTelemetrySink({ writer: (b) => writeTelemetryBatch(db, b), logSample: cfg.logSample, traceSample: cfg.traceSample, maxRowsPerMin: cfg.maxRowsPerMin });
    new Logger('TelemetryStore').log(`[telemetry-store] on — WARN+ always, INFO at ${cfg.logSample}, traces at ${cfg.traceSample}, ≤ ${cfg.maxRowsPerMin} rows/min, kept ${cfg.retentionDays} days (worker pool: ${this.worker ? 'yes' : 'no — primary'})`);
  }
  async onApplicationShutdown(): Promise<void> {
    const s = installedTelemetrySink();
    if (s) { try { await s.shutdown(); } catch { /* §286 */ } }
  }
}

// ── 2. retention ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const STORE_TABLES = [
  { table: 'telemetry_log_events', column: 'ts' },
  { table: 'telemetry_spans', column: 'start_ts' },
] as const;
const HOUR_MS = 60 * 60_000;

@Injectable()
export class TelemetryStoreRetention implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private batch = 5_000; private maxBatches = 400; private retentionDays = telemetryStoreConfigFromEnv().retentionDays;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  /** Tests / scripts tune the batch size and window (production takes the defaults + TELEMETRY_STORE_RETENTION_DAYS). */
  configure(opts: { batch?: number; maxBatches?: number; retentionDays?: number }): this {
    this.batch = opts.batch ?? this.batch; this.maxBatches = opts.maxBatches ?? this.maxBatches; this.retentionDays = opts.retentionDays ?? this.retentionDays;
    return this;
  }
  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'telemetry.store_retention', jobClass: 'standard', everyMs: HOUR_MS }, () => this.run()).catch(() => undefined); }, HOUR_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Rows deleted per table. ctid batches: never one enormous transaction. One table failing does not stop the other. */
  async run(now: Date = new Date()): Promise<Record<string, number>> {
    const cutoff = new Date(now.getTime() - this.retentionDays * 86_400_000);
    const out: Record<string, number> = {};
    for (const t of STORE_TABLES) {
      let total = 0;
      try {
        for (let i = 0; i < this.maxBatches; i++) {
          const res = await sql`delete from ${sql.table(t.table)} where ctid in (
                                  select ctid from ${sql.table(t.table)} where ${sql.ref(t.column)} < ${cutoff} limit ${this.batch})`.execute(this.db);
          const n = Number((res as any).numAffectedRows ?? (res as any).numDeletedRows ?? 0);
          total += n;
          if (n < this.batch) break;
        }
      } catch (e) {
        log.error('telemetry_store.retention_failed', { table: t.table, error: (e as Error).message });
      }
      out[t.table] = total;
      if (total) log.info('telemetry_store.retention_deleted', { table: t.table, rows: total, keepDays: this.retentionDays });
    }
    return out;
  }
}

// ── 3. search ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TelemetryFilters {
  requestId?: string; correlationId?: string; traceId?: string; tenantId?: string; route?: string; status?: string;
  level?: string; q?: string; from?: string | number; to?: string | number; limit?: number;
}
export interface ViewOptions { sensitive: boolean; now?: Date }

const LEVEL_RANK: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const RANK_LEVEL: Record<number, TelemetryLevel> = { 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
export const MAX_RANGE_DAYS = 14;
const DAY = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const TRACE_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_RE = /^([1-5])(\d\d|xx)$/i;

/** §181 the aggregate-safe projection: the field keys a non-sensitive caller may see. Everything else is dropped. */
export const SAFE_FIELDS = new Set(['method', 'route', 'status', 'durationMs', 'dbQueries', 'fingerprint', 'operation', 'actorType', 'service', 'jobType', 'jobClass', 'component', 'clientApp', 'clientVersion', 'clientPlatform', 'attempt', 'reasonCode', 'code', 'eventType', 'provider', 'table', 'rows', 'keepDays']);
export const SAFE_ATTRIBUTES = new Set(['http.route', 'http.request.method', 'http.response.status_code', 'db.operation', 'db.sql.table', 'db.system', 'peer.service', 'messaging.operation', 'messaging.system', 'aipowersalon.request_id', 'aipowersalon.job_type', 'aipowersalon.job_class', 'aipowersalon.actor_type', 'aipowersalon.provider', 'aipowersalon.operation', 'aipowersalon.outcome']);
const EVENT_NAME = /^[a-z][a-z0-9_.:-]{0,79}$/i;
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,}|[A-Za-z]{2,5}_[A-Za-z0-9]{8,})$/i;
/** `/appointments/3f2a…` → `/appointments/:id` (a template already is one; ids never pass). */
export function collapseIds(path: string | null): string | null {
  if (path == null) return null;
  return path.split(/([/ ?])/).map((seg) => (ID_SEGMENT.test(seg) ? ':id' : seg)).join('');
}

// The columns the views read (check:response-exposure — no whole-row reads; id only orders).
const LOG_COLS = sql.raw('ts, level, service, process_role, request_id, correlation_id, trace_id, span_id, tenant_id, route, status, duration_ms, msg, fields');
const SPAN_COLS = sql.raw('trace_id, span_id, parent_span_id, name, kind, service, start_ts, duration_ms, status, status_message, attributes, tenant_id');
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const num = (v: any): number | null => (v == null ? null : Number(v));
const parseJson = (v: any): Record<string, unknown> => (v && typeof v === 'object' ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : {});
const kindOf = (id: string): TelemetryRequestSummary['kind'] => (id.startsWith('req_') ? 'request' : id.startsWith('job_') ? 'job' : id.startsWith('evt_') ? 'event' : 'other');

function lineOf(r: any, sensitive: boolean): TelemetryLogLine {
  const fields = parseJson(r.fields);
  const line: TelemetryLogLine = {
    ts: iso(r.ts), level: r.level, service: r.service, processRole: r.process_role,
    requestId: r.request_id ?? null, correlationId: r.correlation_id ?? null, traceId: r.trace_id ?? null, spanId: r.span_id ?? null,
    tenantId: r.tenant_id ?? null, route: r.route ?? null, status: num(r.status), durationMs: num(r.duration_ms), msg: r.msg, fields,
  };
  if (sensitive) return line;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (SAFE_FIELDS.has(k)) safe[k] = k === 'route' && typeof v === 'string' ? collapseIds(v) : v;
  return { ...line, tenantId: null, route: collapseIds(line.route), msg: EVENT_NAME.test(line.msg) ? line.msg : '[message hidden]', fields: safe };
}

function summarize(id: string, lines: TelemetryLogLine[], sensitive: boolean): TelemetryRequestSummary {
  const sorted = [...lines].sort((a, b) => a.ts.localeCompare(b.ts));
  const lastWith = <K extends keyof TelemetryLogLine>(k: K) => { for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i][k] != null) return sorted[i][k]; return null; };
  const maxRank = Math.max(30, ...sorted.map((l) => LEVEL_RANK[l.level] ?? 30));
  const dur = sorted.map((l) => l.durationMs).filter((d): d is number => d != null);
  return {
    requestId: id, kind: kindOf(id), startedAt: sorted[0]?.ts ?? '', lastAt: sorted[sorted.length - 1]?.ts ?? '',
    correlationId: lastWith('correlationId') as string | null, traceId: lastWith('traceId') as string | null,
    tenantId: sensitive ? (lastWith('tenantId') as string | null) : null, route: lastWith('route') as string | null,
    status: lastWith('status') as number | null, durationMs: dur.length ? Math.max(...dur) : null, lines: sorted.length,
    maxLevel: RANK_LEVEL[maxRank] ?? 'info', service: sorted[0]?.service ?? null,
  };
}

function bad(message: string): never { throw new BadRequestException({ code: 'INVALID_FILTER', message }); }
const instant = (v: string | number | undefined, name: string): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : /^\d{12,14}$/.test(String(v)) ? Number(v) : Date.parse(String(v));
  if (!Number.isFinite(n)) bad(`${name} is not a date or instant`);
  return n;
};
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class TelemetrySearchService {
  constructor(@Optional() @Inject(DATABASE_READ) private readonly db: any) {}
  private need(): any { if (!this.db) throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'The telemetry store needs Postgres (REPO_DRIVER=postgres).' }); return this.db; }

  /** The row filters every list shares. Throws 400 on a malformed value — nothing a client sends is interpolated. */
  private conditions(f: TelemetryFilters, now: Date): { conds: RawBuilder<unknown>[]; from: number; to: number } {
    const toMs = instant(f.to, 'to') ?? now.getTime();
    const fromMs = instant(f.from, 'from') ?? toMs - DAY;
    if (fromMs > toMs) bad('from is after to');
    if (toMs - fromMs > MAX_RANGE_DAYS * DAY) throw new BadRequestException({ code: 'DATE_RANGE_TOO_LARGE', message: `at most ${MAX_RANGE_DAYS} days (the store's retention)`, maxDays: MAX_RANGE_DAYS });
    const conds: RawBuilder<unknown>[] = [sql`ts >= ${new Date(fromMs)}`, sql`ts <= ${new Date(toMs)}`];
    const id = (v: string | undefined, name: string, re: RegExp = SAFE_ID) => { if (v === undefined || v === '') return undefined; if (!re.test(v)) bad(`${name} is not a valid id`); return v; };
    const rid = id(f.requestId, 'requestId'); if (rid) conds.push(sql`request_id = ${rid}`);
    const cid = id(f.correlationId, 'correlationId'); if (cid) conds.push(sql`correlation_id = ${cid}`);
    const tid = id(f.traceId, 'traceId', TRACE_RE); if (tid) conds.push(sql`trace_id = ${tid}`);
    const ten = id(f.tenantId, 'tenantId', UUID_RE); if (ten) conds.push(sql`tenant_id = ${ten}::uuid`);
    if (f.route) { if (f.route.length > 300) bad('route is too long'); conds.push(sql`route like ${likeEscape(f.route) + '%'}`); }
    if (f.status) {
      const m = STATUS_RE.exec(f.status); if (!m) bad('status is a code (500) or a class (5xx)');
      if (m[2].toLowerCase() === 'xx') conds.push(sql`status between ${Number(m[1]) * 100} and ${Number(m[1]) * 100 + 99}`);
      else conds.push(sql`status = ${Number(f.status)}`);
    }
    if (f.level) {
      const r = LEVEL_RANK[f.level]; if (!r || r < 30) bad('level is info, warn, error or fatal');
      conds.push(sql`level in (${sql.join(Object.keys(LEVEL_RANK).filter((k) => LEVEL_RANK[k] >= r))})`);
    }
    if (f.q) { if (f.q.length > 200) bad('q is too long'); conds.push(sql`msg ilike ${'%' + likeEscape(f.q) + '%'}`); }
    return { conds, from: fromMs, to: toMs };
  }
  private limit(f: TelemetryFilters, dflt: number, max: number): number { const n = Number(f.limit); return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : dflt; }

  async requests(f: TelemetryFilters, o: ViewOptions): Promise<TelemetryRequestList> {
    const db = this.need();
    const { conds, from, to } = this.conditions(f, o.now ?? new Date());
    const lim = this.limit(f, 50, 200);
    const ids: string[] = (await sql<{ request_id: string }>`
      select request_id from telemetry_log_events where request_id is not null and ${sql.join(conds, sql` and `)}
      group by request_id order by max(ts) desc limit ${lim}`.execute(db)).rows.map((r) => r.request_id);
    const lines = ids.length ? await this.linesFor(sql`request_id in (${sql.join(ids)})`, 5_000) : [];
    const by = new Map<string, TelemetryLogLine[]>();
    for (const r of lines) { const l = lineOf(r, true); (by.get(l.requestId!) ?? by.set(l.requestId!, []).get(l.requestId!)!).push(l); }
    const items = ids.filter((id) => by.has(id)).map((id) => {
      const s = summarize(id, by.get(id)!, o.sensitive);
      return o.sensitive ? s : { ...s, route: collapseIds(s.route) };
    });
    return { redacted: !o.sensitive, from: new Date(from).toISOString(), to: new Date(to).toISOString(), items };
  }

  async request(requestId: string, o: ViewOptions): Promise<TelemetryRequestDetail> {
    if (!SAFE_ID.test(requestId)) bad('requestId is not a valid id');
    const rows = await this.linesFor(sql`request_id = ${requestId}`, 1_000);
    const full = rows.map((r) => lineOf(r, true));
    const logs = rows.map((r) => lineOf(r, o.sensitive));
    const summary = full.length ? summarize(requestId, full, o.sensitive) : null;
    return { redacted: !o.sensitive, summary: summary && !o.sensitive ? { ...summary, route: collapseIds(summary.route) } : summary, traceIds: [...new Set(full.map((l) => l.traceId).filter((t): t is string => !!t))], logs };
  }

  async logs(f: TelemetryFilters, o: ViewOptions): Promise<TelemetryLogList> {
    const db = this.need();
    const { conds, from, to } = this.conditions(f, o.now ?? new Date());
    const lim = this.limit(f, 100, 500);
    const rows = (await sql`select ${LOG_COLS} from telemetry_log_events where ${sql.join(conds, sql` and `)} order by ts desc, id desc limit ${lim}`.execute(db)).rows;
    return { redacted: !o.sensitive, from: new Date(from).toISOString(), to: new Date(to).toISOString(), items: rows.map((r) => lineOf(r, o.sensitive)) };
  }

  async trace(traceId: string, o: ViewOptions): Promise<TelemetryTraceView> {
    if (!TRACE_RE.test(traceId)) bad('traceId is 32 lowercase hex characters');
    const db = this.need();
    const spanRows = (await sql`select ${SPAN_COLS} from telemetry_spans where trace_id = ${traceId} order by start_ts, id limit 2000`.execute(db)).rows as any[];
    const logRows = await this.linesFor(sql`trace_id = ${traceId}`, 2_000);
    const t0 = spanRows.length ? Math.min(...spanRows.map((s) => new Date(s.start_ts).getTime())) : null;
    const nodes = new Map<string, TelemetrySpanNode & { children: string[] }>();
    for (const s of spanRows) {
      const attrs = parseJson(s.attributes);
      const safeAttrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(attrs)) if (o.sensitive || SAFE_ATTRIBUTES.has(k)) safeAttrs[k] = !o.sensitive && k === 'http.route' && typeof v === 'string' ? collapseIds(v) : v;
      const start = new Date(s.start_ts).getTime();
      nodes.set(s.span_id, {
        spanId: s.span_id, parentSpanId: s.parent_span_id ?? null, name: o.sensitive ? s.name : collapseIds(s.name)!, kind: s.kind, service: s.service,
        startTs: iso(s.start_ts), offsetMs: Math.round((start - (t0 ?? start)) * 1000) / 1000, durationMs: Number(s.duration_ms), depth: 0,
        status: s.status, statusMessage: o.sensitive ? s.status_message ?? null : null, attributes: safeAttrs,
        tenantId: o.sensitive ? s.tenant_id ?? null : null, logs: [], children: [],
      });
    }
    const roots: string[] = [];
    for (const n of nodes.values()) { const p = n.parentSpanId && nodes.get(n.parentSpanId); if (p && p !== n) p.children.push(n.spanId); else roots.push(n.spanId); }
    const byStart = (a: string, b: string) => nodes.get(a)!.startTs.localeCompare(nodes.get(b)!.startTs);
    const ordered: TelemetrySpanNode[] = [];
    const seen = new Set<string>();
    const walk = (id: string, depth: number) => {
      if (seen.has(id)) return; seen.add(id);
      const n = nodes.get(id)!; n.depth = depth;
      const { children, ...node } = n; ordered.push(node);
      for (const c of [...children].sort(byStart)) walk(c, depth + 1);
    };
    for (const r of roots.sort(byStart)) walk(r, 0);
    for (const id of nodes.keys()) walk(id, 0);   // a parent cycle (corrupt ids) still shows every span
    const unattached: TelemetryLogLine[] = [];
    const nodeById = new Map(ordered.map((n) => [n.spanId, n]));
    for (const r of logRows) { const l = lineOf(r, o.sensitive); const n = l.spanId ? nodeById.get(l.spanId) : undefined; (n ? n.logs : unattached).push(l); }
    const ends = spanRows.map((s) => new Date(s.start_ts).getTime() + Number(s.duration_ms));
    return { redacted: !o.sensitive, traceId, startedAt: t0 == null ? null : new Date(t0).toISOString(), durationMs: t0 == null ? 0 : Math.round(Math.max(...ends) - t0), spans: ordered, unattachedLogs: unattached };
  }

  async correlation(correlationId: string, o: ViewOptions): Promise<TelemetryCorrelationView> {
    if (!SAFE_ID.test(correlationId)) bad('correlationId is not a valid id');
    const db = this.need();
    const rows = await this.linesFor(sql`correlation_id = ${correlationId}`, 2_000);
    const full = rows.map((r) => lineOf(r, true));
    const by = new Map<string, TelemetryLogLine[]>();
    for (const l of full) if (l.requestId) (by.get(l.requestId) ?? by.set(l.requestId, []).get(l.requestId)!).push(l);
    const summaries = [...by.entries()].map(([id, ls]) => { const s = summarize(id, ls, o.sensitive); return o.sensitive ? s : { ...s, route: collapseIds(s.route) }; })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const traceIds = [...new Set(full.map((l) => l.traceId).filter((t): t is string => !!t))];
    const calls = traceIds.length ? (await sql`select trace_id, span_id, name, start_ts, duration_ms, status from telemetry_spans
        where trace_id in (${sql.join(traceIds)}) and kind in ('client', 'producer') and name not like 'db %' order by start_ts limit 500`.execute(db)).rows as any[] : [];
    return {
      redacted: !o.sensitive, correlationId,
      requests: summaries.filter((s) => s.kind === 'request' || s.kind === 'other'), jobs: summaries.filter((s) => s.kind === 'job'), events: summaries.filter((s) => s.kind === 'event'),
      traceIds,
      providerCalls: calls.map((c) => ({ traceId: c.trace_id, spanId: c.span_id, name: o.sensitive ? c.name : collapseIds(c.name)!, startTs: iso(c.start_ts), durationMs: Number(c.duration_ms), status: c.status })),
      logs: rows.map((r) => lineOf(r, o.sensitive)),
    };
  }

  private async linesFor(where: RawBuilder<unknown>, limit: number): Promise<any[]> {
    const db = this.need();
    return (await sql`select ${LOG_COLS} from telemetry_log_events where ${where} order by ts, id limit ${limit}`.execute(db)).rows;
  }
}

// ── 4. the controller ────────────────────────────────────────────────────────────────────────────────────────────────
const sensitiveOf = (req: any): boolean => { try { return hasPermission(req?.ctx, TELEMETRY_SENSITIVE_PERMISSION); } catch { return false; } };
function filtersOf(q: Record<string, any>, req: any): TelemetryFilters {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const range = req?.listQuery?.range;
  return {
    requestId: s(q.requestId), correlationId: s(q.correlationId), traceId: s(q.traceId), tenantId: s(q.tenantId), route: s(q.route),
    status: s(q.status), level: s(q.level), q: s(q.q), limit: q.limit !== undefined ? Number(q.limit) : undefined,
    from: range && !range.defaulted ? range.fromMs : s(q.from), to: range && !range.defaulted ? range.toMs : s(q.to),
  };
}
function refuseTenantFilter(f: TelemetryFilters, sensitive: boolean): void {
  if (f.tenantId && !sensitive) throw new ForbiddenException({ code: 'PERMISSION_DENIED', reason: 'missing_permission', permission: TELEMETRY_SENSITIVE_PERMISSION, message: `Filtering telemetry by tenant needs ${TELEMETRY_SENSITIVE_PERMISSION}` });
}

@UseGuards(SuperAdminGuard)
@ListQueries(TelemetrySearchControllerListQueries)
@Controller('super-admin/observability')
export class TelemetrySearchController {
  constructor(private readonly svc: TelemetrySearchService) {}
  @Get('requests') @RequirePermission('super_admin.telemetry.view')
  requests(@Query() q: Record<string, any>, @Req() req: any): Promise<TelemetryRequestList> { const sensitive = sensitiveOf(req); const f = filtersOf(q, req); refuseTenantFilter(f, sensitive); return this.svc.requests(f, { sensitive }); }
  @Get('requests/:requestId') @RequirePermission('super_admin.telemetry.view')
  request(@Param('requestId') id: string, @Req() req: any): Promise<TelemetryRequestDetail> { return this.svc.request(String(id), { sensitive: sensitiveOf(req) }); }
  @Get('correlations/:correlationId') @RequirePermission('super_admin.telemetry.view')
  correlation(@Param('correlationId') id: string, @Req() req: any): Promise<TelemetryCorrelationView> { return this.svc.correlation(String(id), { sensitive: sensitiveOf(req) }); }
  @Get('traces/:traceId') @RequirePermission('super_admin.telemetry.view')
  trace(@Param('traceId') id: string, @Req() req: any): Promise<TelemetryTraceView> { return this.svc.trace(String(id), { sensitive: sensitiveOf(req) }); }
  @Get('logs') @RequirePermission('super_admin.telemetry.view')
  logs(@Query() q: Record<string, any>, @Req() req: any): Promise<TelemetryLogList> { const sensitive = sensitiveOf(req); const f = filtersOf(q, req); refuseTenantFilter(f, sensitive); return this.svc.logs(f, { sensitive }); }
}
