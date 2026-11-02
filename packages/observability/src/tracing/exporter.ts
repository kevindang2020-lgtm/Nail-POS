// exporter.ts — finished spans leave the process here: a bounded, batching queue and an OTLP/HTTP JSON exporter.
//
// WHY JSON OVER HTTP, AND NO SDK. OTLP/HTTP accepts `application/json` at `<endpoint>/v1/traces` (every collector —
// the OpenTelemetry Collector, Grafana Tempo/Alloy, Honeycomb, Datadog's OTLP intake — takes it). Writing the ~80 lines
// that build the JSON keeps the API free of the @opentelemetry/* dependency tree (none is in the lockfile) and of its
// global monkey-patching; our three choke points (request middleware, pool hook, instrumentedFetch) already see every
// request, query and provider call.
//
// THE RULES (Constitution 11 §286: telemetry must never take the product down):
//   • the queue is bounded — when the collector is slow or gone the OLDEST spans are dropped, and counted
//     (aipowersalon_trace_spans_dropped_total{reason="queue_full"}); memory never grows with an outage;
//   • export failures (network, timeout, non-2xx) are swallowed and counted (reason="export_failed"); nothing retries
//     in a loop, nothing throws into a request, a job or shutdown;
//   • each POST has a 5 s timeout; the flush timer is unref'd so it never holds the process open;
//   • shutdown() flushes what is queued (called from the API's shutdown hook).
import { registry } from '../metrics';
import type { SpanData, SpanKind } from './span-data';

export const spansExported = registry.counter('aipowersalon_trace_spans_exported_total', 'Spans accepted by the OTLP collector', []);
export const spansDropped = registry.counter('aipowersalon_trace_spans_dropped_total', 'Spans lost before export (queue_full = collector slower than traffic; export_failed = collector unreachable or refused)', ['reason']);

export interface SpanExporter { export(spans: SpanData[]): Promise<void>; shutdown?(): Promise<void> }
export interface SpanProcessor { onEnd(span: SpanData): void; flush(): Promise<void>; shutdown(): Promise<void> }

/** Test/diagnostic exporter: keeps what it is given. */
export class InMemorySpanExporter implements SpanExporter {
  readonly spans: SpanData[] = [];
  async export(spans: SpanData[]): Promise<void> { this.spans.push(...spans); }
  reset(): void { this.spans.length = 0; }
}

/** Hands each span straight to the exporter — tests use it through configureTracing({ exporter }). */
export class SimpleSpanProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter) {}
  onEnd(span: SpanData): void { this.exporter.export([span]).catch(() => spansDropped.inc({ reason: 'export_failed' })); }
  async flush(): Promise<void> { /* nothing queued */ }
  async shutdown(): Promise<void> { await this.exporter.shutdown?.().catch(() => undefined); }
}

export interface BatchOptions { maxQueue?: number; maxBatch?: number; delayMs?: number }

export class BatchSpanProcessor implements SpanProcessor {
  private queue: SpanData[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly maxQueue: number; private readonly maxBatch: number; private readonly delayMs: number;
  constructor(private readonly exporter: SpanExporter, opts: BatchOptions = {}) {
    this.maxQueue = Math.max(1, opts.maxQueue ?? 2048);
    this.maxBatch = Math.max(1, opts.maxBatch ?? 512);
    this.delayMs = Math.max(10, opts.delayMs ?? 2_000);
  }

  onEnd(span: SpanData): void {
    if (this.queue.length >= this.maxQueue) { this.queue.shift(); spansDropped.inc({ reason: 'queue_full' }); }
    this.queue.push(span);
    if (this.queue.length >= this.maxBatch) { void this.flush(); return; }
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs);
      (this.timer as any).unref?.();
    }
  }

  /** Export everything queued, in batches. Never rejects. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.queue.length ? this.flush() : undefined));
    this.flushing = (async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.maxBatch);
        try { await this.exporter.export(batch); spansExported.inc({}, batch.length); }
        catch { spansDropped.inc({ reason: 'export_failed' }, batch.length); }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flush();
    await this.exporter.shutdown?.().catch(() => undefined);
  }
}

// ── OTLP JSON ────────────────────────────────────────────────────────────────────────────────────────────────────────
const KIND: Record<SpanKind, number> = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };
const STATUS = { unset: 0, ok: 1, error: 2 } as const;

/** Epoch milliseconds (fractional) → the decimal-string nanoseconds OTLP JSON expects (int64 does not fit a double). */
export function msToUnixNano(ms: number): string {
  const whole = Math.floor(ms);
  const frac = Math.round((ms - whole) * 1e6);
  return (BigInt(whole) * 1_000_000n + BigInt(frac)).toString();
}

function anyValue(v: string | number | boolean): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}
const attrs = (o: Record<string, string | number | boolean>) => Object.entries(o).map(([key, v]) => ({ key, value: anyValue(v) }));

export interface ResourceInfo { serviceName: string; serviceVersion?: string; environment?: string }

export function toOtlpJson(spans: SpanData[], resource: ResourceInfo): { resourceSpans: any[] } {
  const res: Record<string, string> = { 'service.name': resource.serviceName };
  if (resource.serviceVersion) res['service.version'] = resource.serviceVersion;
  if (resource.environment) res['deployment.environment'] = resource.environment;
  return {
    resourceSpans: [{
      resource: { attributes: attrs(res) },
      scopeSpans: [{
        scope: { name: '@aipowersalon/observability', version: '1' },
        spans: spans.map((s) => ({
          traceId: s.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name, kind: KIND[s.kind] ?? 1,
          startTimeUnixNano: msToUnixNano(s.startMs), endTimeUnixNano: msToUnixNano(s.endMs),
          attributes: attrs(s.attributes),
          status: s.status.message ? { code: STATUS[s.status.code], message: s.status.message } : { code: STATUS[s.status.code] },
          ...(s.links?.length ? { links: s.links.map((l) => ({ traceId: l.traceId, spanId: l.spanId })) } : {}),
        })),
      }],
    }],
  };
}

/** OTEL_EXPORTER_OTLP_HEADERS: `k1=v1,k2=v2`, values URL-decoded (the OTel spec's format). Malformed pairs are skipped. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of String(raw ?? '').split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const k = pair.slice(0, i).trim().toLowerCase(), v = pair.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

type FetchLike = (url: string, init: any) => Promise<{ ok?: boolean; status?: number }>;

export class OtlpHttpJsonExporter implements SpanExporter {
  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { endpoint: string; headers?: Record<string, string>; serviceName: string; serviceVersion?: string; environment?: string; timeoutMs?: number; fetchImpl?: FetchLike }) {
    this.url = `${opts.endpoint.replace(/\/+$/, '')}/v1/traces`;
    // The RAW global fetch, never instrumentedFetch: exporting a span must not create a span (or trip a provider breaker).
    this.fetchImpl = opts.fetchImpl ?? ((u, i) => (globalThis as any).fetch(u, i));
  }
  async export(spans: SpanData[]): Promise<void> {
    if (!spans.length) return;
    const body = JSON.stringify(toOtlpJson(spans, { serviceName: this.opts.serviceName, serviceVersion: this.opts.serviceVersion, environment: this.opts.environment }));
    const res = await this.fetchImpl(this.url, {
      method: 'POST', body,
      headers: { ...(this.opts.headers ?? {}), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
    });
    const status = Number(res?.status ?? 0);
    if (!(res?.ok ?? (status >= 200 && status < 300))) throw new Error(`otlp export answered ${status}`);
  }
}
