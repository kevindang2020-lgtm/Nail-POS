// tracing.test — BUILD_PLAN Phase 11 (Constitution 4 §101/§187, Constitution 11 §16–19): W3C trace context and spans.
//
// What is proved here, without a network: a traceparent survives a round trip and malformed ones are refused; one
// request's spans — the server span, a DB query, a provider call and the job it enqueued — share ONE trace id; the
// provider call carries the trace onward in its `traceparent` header; and the OTLP/HTTP JSON exporter batches, bounds
// its queue (drop oldest, counted), and survives a dead endpoint without ever throwing into the caller.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  parseTraceparent, formatTraceparent, newSpanId, startSpan, withSpan, currentTraceparent, configureTracing, InMemorySpanExporter,
  BatchSpanProcessor, OtlpHttpJsonExporter, parseOtlpHeaders, tracingConfigFromEnv, toOtlpJson, spansDropped, runEventConsumer, type SpanData,
} from './index';
import { RequestContextMiddleware } from '../request-telemetry';
import { attachDbTelemetry } from '../db-telemetry';
import { instrumentedFetch, resetProviderHealth } from '../provider-telemetry';
import { runJob } from '../job-telemetry';
import { getContext } from '../request-context';
import { setLogSink } from '../logger';

const dropped = (reason: string): number => Number(spansDropped.snapshot().find((x) => x.labels.reason === reason)?.value ?? 0);
const TID = '4bf92f3577b34da6a3ce929d0e0e4736', SID = '00f067aa0ba902b7';
const INCOMING = `00-${TID}-${SID}-01`;

describe('W3C traceparent', () => {
  it('round-trips: format(parse(x)) === x, and parse(format(c)) === c', () => {
    expect(formatTraceparent(parseTraceparent(INCOMING)!)).toBe(INCOMING);
    const c = { traceId: 'a'.repeat(32), spanId: newSpanId(), sampled: false };
    expect(parseTraceparent(formatTraceparent(c))).toEqual(c);
    expect(parseTraceparent(`00-${TID}-${SID}-00`)?.sampled).toBe(false);
  });
  it('refuses malformed input — never adopts a trace it cannot read', () => {
    for (const bad of [
      undefined, '', 'garbage', `00-${'0'.repeat(32)}-${SID}-01`, `00-${TID}-${'0'.repeat(16)}-01`, `ff-${TID}-${SID}-01`,
      `00-${TID.toUpperCase()}-${SID}-01`, `00-${TID}-${SID}-01-extra`, `00-${TID.slice(1)}-${SID}-01`, `0-${TID}-${SID}-01`, 'x'.repeat(600),
    ]) expect(parseTraceparent(bad as any)).toBeUndefined();
  });
  it('a future version with extra fields is read by its first four (W3C §3.3)', () => {
    expect(parseTraceparent(`01-${TID}-${SID}-01-what-ever`)).toEqual({ traceId: TID, spanId: SID, sampled: true });
  });
  it('span ids are 16 lowercase hex, never all zeros', () => { for (let i = 0; i < 50; i++) expect(newSpanId()).toMatch(/^(?!0{16})[0-9a-f]{16}$/); });
});

describe('spans', () => {
  let mem: InMemorySpanExporter;
  beforeEach(() => { mem = new InMemorySpanExporter(); configureTracing({ exporter: mem, sampleRatio: 1 }); });
  afterEach(() => configureTracing(null));

  it('withSpan nests: the child shares the trace and names its parent', async () => {
    await withSpan('outer', {}, async (outer) => {
      await withSpan('inner', {}, async () => { expect(currentTraceparent()).toContain(outer.traceId); });
    });
    const [inner, outer] = mem.spans;
    expect(inner.name).toBe('inner'); expect(outer.name).toBe('outer');
    expect(inner.traceId).toBe(outer.traceId); expect(inner.parentSpanId).toBe(outer.spanId); expect(outer.parentSpanId).toBeUndefined();
  });
  it('a thrown error marks the span ERROR and is rethrown', async () => {
    await expect(withSpan('boom', {}, async () => { throw new TypeError('x'); })).rejects.toThrow('x');
    expect(mem.spans[0].status).toEqual({ code: 'error', message: 'TypeError' });
  });
  it('nothing is recorded when tracing is off (no endpoint), but ids are still minted for propagation', () => {
    configureTracing({ sampleRatio: 1 });   // no exporter = off
    const s = startSpan('x'); s.end();
    expect(s.traceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    expect(mem.spans).toHaveLength(0);
  });
  it('ratio 0 samples nothing; a sampled parent still wins (parent-based)', () => {
    configureTracing({ exporter: mem, sampleRatio: 0 });
    startSpan('root').end();
    startSpan('child', { parent: parseTraceparent(INCOMING)! }).end();
    expect(mem.spans.map((s) => s.name)).toEqual(['child']);
  });
});

describe('one request = one trace: HTTP → DB → provider → job', () => {
  let mem: InMemorySpanExporter;
  beforeEach(() => { mem = new InMemorySpanExporter(); configureTracing({ exporter: mem, sampleRatio: 1 }); resetProviderHealth(); setLogSink(() => undefined); });
  afterEach(() => { configureTracing(null); setLogSink(null as any); });

  it('every span carries the incoming trace id; the provider gets it in traceparent; the job continues it', async () => {
    const req: any = { method: 'POST', path: '/appointments', baseUrl: '', headers: { traceparent: INCOMING } };
    const res: any = Object.assign(new EventEmitter(), { headers: {} as Record<string, string>, statusCode: 201, setHeader(k: string, v: string) { this.headers[k] = v; } });
    const pool: any = { connect: async () => ({ query: async () => ({ rows: [{ a: 1 }] }) }) };
    attachDbTelemetry(pool, 10);
    let sentHeaders: any; let enqueued: string | undefined;
    const fetchImpl = async (_u: string, init: any) => { sentHeaders = init.headers; return { status: 200 }; };

    await new Promise<void>((done) => new RequestContextMiddleware().use(req, res, async () => {
      getContext()!.tenantId = 'tenant-1';
      const c = await pool.connect();
      await c.query('select * from "customers" where "tenant_id" = $1 and "phone" = $2', ['t', '+18565550100']);
      await instrumentedFetch('twilio', fetchImpl)('https://api.twilio.com/2010-04-01/Accounts/AC0123456789abcdef0123456789abcdef/Messages.json', { method: 'POST', headers: { authorization: 'Basic x' } });
      enqueued = currentTraceparent();   // what enqueueJob / the outbox writer store
      req.route = { path: '/appointments' };
      res.emit('finish');
      done();
    }));
    await runJob({ jobType: 'sms.send', jobClass: 'standard', traceparent: enqueued }, async () => {
      const c = await pool.connect(); await c.query('update "jobs" set "status" = $1', ['x']);
    });

    const byName = (n: string) => mem.spans.find((s) => s.name.startsWith(n))!;
    const server = byName('POST /appointments'), db = byName('db select customers'), client = byName('twilio'), job = byName('job sms.send'), jobDb = byName('db update jobs');
    for (const s of [server, db, client, job, jobDb]) expect(s?.traceId).toBe(TID);
    expect(server.kind).toBe('server'); expect(server.parentSpanId).toBe(SID);
    expect(server.attributes).toMatchObject({ 'http.route': '/appointments', 'http.response.status_code': 201, 'aipowersalon.tenant_id': 'tenant-1' });
    expect(db.parentSpanId).toBe(server.spanId); expect(client.parentSpanId).toBe(server.spanId);
    expect(job.parentSpanId).toBe(server.spanId); expect(job.links).toEqual([{ traceId: TID, spanId: server.spanId }]);
    expect(jobDb.parentSpanId).toBe(job.spanId);
    // statement SHAPE only — never a value
    expect(db.attributes['db.statement']).toBe('select * from "customers" where "tenant_id" = $? and "phone" = $?');
    expect(JSON.stringify(mem.spans)).not.toContain('+18565550100');
    // the provider sees the trace, and the caller's own headers are kept
    expect(sentHeaders.traceparent).toBe(`00-${TID}-${client.spanId}-01`); expect(sentHeaders.authorization).toBe('Basic x');
    // the client sees it too
    expect(res.headers.traceparent).toBe(`00-${TID}-${server.spanId}-01`);
  });

  it('without an incoming traceparent a request starts its own trace and still answers one', async () => {
    const req: any = { method: 'GET', path: '/x', headers: {} };
    const res: any = Object.assign(new EventEmitter(), { headers: {} as any, statusCode: 200, setHeader(k: string, v: string) { this.headers[k] = v; } });
    let traceId = '';
    new RequestContextMiddleware().use(req, res, () => { traceId = getContext()!.traceId; });
    res.emit('finish'); res.emit('close');   // ended once
    expect(parseTraceparent(res.headers.traceparent)?.traceId).toBe(traceId);
    expect(mem.spans.filter((s) => s.kind === 'server')).toHaveLength(1);
    expect(mem.spans[0].parentSpanId).toBeUndefined();
  });

  it('an outbox consumer continues the trace of the request that wrote the event', async () => {
    await runEventConsumer({ consumerName: 'realtime.projection', eventId: 'e1', eventType: 'appointment.created', correlationId: 'c1', tenantId: 't1', traceparent: INCOMING }, async () => {
      expect(getContext()?.traceId).toBe(TID); expect(getContext()?.correlationId).toBe('c1');
    });
    expect(mem.spans[0]).toMatchObject({ traceId: TID, parentSpanId: SID, kind: 'consumer', name: 'consume appointment.created' });
  });
});

describe('the OTLP/HTTP JSON exporter', () => {
  const span = (i: number): SpanData => ({ traceId: TID, spanId: newSpanId(), name: `s${i}`, kind: 'internal', startMs: 1_700_000_000_000.5, endMs: 1_700_000_000_010.25, attributes: { n: i, ok: true, s: 'v' }, status: { code: 'unset' } });

  it('posts batches to <endpoint>/v1/traces with the configured headers, in OTLP JSON', async () => {
    const posts: Array<{ url: string; init: any }> = [];
    const exp = new OtlpHttpJsonExporter({ endpoint: 'http://collector:4318/', headers: parseOtlpHeaders('x-api-key=abc%3D,  other = 2 '), serviceName: 'aipowersalon-api', fetchImpl: async (url: string, init: any) => { posts.push({ url, init }); return { ok: true, status: 200 }; } });
    const p = new BatchSpanProcessor(exp, { maxBatch: 2, maxQueue: 100, delayMs: 60_000 });
    for (let i = 0; i < 5; i++) p.onEnd(span(i));
    await p.flush();
    expect(posts.map((x) => x.url)).toEqual(Array(3).fill('http://collector:4318/v1/traces'));
    expect(posts[0].init.headers).toMatchObject({ 'content-type': 'application/json', 'x-api-key': 'abc=', other: '2' });
    const body = JSON.parse(posts[0].init.body);
    const rs = body.resourceSpans[0];
    expect(rs.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'aipowersalon-api' } });
    const s = rs.scopeSpans[0].spans[0];
    expect(s).toMatchObject({ traceId: TID, name: 's0', kind: 1, startTimeUnixNano: '1700000000000500000', endTimeUnixNano: '1700000000010250000', status: { code: 0 } });
    expect(s.attributes).toContainEqual({ key: 'n', value: { intValue: '0' } });
    expect(s.attributes).toContainEqual({ key: 'ok', value: { boolValue: true } });
    expect(rs.scopeSpans[0].spans.length + JSON.parse(posts[1].init.body).resourceSpans[0].scopeSpans[0].spans.length).toBe(4);
    await p.shutdown();
  });

  it('a dead endpoint never throws into the caller; the lost spans are counted', async () => {
    const before = dropped('export_failed');
    const exp = new OtlpHttpJsonExporter({ endpoint: 'http://127.0.0.1:1', serviceName: 'x', fetchImpl: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); } });
    const p = new BatchSpanProcessor(exp, { maxBatch: 10, maxQueue: 100, delayMs: 60_000 });
    for (let i = 0; i < 3; i++) p.onEnd(span(i));
    await expect(p.flush()).resolves.toBeUndefined();
    const non2xx = new BatchSpanProcessor(new OtlpHttpJsonExporter({ endpoint: 'http://c', serviceName: 'x', fetchImpl: async () => ({ ok: false, status: 503 }) }), { maxBatch: 10, maxQueue: 100, delayMs: 60_000 });
    non2xx.onEnd(span(9)); await non2xx.flush();
    expect(dropped('export_failed') - before).toBe(4);
    await p.shutdown(); await non2xx.shutdown();
  });

  it('the queue is bounded: the OLDEST spans are dropped and counted', async () => {
    const before = dropped('queue_full');
    const mem = new InMemorySpanExporter();
    const p = new BatchSpanProcessor(mem, { maxBatch: 100, maxQueue: 3, delayMs: 60_000 });
    for (let i = 0; i < 5; i++) p.onEnd(span(i));
    await p.flush();
    expect(mem.spans.map((s) => s.name)).toEqual(['s2', 's3', 's4']);
    expect(dropped('queue_full') - before).toBe(2);
  });

  it('shutdown flushes what is queued', async () => {
    const mem = new InMemorySpanExporter();
    const p = new BatchSpanProcessor(mem, { maxBatch: 100, maxQueue: 100, delayMs: 60_000 });
    p.onEnd(span(1)); await p.shutdown();
    expect(mem.spans).toHaveLength(1);
  });

  it('configuration comes from the reserved OTEL_* names; no endpoint = off', () => {
    expect(tracingConfigFromEnv({}).enabled).toBe(false);
    const c = tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_TRACES_SAMPLER_ARG: '0.25', PROCESS_ROLE: 'worker' });
    expect(c).toMatchObject({ enabled: true, sampleRatio: 0.25, serviceName: 'aipowersalon-worker', endpoint: 'http://c:4318' });
    expect(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c', OTEL_TRACES_SAMPLER_ARG: 'nope', OTEL_SERVICE_NAME: 'svc' })).toMatchObject({ sampleRatio: 1, serviceName: 'svc' });
    expect(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c', OTEL_TRACES_SAMPLER_ARG: '7' }).sampleRatio).toBe(1);
    expect(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c' }).serviceName).toBe('aipowersalon-all');
  });

  it('toOtlpJson maps kinds and error status', () => {
    const j = toOtlpJson([{ ...span(1), kind: 'server', status: { code: 'error', message: 'E' }, parentSpanId: SID, links: [{ traceId: TID, spanId: SID }] }], { serviceName: 's' });
    const s = j.resourceSpans[0].scopeSpans[0].spans[0];
    expect(s).toMatchObject({ kind: 2, parentSpanId: SID, status: { code: 2, message: 'E' }, links: [{ traceId: TID, spanId: SID }] });
  });
});
