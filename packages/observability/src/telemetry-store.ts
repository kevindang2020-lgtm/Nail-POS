// telemetry-store.ts — BUILD_PLAN Phase 14 A (Constitution 11 §286, §291–292, D7): the sink that feeds the platform's own
// short-retention log + trace store (tables telemetry_log_events / telemetry_spans, migration 561).
//
// THE PROMISE (§286 "telemetry must never take the product down"):
//   • offering a line or a span is synchronous queue work — never I/O, never awaited by the caller;
//   • the queue is BOUNDED per kind (oldest dropped first, counted: reason="queue_full"), and ingestion is capped per
//     minute (reason="rate_limited"), so neither memory nor the table grows with a burst;
//   • writes are BATCHED (one writer call per flush, at most maxBatch rows per kind), run OUTSIDE any request context
//     (the sink's own queries are never counted as, or become spans of, the request that scheduled the flush), time out
//     (writeTimeoutMs), and FAIL OPEN: a dead or hanging database drops the batch (reason="write_failed"), backs off
//     (reason="backoff" while it does) and never throws into a request, a job or shutdown;
//   • NOTHING UNREDACTED LANDS: every row passes redaction.ts (by key + secret-shaped values) AND the store's free-text
//     scrub (emails, phone numbers, card numbers, provider key shapes, `secret=…` pairs) before the writer sees it; request
//     bodies, headers and query strings are dropped by key; message and fields are size-bounded.
//
// WHAT IS KEPT. Every line at WARN and above; INFO at TELEMETRY_LOG_SAMPLE (default 0.1), decided per REQUEST id (all of
// a request's lines or none); every INFO line of a request that errored (the lines before the error wait in a small,
// bounded pending buffer and are promoted when the error arrives) or whose trace is stored. Spans: the traces chosen by
// keepFraction(traceId, TELEMETRY_TRACE_SAMPLE) (default 0.1 — deterministic, so every process keeps the same traces),
// plus every span that ended in error.
//
// The package does not know the database: the API hands installTelemetrySink() a writer bound to its WORKER pool
// (apps/api/src/observability/telemetry-store.ts).
import { registry } from './metrics';
import { REDACTED, maskEmail, maskPhone, maskValueSecrets, redact } from './redaction';
import { setLogTap, type LogLevel, type LogRecord } from './logger';
import { getContext, runOutsideContext, type TelemetryContext } from './request-context';
import { activeSpanContext, runOutsideSpan, setLocalSpanSink } from './tracing/span';
import type { SpanData } from './tracing/span-data';

export const storeWritten = registry.counter('aipowersalon_telemetry_store_written_total', 'Rows written to the telemetry store (log lines / spans)', ['kind']);
export const storeDropped = registry.counter('aipowersalon_telemetry_store_dropped_total', 'Rows that never reached the telemetry store (queue_full, rate_limited, write_failed, backoff, unconvertible)', ['kind', 'reason']);

// ── rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface LogRow {
  ts: string; level: LogLevel; service: string; process_role: string;
  request_id: string | null; correlation_id: string | null; trace_id: string | null; span_id: string | null; tenant_id: string | null;
  route: string | null; status: number | null; duration_ms: number | null; msg: string; fields: Record<string, unknown>;
}
export interface SpanRow {
  trace_id: string; span_id: string; parent_span_id: string | null; name: string; kind: SpanData['kind']; service: string;
  start_ts: string; duration_ms: number; status: SpanData['status']['code']; status_message: string | null;
  attributes: Record<string, unknown>; tenant_id: string | null;
}
export interface TelemetryBatch { logs: LogRow[]; spans: SpanRow[] }
export type TelemetryWriter = (batch: TelemetryBatch) => Promise<void>;

const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const KINDS = new Set(['internal', 'server', 'client', 'producer', 'consumer']);
const MAX_MSG = 500;
const MAX_STRING = 1_000;
const MAX_JSON = 4_096;

// ── the free-text scrub ─────────────────────────────────────────────────────────────────────────────────────────────
// redaction.ts masks by KEY and masks secret-SHAPED values (JWT, bearer, Luhn card numbers). A stored log line is
// searchable for 14 days by support, so the store is stricter about free text a developer interpolated into a message:
// emails, phone numbers, well-known provider key shapes and `secret=value` pairs are masked as well.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;   // bounded: no quadratic scan of a long string
// 10–15 digits with the usual separators, not glued to an identifier (`req_…0123456789`, a UUID segment) on either side.
const PHONE = /(?<![\w+.\-/])\+?(?:\d[ ().-]{0,2}){9,14}\d(?![\w\-/])/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const PROVIDER_KEYS = /\b(?:(?:sk|rk|pk|whsec)_(?:live|test)_[A-Za-z0-9]{8,}|SG\.[\w-]{16,}\.[\w-]{16,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,})/g;
const SECRET_PAIR = /\b((?:api[_-]?key|apikey|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pin|otp|code_verifier)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi;

const SCRUB_MAX = 4_000;
/** Bounded input first (a 50 KB string is cut before any regex sees it), then the masks. */
export function scrubFreeText(s: string): string {
  let out = maskValueSecrets(s.length > SCRUB_MAX ? s.slice(0, SCRUB_MAX) : s);
  out = out.replace(PROVIDER_KEYS, REDACTED);
  out = out.replace(SECRET_PAIR, (_m, k) => `${k}${REDACTED}`);
  out = out.replace(EMAIL, (m) => maskEmail(m));
  out = out.replace(PHONE, (m) => {
    if (ISO_DATE.test(m)) return m;
    const digits = m.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15 ? maskPhone(m) : m;
  });
  return out;
}

/** Keys the store never keeps, at any depth: a request's body, headers and query string (§291 "sanitized summary"). */
const DROP_KEYS = new Set(['body', 'rawbody', 'raw_body', 'payload', 'headers', 'query', 'querystring', 'request', 'response', 'cookies', 'req', 'res']);

function scrubDeep(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') { const s = scrubFreeText(v); return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s; }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'object') return String(v);
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrubDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (DROP_KEYS.has(k.toLowerCase())) continue;
    out[k] = scrubDeep(x, depth + 1);
  }
  return out;
}

/** Redact (by key and value), scrub free text, bound the size. Never throws. */
export function sanitizeForStore(v: Record<string, unknown>): Record<string, unknown> {
  try {
    const cleaned = scrubDeep(redact(v)) as Record<string, unknown>;
    const json = JSON.stringify(cleaned);
    if (json.length <= MAX_JSON) return cleaned;
    return { _truncated: true, keys: Object.keys(cleaned).slice(0, 40) };
  } catch {
    return { _unredactable: true };
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const idOr = (v: unknown, re: RegExp): string | null => (typeof v === 'string' && re.test(v) ? v : null);
const PROCESS_ROLE = () => (String(process.env.PROCESS_ROLE ?? 'all').trim().toLowerCase() || 'all').slice(0, 32);
const SERVICE = () => (String(process.env.OTEL_SERVICE_NAME ?? '').trim() || `aipowersalon-${PROCESS_ROLE()}`).slice(0, 64);

/** Fields lifted into columns or describing the process — not repeated in `fields`. */
const LIFTED = new Set(['timestamp', 'level', 'service', 'environment', 'msg', 'requestId', 'correlationId', 'traceId', 'spanId', 'tenantId', 'route', 'status', 'durationMs']);

export function toLogRow(rec: LogRecord, activeSpanId: string | undefined): LogRow {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (!LIFTED.has(k) && v !== undefined) extra[k] = v;
  const status = typeof rec.status === 'number' && Number.isInteger(rec.status) && rec.status >= 0 && rec.status <= 999 ? rec.status : null;
  const dur = typeof rec.durationMs === 'number' && Number.isFinite(rec.durationMs) && rec.durationMs >= 0 ? Math.round(rec.durationMs) : null;
  const ts = typeof rec.timestamp === 'string' && !Number.isNaN(Date.parse(rec.timestamp)) ? rec.timestamp : new Date().toISOString();
  const route = typeof rec.route === 'string' ? scrubFreeText(rec.route).slice(0, 300) : null;
  return {
    ts, level: (LEVELS[rec.level] ? rec.level : 'info') as LogLevel, service: String(rec.service || SERVICE()).slice(0, 64), process_role: PROCESS_ROLE(),
    request_id: str(rec.requestId, 128), correlation_id: str(rec.correlationId, 128),
    trace_id: idOr(rec.traceId, TRACE_ID), span_id: idOr(activeSpanId, SPAN_ID) ?? idOr(rec.spanId, SPAN_ID),
    tenant_id: idOr(rec.tenantId, UUID), route, status, duration_ms: dur,
    msg: scrubFreeText(String(rec.msg ?? '')).slice(0, MAX_MSG) || '(empty)',
    fields: sanitizeForStore(extra),
  };
}

export function toSpanRow(s: SpanData, service: string = SERVICE()): SpanRow | null {
  if (!TRACE_ID.test(s.traceId) || !SPAN_ID.test(s.spanId)) return null;
  const attrs = sanitizeForStore({ ...s.attributes });
  const tenant = idOr(s.attributes?.['aipowersalon.tenant_id'], UUID);
  return {
    trace_id: s.traceId, span_id: s.spanId, parent_span_id: idOr(s.parentSpanId, SPAN_ID),
    name: scrubFreeText(String(s.name ?? 'span')).slice(0, 300), kind: KINDS.has(s.kind) ? s.kind : 'internal', service: service.slice(0, 64),
    start_ts: new Date(Math.floor(s.startMs)).toISOString(), duration_ms: Math.max(0, Number(s.endMs) - Number(s.startMs)) || 0,
    status: s.status?.code === 'error' || s.status?.code === 'ok' ? s.status.code : 'unset',
    status_message: s.status?.message ? scrubFreeText(s.status.message).slice(0, 200) : null,
    attributes: attrs, tenant_id: tenant,
  };
}

// ── sampling ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** FNV-1a over the id → [0,1). Deterministic: the API and the worker keep the same traces and the same requests. */
export function keepFraction(id: string, fraction: number): boolean {
  if (!(fraction > 0)) return false;
  if (fraction >= 1) return true;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 0x1_0000_0000 < fraction;
}

// ── the sink ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TelemetrySinkOptions {
  writer: TelemetryWriter;
  logSample?: number; traceSample?: number;
  maxQueue?: number; maxBatch?: number; flushMs?: number; writeTimeoutMs?: number; backoffMs?: number; maxRowsPerMin?: number;
  service?: string; now?: () => number;
}

const PENDING_REQUESTS = 512;
const PENDING_PER_REQUEST = 25;
const ERRORED_REMEMBERED = 4_096;

export class TelemetrySink {
  // Queued RAW: conversion (redaction, scrub, size bounds) happens at flush time, off the request path.
  private logs: Array<{ rec: LogRecord; spanId?: string }> = [];
  private spans: SpanData[] = [];
  private readonly pending = new Map<string, Array<{ rec: LogRecord; spanId?: string }>>();
  private readonly errored = new Map<string, true>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private backoffUntil = 0;
  private windowStart = 0;
  private windowCount = 0;
  private closed = false;
  readonly logSample: number; readonly traceSample: number;
  private readonly maxQueue: number; private readonly maxBatch: number; private readonly flushMs: number;
  private readonly writeTimeoutMs: number; private readonly backoffMs: number; private readonly maxRowsPerMin: number;
  private readonly service: string; private readonly now: () => number;

  constructor(private readonly opts: TelemetrySinkOptions) {
    const frac = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
    this.logSample = frac(opts.logSample, 0.1);
    this.traceSample = frac(opts.traceSample, 0.1);
    this.maxQueue = Math.max(1, opts.maxQueue ?? 5_000);
    this.maxBatch = Math.max(1, opts.maxBatch ?? 500);
    this.flushMs = Math.max(5, opts.flushMs ?? 2_000);
    this.writeTimeoutMs = Math.max(5, opts.writeTimeoutMs ?? 5_000);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 30_000);
    this.maxRowsPerMin = Math.max(1, opts.maxRowsPerMin ?? 3_000);
    this.service = opts.service ?? SERVICE();
    this.now = opts.now ?? Date.now;
  }

  queued(): { logs: number; spans: number } { return { logs: this.logs.length, spans: this.spans.length }; }
  keepsTrace(traceId: string): boolean { return keepFraction(traceId, this.traceSample); }

  /** Called from the logger tap, synchronously. Decides, converts, enqueues. Never throws, never awaits. */
  offerLog(rec: LogRecord, ctx: TelemetryContext | undefined, activeSpanId?: string): void {
    try {
      if (this.closed) return;
      const lvl = LEVELS[rec.level] ?? 0;
      if (lvl < LEVELS.info) return;
      const reqId = typeof rec.requestId === 'string' ? rec.requestId : undefined;
      const erroredNow = lvl >= LEVELS.warn || (typeof rec.status === 'number' && rec.status >= 500);
      if (erroredNow) {
        if (reqId) {
          this.remember(reqId);
          const held = this.pending.get(reqId);
          if (held) { this.pending.delete(reqId); for (const h of held) this.enqueueLog(h.rec, h.spanId); }
        }
        this.enqueueLog(rec, activeSpanId);
        return;
      }
      const traceId = typeof rec.traceId === 'string' ? rec.traceId : undefined;
      const traceStored = !!(ctx?.traceSampled && traceId && this.keepsTrace(traceId));
      const keep = (reqId && this.errored.has(reqId)) || traceStored || (reqId ? keepFraction(reqId, this.logSample) : Math.random() < this.logSample);
      if (keep) { this.enqueueLog(rec, activeSpanId); return; }
      if (reqId) this.hold(reqId, rec, activeSpanId);
    } catch { /* §286 */ }
  }

  /** Called from the tracer's local destination when a recording span ends. */
  offerSpan(s: SpanData): void {
    try {
      if (this.closed) return;
      if (!(s.status?.code === 'error' || this.keepsTrace(s.traceId))) return;
      if (!this.admit('span')) return;
      if (this.spans.length >= this.maxQueue) { this.spans.shift(); storeDropped.inc({ kind: 'span', reason: 'queue_full' }); }
      this.spans.push(s);
      this.schedule(this.spans.length);
    } catch { /* §286 */ }
  }

  private remember(reqId: string): void {
    this.errored.delete(reqId); this.errored.set(reqId, true);
    if (this.errored.size > ERRORED_REMEMBERED) this.errored.delete(this.errored.keys().next().value as string);
  }
  private hold(reqId: string, rec: LogRecord, spanId?: string): void {
    let list = this.pending.get(reqId);
    if (!list) {
      list = [];
      this.pending.set(reqId, list);
      if (this.pending.size > PENDING_REQUESTS) this.pending.delete(this.pending.keys().next().value as string);
    }
    if (list.length < PENDING_PER_REQUEST) list.push({ rec, spanId });
  }
  private admit(kind: 'log' | 'span'): boolean {
    const t = this.now();
    if (t - this.windowStart >= 60_000) { this.windowStart = t; this.windowCount = 0; }
    if (this.windowCount >= this.maxRowsPerMin) { storeDropped.inc({ kind, reason: 'rate_limited' }); return false; }
    this.windowCount++;
    return true;
  }
  private enqueueLog(rec: LogRecord, spanId?: string): void {
    if (!this.admit('log')) return;
    if (this.logs.length >= this.maxQueue) { this.logs.shift(); storeDropped.inc({ kind: 'log', reason: 'queue_full' }); }
    this.logs.push({ rec, spanId });
    this.schedule(this.logs.length);
  }
  private schedule(depth: number): void {
    if (this.closed) return;
    if (depth >= this.maxBatch) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      const t = setTimeout(() => { void this.flush(); }, 0);
      (t as any).unref?.();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.flushMs);
    (this.timer as any).unref?.();
  }

  /** Write everything queued, in batches. Never rejects. Runs outside any request context / active span. */
  flush(): Promise<void> {
    return runOutsideContext(() => runOutsideSpan(() => this.flushInner()));
  }
  private flushInner(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.logs.length || this.spans.length ? this.flushInner() : undefined));
    this.flushing = (async () => {
      while (this.logs.length || this.spans.length) {
        if (this.now() < this.backoffUntil) {
          if (this.logs.length) storeDropped.inc({ kind: 'log', reason: 'backoff' }, this.logs.length);
          if (this.spans.length) storeDropped.inc({ kind: 'span', reason: 'backoff' }, this.spans.length);
          this.logs = []; this.spans = [];
          break;
        }
        const rawLogs = this.logs.splice(0, this.maxBatch), rawSpans = this.spans.splice(0, this.maxBatch);
        const batch: TelemetryBatch = { logs: [], spans: [] };
        for (const l of rawLogs) { try { batch.logs.push(toLogRow(l.rec, l.spanId)); } catch { storeDropped.inc({ kind: 'log', reason: 'unconvertible' }); } }
        for (const sp of rawSpans) { try { const r = toSpanRow(sp, this.service); if (r) batch.spans.push(r); } catch { storeDropped.inc({ kind: 'span', reason: 'unconvertible' }); } }
        if (!batch.logs.length && !batch.spans.length) continue;
        try {
          await withTimeout(Promise.resolve().then(() => this.opts.writer(batch)), this.writeTimeoutMs);
          if (batch.logs.length) storeWritten.inc({ kind: 'log' }, batch.logs.length);
          if (batch.spans.length) storeWritten.inc({ kind: 'span' }, batch.spans.length);
        } catch {
          if (batch.logs.length) storeDropped.inc({ kind: 'log', reason: 'write_failed' }, batch.logs.length);
          if (batch.spans.length) storeDropped.inc({ kind: 'span', reason: 'write_failed' }, batch.spans.length);
          this.backoffUntil = this.backoffMs > 0 ? this.now() + this.backoffMs : 0;
        }
      }
    })().catch(() => undefined).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flush();
    this.closed = true;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('telemetry store write timed out')), ms);
    (t as any).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ── configuration + installation ───────────────────────────────────────────────────────────────────────────────────
export interface TelemetryStoreConfig { enabled: boolean; logSample: number; traceSample: number; maxRowsPerMin: number; retentionDays: number }
/** TELEMETRY_STORE=off disables it; TELEMETRY_LOG_SAMPLE / TELEMETRY_TRACE_SAMPLE (0–1, default 0.1);
 *  TELEMETRY_STORE_MAX_ROWS_PER_MIN (default 3000 per process); TELEMETRY_STORE_RETENTION_DAYS (1–90, default 14). */
export function telemetryStoreConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelemetryStoreConfig {
  const num = (v: string | undefined, d: number, lo: number, hi: number) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
  return {
    enabled: String(env.TELEMETRY_STORE ?? 'on').trim().toLowerCase() !== 'off',
    logSample: num(env.TELEMETRY_LOG_SAMPLE, 0.1, 0, 1),
    traceSample: num(env.TELEMETRY_TRACE_SAMPLE, 0.1, 0, 1),
    maxRowsPerMin: Math.floor(num(env.TELEMETRY_STORE_MAX_ROWS_PER_MIN, 3_000, 1, 1_000_000)),
    retentionDays: Math.floor(num(env.TELEMETRY_STORE_RETENTION_DAYS, 14, 1, 90)),
  };
}

let installed: TelemetrySink | null = null;
/** Install (or with null, remove) the process's sink: the logger tap + the tracer's local destination. Returns it. */
export function installTelemetrySink(opts: TelemetrySinkOptions | null): TelemetrySink | null {
  const prev = installed;
  installed = null;
  setLogTap(null); setLocalSpanSink(null);
  if (prev) void prev.shutdown().catch(() => undefined);
  if (!opts) return null;
  const sink = new TelemetrySink(opts);
  installed = sink;
  setLogTap((rec) => sink.offerLog(rec, getContext(), activeSpanContext()?.spanId));
  setLocalSpanSink({ keepsTrace: (id) => sink.keepsTrace(id), onEnd: (s) => sink.offerSpan(s) });
  return sink;
}
export function installedTelemetrySink(): TelemetrySink | null { return installed; }
