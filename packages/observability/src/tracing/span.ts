// span.ts — the span model, the process tracer, and the active-span context (BUILD_PLAN Phase 11; Constitution 4 §101,
// Constitution 11 §16–19 "distributed tracing").
//
// ONE CONTEXT, TWO LAYERS. The request/job/event context (request-context.ts) already carries `traceId`; it now also
// carries the span that context IS (the server span of a request, the job span, the consumer span). Inside it, a
// nested `withSpan()` opens a child in a second AsyncLocalStorage that holds only the active span — so the request's
// context object (which middleware enriches IN PLACE with tenant/actor, and whose query counter the N+1 detector reads)
// is never copied or shadowed by a child span.
//
// SAMPLING is parent-based: a span with a parent follows the parent's `sampled` flag (so one trace is all-or-nothing
// across processes); a root span is sampled with probability OTEL_TRACES_SAMPLER_ARG (default 1 when an endpoint is
// set). With no OTEL_EXPORTER_OTLP_ENDPOINT, tracing is OFF: ids are still minted and propagated (`traceparent` on every
// response and every provider call, so logs on both sides join), but nothing is recorded or exported.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { getContext, newTraceId } from '../request-context';
import { BUILD } from '../build-info';
import { BatchSpanProcessor, OtlpHttpJsonExporter, SimpleSpanProcessor, parseOtlpHeaders, type BatchOptions, type SpanExporter, type SpanProcessor } from './exporter';
import { formatTraceparent, newSpanId, type SpanContext } from './traceparent';
import type { AttributeValue, SpanData, SpanKind, SpanLink, SpanStatusCode } from './span-data';

// ── configuration ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TracingConfig { enabled: boolean; endpoint?: string; headers: Record<string, string>; serviceName: string; sampleRatio: number }

/** The reserved names (Phase 11 contract): OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, OTEL_SERVICE_NAME,
 *  OTEL_TRACES_SAMPLER_ARG. No endpoint ⇒ off. */
export function tracingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TracingConfig {
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim() || undefined;
  const ratioRaw = Number(env.OTEL_TRACES_SAMPLER_ARG);
  const sampleRatio = env.OTEL_TRACES_SAMPLER_ARG === undefined || !Number.isFinite(ratioRaw) ? 1 : Math.min(1, Math.max(0, ratioRaw));
  const role = String(env.PROCESS_ROLE ?? 'all').trim().toLowerCase() || 'all';
  return {
    enabled: !!endpoint, endpoint, headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    serviceName: String(env.OTEL_SERVICE_NAME ?? '').trim() || `aipowersalon-${role}`, sampleRatio,
  };
}

interface TracerState { enabled: boolean; sampleRatio: number; processor: SpanProcessor | null }
let state: TracerState | null = null;

function fromEnv(): TracerState {
  const c = tracingConfigFromEnv();
  if (!c.enabled || !c.endpoint) return { enabled: false, sampleRatio: c.sampleRatio, processor: null };
  const exporter = new OtlpHttpJsonExporter({ endpoint: c.endpoint, headers: c.headers, serviceName: c.serviceName, serviceVersion: BUILD.version, environment: process.env.NODE_ENV });
  return { enabled: true, sampleRatio: c.sampleRatio, processor: new BatchSpanProcessor(exporter) };
}
function tracer(): TracerState { if (!state) state = fromEnv(); return state; }

// ── the local destination (BUILD_PLAN Phase 14 A) ─────────────────────────────────────────────────────────────────────
/** The platform's own trace store (telemetry-store.ts) — a SECOND destination beside the OTLP exporter. It decides which
 *  traces it keeps (a deterministic function of the trace id, so every process agrees) and only enqueues on onEnd. With
 *  it installed tracing is ON even without an OTLP endpoint; a root span is then sampled by its keepsTrace(). */
export interface LocalSpanSink { keepsTrace(traceId: string): boolean; onEnd(span: SpanData): void }
let local: LocalSpanSink | null = null;
export function setLocalSpanSink(s: LocalSpanSink | null): void { local = s; }
const isOn = (t: TracerState): boolean => t.enabled || !!local;
/** Run `fn` with no active child span (the telemetry sink's own writes are never spans of what scheduled them). */
export function runOutsideSpan<T>(fn: () => T): T { return activeSpan.exit(fn); }

/**
 * Replace the tracer. `null` → back to the environment (read lazily on the next span). With an exporter (tests, a
 * diagnostic sink) tracing is on; with neither exporter nor processor it is off. `batch` wraps the exporter in the
 * batching processor instead of the simple one.
 */
export function configureTracing(opts: { exporter?: SpanExporter; processor?: SpanProcessor; sampleRatio?: number; batch?: BatchOptions } | null): void {
  if (opts === null) { state = null; return; }
  const processor = opts.processor ?? (opts.exporter ? (opts.batch ? new BatchSpanProcessor(opts.exporter, opts.batch) : new SimpleSpanProcessor(opts.exporter)) : null);
  state = { enabled: !!processor, sampleRatio: opts.sampleRatio ?? 1, processor };
}
export function tracingEnabled(): boolean { return isOn(tracer()); }
/** Export what is queued. Never rejects. */
export async function flushTracing(): Promise<void> { try { await state?.processor?.flush(); } catch { /* §286 */ } }
/** Flush and stop (process shutdown). Never rejects. */
export async function shutdownTracing(): Promise<void> { try { await state?.processor?.shutdown(); } catch { /* §286 */ } }

// ── the active span ──────────────────────────────────────────────────────────────────────────────────────────────────
const activeSpan = new AsyncLocalStorage<SpanContext>();

/** The span new work should be a child of: a withSpan() child if one is open, else the request/job/event context's own
 *  span. A context without a span id (built by hand) still pins the trace id. */
export function activeSpanContext(): (Omit<SpanContext, 'spanId'> & { spanId?: string }) | undefined {
  const s = activeSpan.getStore();
  if (s) return s;
  const c = getContext();
  if (!c) return undefined;
  return { traceId: c.traceId, spanId: c.spanId, sampled: c.traceSampled ?? isOn(tracer()) };
}

/** The `traceparent` to store with work that continues later (a job, an outbox event) or send to a provider. */
export function currentTraceparent(): string | undefined {
  const c = activeSpanContext();
  return c?.spanId ? formatTraceparent(c as SpanContext) : undefined;
}

export const nowMs = (): number => performance.timeOrigin + performance.now();

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly sampled: boolean;
  /** False when tracing is off or the trace is not sampled: the span is a cheap id carrier and records nothing. */
  readonly recording: boolean;
  private name: string;
  private readonly attributes: Record<string, AttributeValue> = {};
  private status: { code: SpanStatusCode; message?: string } = { code: 'unset' };
  private endMs: number | undefined;
  readonly kind: SpanKind;
  private readonly startMs: number;
  private readonly links?: SpanLink[];
  constructor(init: { traceId: string; spanId: string; parentSpanId?: string; sampled: boolean; recording: boolean; name: string; kind: SpanKind; startMs: number; links?: SpanLink[] }) {
    this.traceId = init.traceId; this.spanId = init.spanId; this.parentSpanId = init.parentSpanId;
    this.sampled = init.sampled; this.recording = init.recording; this.name = init.name;
    this.kind = init.kind; this.startMs = init.startMs; this.links = init.links;
  }
  get ended(): boolean { return this.endMs !== undefined; }
  updateName(name: string): this { this.name = name; return this; }
  setAttribute(key: string, value: AttributeValue | null | undefined): this {
    if (value !== null && value !== undefined && this.recording) this.attributes[key] = value;
    return this;
  }
  setAttributes(o: Record<string, AttributeValue | null | undefined>): this { for (const [k, v] of Object.entries(o)) this.setAttribute(k, v); return this; }
  /** ERROR carries the exception CLASS only — a message can hold customer data (§134). */
  setStatus(code: SpanStatusCode, message?: string): this { this.status = message ? { code, message } : { code }; return this; }
  recordError(e: unknown): this { return this.setStatus('error', (e as { name?: string })?.name || 'Error'); }
  context(): SpanContext { return { traceId: this.traceId, spanId: this.spanId, sampled: this.sampled }; }
  traceparent(): string { return formatTraceparent(this.context()); }
  end(endMs: number = nowMs()): void {
    if (this.endMs !== undefined) return;
    this.endMs = endMs;
    if (!this.recording) return;
    let data: SpanData;
    try { data = this.toData(); } catch { return; }
    try { state?.processor?.onEnd(data); } catch { /* §286: never fail the work being traced */ }
    try { local?.onEnd(data); } catch { /* the local store never fails the work being traced either */ }
  }
  toData(): SpanData {
    return {
      traceId: this.traceId, spanId: this.spanId, ...(this.parentSpanId ? { parentSpanId: this.parentSpanId } : {}),
      name: this.name, kind: this.kind, startMs: this.startMs, endMs: this.endMs ?? nowMs(), attributes: { ...this.attributes },
      status: { ...this.status }, ...(this.links?.length ? { links: this.links.map((l) => ({ ...l })) } : {}),
    };
  }
}

export interface StartSpanOptions {
  kind?: SpanKind;
  /** undefined = the active span (or none → a new trace); null = force a new trace; a SpanContext = that parent. */
  parent?: SpanContext | null;
  attributes?: Record<string, AttributeValue | null | undefined>;
  links?: SpanLink[];
  startMs?: number;
}

export function startSpan(name: string, opts: StartSpanOptions = {}): Span {
  const t = tracer();
  const parent = opts.parent === undefined ? activeSpanContext() : opts.parent ?? undefined;
  const traceId = parent?.traceId ?? newTraceId();
  // Root sampling: the OTLP ratio when an exporter is configured; otherwise (local store only) the store's own
  // deterministic per-trace decision, so an unsampled trace records nothing at all.
  let sampled: boolean;
  if (parent) sampled = parent.sampled;
  else if (t.enabled) sampled = Math.random() < t.sampleRatio;
  else { try { sampled = !!local && local.keepsTrace(traceId); } catch { sampled = false; } }
  const span = new Span({
    traceId, spanId: newSpanId(), parentSpanId: parent?.spanId || undefined,
    sampled, recording: sampled && ((t.enabled && !!t.processor) || !!local), name, kind: opts.kind ?? 'internal', startMs: opts.startMs ?? nowMs(), links: opts.links,
  });
  if (opts.attributes) span.setAttributes(opts.attributes);
  return span;
}

/** Run `fn` inside a child span; the span ends when `fn` settles, ERROR (exception class) if it throws. */
export function withSpan<T>(name: string, opts: StartSpanOptions, fn: (span: Span) => T): T {
  const span = startSpan(name, opts);
  return activeSpan.run(span.context(), () => {
    let out: T;
    try { out = fn(span); } catch (e) { span.recordError(e); span.end(); throw e; }
    if (out && typeof (out as any).then === 'function') {
      return (out as any).then((v: unknown) => { span.end(); return v; }, (e: unknown) => { span.recordError(e); span.end(); throw e; }) as T;
    }
    span.end();
    return out;
  });
}
