// telemetry-store.test — BUILD_PLAN Phase 14 A (Constitution 11 §286, §291–292): the log + span sink that feeds the
// platform's own short-retention store.
//
// What is proved, with a fake writer (no database): lines and spans are BATCHED (one write per flush, never one per line);
// the queue is BOUNDED (oldest dropped, counted); a dead or hanging database never throws into the caller, never blocks
// it, and is counted; INFO is sampled deterministically per request while WARN+ always lands; the INFO lines of a request
// that later errors are promoted; and NOTHING unredacted lands — a seeded secret, phone number, email and card number in
// the message, in fields and in span attributes are all masked before the writer sees them.
import { describe, it, expect, afterEach } from 'vitest';
import {
  TelemetrySink, toLogRow, toSpanRow, scrubFreeText, storeDropped, storeWritten, keepFraction, installTelemetrySink, type TelemetryBatch,
} from './telemetry-store';
import { log, setLogSink } from './logger';
import { runWithContext, getContext, newRequestId, type TelemetryContext } from './request-context';
import { configureTracing, startSpan, withSpan, tracingEnabled } from './tracing';
import type { SpanData } from './tracing';

const SECRET = 'sk_live_51Hx9ExampleSecretValue0001';
const PHONE = '(856) 555-0142';
const EMAIL = 'jane.customer@example.com';
const CARD = '4111 1111 1111 1111';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLXg';
const dropped = (kind: string, reason: string) => Number(storeDropped.snapshot().find((x) => x.labels.kind === kind && x.labels.reason === reason)?.value ?? 0);
const written = (kind: string) => Number(storeWritten.snapshot().find((x) => x.labels.kind === kind)?.value ?? 0);

function capture() {
  const batches: TelemetryBatch[] = [];
  return { batches, writer: async (b: TelemetryBatch) => { batches.push(JSON.parse(JSON.stringify(b))); } };
}
const ctx = (over: Partial<TelemetryContext> = {}): TelemetryContext => ({ requestId: newRequestId(), correlationId: 'corr_test_0001', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), service: 'api', ...over });
const rec = (level: any, msg: string, extra: Record<string, unknown> = {}) => ({ timestamp: '2026-10-01T10:00:00.000Z', level, service: 'aipowersalon-api', environment: 'test', msg, ...extra });
const span = (over: Partial<SpanData> = {}): SpanData => ({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), name: 'GET /appointments/:id', kind: 'server', startMs: Date.parse('2026-10-01T10:00:00Z'), endMs: Date.parse('2026-10-01T10:00:00Z') + 12.5, attributes: {}, status: { code: 'unset' }, ...over });

describe('redaction before write — nothing unredacted lands', () => {
  it('a secret, a phone number, an email, a card number and a JWT in the MESSAGE are masked', () => {
    const row = toLogRow(rec('error', `charge failed for ${EMAIL} ${PHONE} card ${CARD} key ${SECRET} auth Bearer ${JWT}`), undefined);
    const all = JSON.stringify(row);
    for (const leak of [EMAIL, PHONE, '8565550142', CARD, '4111111111111111', SECRET, JWT]) expect(all).not.toContain(leak);
    expect(row.msg).toContain('j***@example.com');
    expect(row.msg).toContain('****1111');
  });
  it('the same values in FIELDS (by key and inside free text at any depth) are masked; bodies / headers / query are dropped', () => {
    const row = toLogRow(rec('warn', 'request.rejected', {
      phone: PHONE, email: EMAIL, apiKey: SECRET, token: SECRET, password: 'hunter2hunter2',
      note: `call ${PHONE} or mail ${EMAIL}`, nested: { deeper: [{ text: `card ${CARD} secret=${SECRET}`, client_secret: SECRET }] },
      body: { anything: 'x' }, headers: { authorization: `Bearer ${JWT}` }, query: { q: EMAIL },
    }), undefined);
    const all = JSON.stringify(row);
    for (const leak of [EMAIL, PHONE, '8565550142', CARD, SECRET, JWT, 'hunter2hunter2']) expect(all).not.toContain(leak);
    expect(row.fields).not.toHaveProperty('body');
    expect(row.fields).not.toHaveProperty('headers');
    expect(row.fields).not.toHaveProperty('query');
  });
  it('span attributes and the span status message are scrubbed too', () => {
    const row = toSpanRow(span({ attributes: { 'db.statement': `select * from c where email='${EMAIL}'`, 'peer.phone': PHONE, 'http.url': `https://x.test/?token=${SECRET}` }, status: { code: 'error', message: `failed for ${EMAIL}` } }), 'aipowersalon-api');
    const all = JSON.stringify(row);
    for (const leak of [EMAIL, PHONE, SECRET]) expect(all).not.toContain(leak);
  });
  it('ids, ISO timestamps, UUIDs and durations are NOT mangled by the phone / card scrub', () => {
    const uuid = '0f8b4c2e-1234-4567-8901-123456789012';
    const s = `tenant ${uuid} at 2026-10-01T10:00:00.000Z took 1234 ms req_01JABCDEFG0123456789ABCDEF order 100234`;
    expect(scrubFreeText(s)).toBe(s);
  });
  it('a secret that LOOKS like a secret (secret=…, api_key=…) inside free text is masked', () => {
    expect(scrubFreeText(`retry with secret=${SECRET}&x=1`)).not.toContain(SECRET);
    expect(scrubFreeText(`api_key: ${SECRET}`)).not.toContain(SECRET);
  });
  it('the message and the fields are bounded in size', () => {
    const row = toLogRow(rec('error', 'x'.repeat(5000), { big: 'y'.repeat(50_000) }), undefined);
    expect(row.msg.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(row.fields).length).toBeLessThanOrEqual(4_200);
  });
  it('a tenant id that is not a UUID is never written into the uuid column; route / status / duration are lifted out', () => {
    const row = toLogRow(rec('info', 'request.completed', { tenantId: 'not-a-uuid', route: '/appointments/:id', status: 200, durationMs: 41.6 }), undefined);
    expect(row.tenant_id).toBeNull();
    expect(row).toMatchObject({ route: '/appointments/:id', status: 200, duration_ms: 42 });
  });
});

describe('batching, bounds and fail-open', () => {
  it('many lines → one write per flush', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 1, flushMs: 60_000 });
    for (let i = 0; i < 120; i++) sink.offerLog(rec('warn', `w${i}`), undefined);
    await sink.flush();
    expect(c.batches).toHaveLength(1);
    expect(c.batches[0].logs).toHaveLength(120);
  });
  it('a batch never exceeds maxBatch rows per kind', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 1, maxBatch: 50, flushMs: 60_000 });
    for (let i = 0; i < 120; i++) sink.offerLog(rec('warn', `w${i}`), undefined);
    await sink.flush();
    expect(c.batches.map((b) => b.logs.length)).toEqual([50, 50, 20]);
  });
  it('the queue is bounded: the OLDEST lines are dropped and counted', async () => {
    const c = capture();
    const before = dropped('log', 'queue_full');
    const sink = new TelemetrySink({ writer: c.writer, maxQueue: 10, flushMs: 60_000 });
    for (let i = 0; i < 25; i++) sink.offerLog(rec('error', `e${i}`), undefined);
    expect(sink.queued().logs).toBe(10);
    expect(dropped('log', 'queue_full') - before).toBe(15);
    await sink.flush();
    expect(c.batches[0].logs.map((l) => l.msg)).toEqual(Array.from({ length: 10 }, (_, i) => `e${i + 15}`));
  });
  it('a dead database: the write rejects → the batch is dropped and counted; nothing throws; later batches still try', async () => {
    let calls = 0;
    const before = dropped('log', 'write_failed');
    const sink = new TelemetrySink({ writer: async () => { calls++; throw new Error('ECONNREFUSED'); }, flushMs: 60_000, backoffMs: 0 });
    sink.offerLog(rec('error', 'a'), undefined);
    await expect(sink.flush()).resolves.toBeUndefined();
    sink.offerLog(rec('error', 'b'), undefined);
    await sink.flush();
    expect(calls).toBe(2);
    expect(dropped('log', 'write_failed') - before).toBe(2);
  });
  it('after a failure the sink backs off instead of hammering a dead database (lines meanwhile are dropped, counted)', async () => {
    let calls = 0;
    const sink = new TelemetrySink({ writer: async () => { calls++; throw new Error('down'); }, flushMs: 60_000, backoffMs: 60_000 });
    sink.offerLog(rec('error', 'a'), undefined); await sink.flush();
    sink.offerLog(rec('error', 'b'), undefined); await sink.flush();
    expect(calls).toBe(1);
  });
  it('a HANGING database: the write times out, the flush settles, and offering never waits on it', async () => {
    const before = dropped('log', 'write_failed');
    const sink = new TelemetrySink({ writer: () => new Promise(() => undefined), flushMs: 60_000, writeTimeoutMs: 30, backoffMs: 0 });
    sink.offerLog(rec('error', 'a'), undefined);
    const t0 = Date.now();
    await sink.flush();
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(dropped('log', 'write_failed') - before).toBe(1);
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) sink.offerLog(rec('error', `x${i}`), undefined);
    expect(performance.now() - t1).toBeLessThan(500);   // offering is synchronous queue work, never I/O
  });
  it('a writer that throws SYNCHRONOUSLY is also contained', async () => {
    const sink = new TelemetrySink({ writer: (() => { throw new Error('sync'); }) as any, flushMs: 60_000, backoffMs: 0 });
    sink.offerLog(rec('error', 'a'), undefined);
    await expect(sink.flush()).resolves.toBeUndefined();
  });
  it('the per-minute row cap bounds ingestion (rate_limited, counted)', async () => {
    const c = capture();
    const before = dropped('log', 'rate_limited');
    let now = 1_000_000;
    const sink = new TelemetrySink({ writer: c.writer, maxRowsPerMin: 5, flushMs: 60_000, now: () => now });
    for (let i = 0; i < 8; i++) sink.offerLog(rec('error', `e${i}`), undefined);
    expect(dropped('log', 'rate_limited') - before).toBe(3);
    now += 61_000;
    sink.offerLog(rec('error', 'next minute'), undefined);
    await sink.flush();
    expect(c.batches[0].logs).toHaveLength(6);
    expect(written('log')).toBeGreaterThanOrEqual(6);
  });
  it('the flush timer fires on its own (batched, not per line)', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 1, flushMs: 20 });
    sink.offerLog(rec('warn', 'a'), undefined); sink.offerLog(rec('warn', 'b'), undefined);
    await new Promise((r) => setTimeout(r, 80));
    expect(c.batches).toHaveLength(1);
    expect(c.batches[0].logs).toHaveLength(2);
    await sink.shutdown();
  });
  it('the flush runs OUTSIDE the request context it was scheduled from — its own queries can never become spans of that request', async () => {
    let seen: unknown = 'unset';
    const sink = new TelemetrySink({ writer: async () => { seen = getContext(); }, flushMs: 10 });
    runWithContext(ctx(), () => sink.offerLog(rec('error', 'inside'), getContext()));
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toBeUndefined();
    await sink.shutdown();
  });
});

describe('sampling', () => {
  it('WARN and above always land; INFO lands at the sampled fraction, decided per REQUEST (all or none of its lines)', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 0.25, traceSample: 0, flushMs: 60_000, maxQueue: 100_000, maxRowsPerMin: 1e9 });
    const ids = Array.from({ length: 2000 }, () => newRequestId());
    for (const id of ids) { const cx = ctx({ requestId: id }); sink.offerLog(rec('info', 'one', { requestId: id }), cx); sink.offerLog(rec('info', 'two', { requestId: id }), cx); }
    sink.offerLog(rec('warn', 'always'), undefined);
    await sink.flush();
    const logs = c.batches.flatMap((b) => b.logs);
    const per = new Map<string, number>();
    for (const l of logs) if (l.request_id) per.set(l.request_id, (per.get(l.request_id) ?? 0) + 1);
    expect([...per.values()].every((n) => n === 2)).toBe(true);
    expect(per.size / ids.length).toBeGreaterThan(0.18);
    expect(per.size / ids.length).toBeLessThan(0.32);
    expect(logs.some((l) => l.msg === 'always')).toBe(true);
  });
  it('a request that errors keeps its EARLIER info lines (promoted from the pending buffer)', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 0, traceSample: 0, flushMs: 60_000 });
    const cx = ctx();
    sink.offerLog(rec('info', 'step.one', { requestId: cx.requestId }), cx);
    sink.offerLog(rec('info', 'step.two', { requestId: cx.requestId }), cx);
    sink.offerLog(rec('error', 'request.failed', { requestId: cx.requestId, status: 500 }), cx);
    sink.offerLog(rec('info', 'request.completed', { requestId: cx.requestId, status: 500 }), cx);
    const other = ctx();
    sink.offerLog(rec('info', 'unrelated', { requestId: other.requestId }), other);
    await sink.flush();
    expect(c.batches[0].logs.map((l) => l.msg)).toEqual(['step.one', 'step.two', 'request.failed', 'request.completed']);
  });
  it('INFO lines of a request whose trace is stored always land (the trace view shows its logs)', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 0, traceSample: 1, flushMs: 60_000 });
    const cx = ctx({ traceSampled: true });
    sink.offerLog(rec('info', 'in.trace', { requestId: cx.requestId, traceId: cx.traceId }), cx);
    await sink.flush();
    expect(c.batches[0].logs.map((l) => l.msg)).toEqual(['in.trace']);
  });
  it('the trace decision is a deterministic function of the trace id (every process agrees)', () => {
    const id = '0af7651916cd43dd8448eb211c80319c';
    expect(keepFraction(id, 0.5)).toBe(keepFraction(id, 0.5));
    expect(keepFraction(id, 0)).toBe(false);
    expect(keepFraction(id, 1)).toBe(true);
  });
  it('debug / trace lines never land', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, logSample: 1, flushMs: 60_000 });
    sink.offerLog(rec('debug', 'noise'), undefined);
    await sink.flush();
    expect(c.batches).toHaveLength(0);
  });
  it('spans land only for stored traces (and errored spans always), with tenant lifted from the span attribute', async () => {
    const c = capture();
    const sink = new TelemetrySink({ writer: c.writer, traceSample: 0, flushMs: 60_000 });
    const tenant = '11111111-2222-4333-8444-555555555555';
    sink.offerSpan(span({ name: 'kept-because-error', status: { code: 'error' }, attributes: { 'aipowersalon.tenant_id': tenant } }));
    sink.offerSpan(span({ name: 'not-sampled' }));
    await sink.flush();
    expect(c.batches[0].spans.map((s) => s.name)).toEqual(['kept-because-error']);
    expect(c.batches[0].spans[0].tenant_id).toBe(tenant);
    expect(c.batches[0].spans[0].duration_ms).toBeCloseTo(12.5);
  });
});

describe('installTelemetrySink — the logger tap and the tracer\'s local destination', () => {
  afterEach(() => { installTelemetrySink(null); configureTracing(null); setLogSink(null); });
  it('log.* lines and finished spans reach the store, the logger keeps writing to its own sink, and tracing turns on with no OTLP endpoint', async () => {
    const c = capture();
    const console: any[] = [];
    setLogSink({ write: (r) => console.push(r) });
    configureTracing(null);
    const sink = installTelemetrySink({ writer: c.writer, logSample: 1, traceSample: 1, flushMs: 60_000 });
    expect(tracingEnabled()).toBe(true);
    const root = startSpan('GET /x', { kind: 'server', parent: null });
    runWithContext(ctx({ traceId: root.traceId, spanId: root.spanId, traceSampled: root.sampled }), () => {
      withSpan('db select x', { kind: 'client' }, () => log.warn('inside.span', { phone: PHONE }));
    });
    root.end();
    await sink!.flush();
    const logs = c.batches.flatMap((b) => b.logs), spans = c.batches.flatMap((b) => b.spans);
    expect(console.some((r) => r.msg === 'inside.span')).toBe(true);
    const line = logs.find((l) => l.msg === 'inside.span')!;
    expect(line.trace_id).toBe(root.traceId);
    expect(JSON.stringify(line)).not.toContain('555-0142');
    expect(spans.map((s) => s.name).sort()).toEqual(['GET /x', 'db select x']);
    const child = spans.find((s) => s.name === 'db select x')!;
    expect(child.parent_span_id).toBe(root.spanId);
  });
  it('uninstalled: tracing returns to the environment (off without an endpoint) and nothing is captured', async () => {
    installTelemetrySink(null);
    configureTracing(null);
    expect(tracingEnabled()).toBe(false);
  });
  it('a sink whose writer throws never breaks log.* or a span', () => {
    installTelemetrySink({ writer: () => { throw new Error('x'); }, logSample: 1, traceSample: 1, flushMs: 60_000 });
    expect(() => { log.error('still fine'); startSpan('s', { parent: null }).end(); }).not.toThrow();
  });
});
