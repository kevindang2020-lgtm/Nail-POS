// telemetry-store.pgtest — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292, D7) against the real schema (migration 561):
//   • the sink → writer path: a seeded secret, phone number, email and card number NEVER reach a column (checked with SQL
//     over every text and jsonb column, not by trusting the converter);
//   • request search by request id / correlation id / trace id / tenant / route / status / time range;
//   • the trace view: the span tree (depth, parent links, offsets) with its log lines joined by span id;
//   • the correlation view: requests, jobs and events of one chain, its traces and provider calls;
//   • §181: without super_admin.telemetry.sensitive.view the rows are redacted (tenant ids, routes with ids, error
//     messages, non-whitelisted fields);
//   • retention: rows older than the window go, in batches; younger stay.
// One fixed clock (NOW) for every row and every query — nothing depends on today's date.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TelemetrySink, type LogRecord } from '@aipowersalon/observability';
import { TelemetrySearchService, TelemetryStoreRetention, writeTelemetryBatch } from './telemetry-store';

let pg: any; let db: any; let svc: TelemetrySearchService;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); svc = new TelemetrySearchService(db); });
beforeEach(async () => { await pg.exec('DELETE FROM telemetry_log_events; DELETE FROM telemetry_spans;'); });

const NOW = new Date('2026-09-30T12:00:00Z');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const T_A = '0a0a0a0a-1111-4222-8333-444444444444', T_B = '0b0b0b0b-1111-4222-8333-444444444444';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736', TRACE2 = '5bf92f3577b34da6a3ce929d0e0e4737';
const S_ROOT = '00f067aa0ba902b7', S_DB = '00f067aa0ba902b8', S_PROV = '00f067aa0ba902b9', S_JOB = '00f067aa0ba902c0';
const CORR = 'corr_checkout_0001';

const SECRET = 'sk_live_51Hx9ExampleSecretValue0001', PHONE = '(856) 555-0142', EMAIL = 'jane.customer@example.com', CARD = '4111 1111 1111 1111';

async function seed() {
  const log = (o: Record<string, unknown>) => ({ ts: at(60_000), level: 'info', service: 'aipowersalon-api', process_role: 'api', request_id: null, correlation_id: null, trace_id: null, span_id: null, tenant_id: null, route: null, status: null, duration_ms: null, msg: 'x', fields: {}, ...o });
  const spanRow = (o: Record<string, unknown>) => ({ trace_id: TRACE, span_id: S_ROOT, parent_span_id: null, name: 'span', kind: 'internal', service: 'aipowersalon-api', start_ts: at(60_000), duration_ms: 1, status: 'unset', status_message: null, attributes: {}, tenant_id: null, ...o });
  await writeTelemetryBatch(db, {
    logs: [
      log({ ts: at(60_000), request_id: 'req_A', correlation_id: CORR, trace_id: TRACE, span_id: S_ROOT, tenant_id: T_A, msg: 'checkout.pay_requested', fields: { method: 'POST', ticketId: 'tk_1' } }),
      log({ ts: at(59_990), level: 'error', request_id: 'req_A', correlation_id: CORR, trace_id: TRACE, span_id: S_DB, tenant_id: T_A, route: '/checkout/:id/pay', status: 500, msg: 'request.failed', fields: { exception: { name: 'Error', message: 'duplicate key value violates unique constraint "payments_pkey"' }, fingerprint: 'abc123', method: 'POST' } }),
      log({ ts: at(59_980), request_id: 'req_A', correlation_id: CORR, trace_id: TRACE, span_id: S_ROOT, tenant_id: T_A, route: '/checkout/:id/pay', status: 500, duration_ms: 230, msg: 'request.completed', fields: { method: 'POST', route: '/checkout/:id/pay', status: 500 } }),
      log({ ts: at(50_000), request_id: 'job_77', correlation_id: CORR, trace_id: TRACE, span_id: S_JOB, tenant_id: T_A, msg: 'job.completed', fields: { jobType: 'receipt.send' } }),
      log({ ts: at(49_000), request_id: 'evt_9', correlation_id: CORR, trace_id: TRACE, tenant_id: T_A, msg: 'consumer.done' }),
      log({ ts: at(30_000), request_id: 'req_B', correlation_id: 'req_B', trace_id: TRACE2, tenant_id: T_B, route: '/appointments/3f2a9c1e-1111-4222-8333-444444444444', status: 200, duration_ms: 12, msg: 'request.completed' }),
      log({ ts: at(20 * 86_400_000), request_id: 'req_OLD', correlation_id: 'req_OLD', tenant_id: T_B, route: '/old', status: 200, msg: 'request.completed' }),
    ],
    spans: [
      spanRow({ span_id: S_ROOT, name: 'POST /checkout/:id/pay', kind: 'server', start_ts: at(60_000), duration_ms: 230, status: 'error', attributes: { 'http.route': '/checkout/:id/pay', 'http.response.status_code': 500, 'aipowersalon.tenant_id': T_A }, tenant_id: T_A }),
      spanRow({ span_id: S_DB, parent_span_id: S_ROOT, name: 'db insert payments', kind: 'client', start_ts: at(59_995), duration_ms: 4, status: 'error', status_message: 'DatabaseError', attributes: { 'db.operation': 'insert', 'db.sql.table': 'payments' } }),
      spanRow({ span_id: S_PROV, parent_span_id: S_ROOT, name: 'stripe payment_intents.create', kind: 'client', start_ts: at(59_999), duration_ms: 120, attributes: { 'peer.service': 'stripe' } }),
      spanRow({ span_id: S_JOB, parent_span_id: S_ROOT, name: 'job receipt.send', kind: 'consumer', start_ts: at(50_000), duration_ms: 30 }),
    ],
  });
}

describe('sink → database: nothing unredacted lands', () => {
  it('a seeded secret, phone number, email and card number in a message, fields and a span never reach any column', async () => {
    const sink = new TelemetrySink({ writer: (b) => writeTelemetryBatch(db, b), logSample: 1, traceSample: 1, flushMs: 60_000 });
    const rec: LogRecord = { timestamp: at(1_000), level: 'error', service: 'aipowersalon-api', environment: 'test', requestId: 'req_LEAK', tenantId: T_A,
      msg: `payment failed for ${EMAIL} ${PHONE} card ${CARD} key ${SECRET}`,
      customer: { phone: PHONE, email: EMAIL, note: `call ${PHONE}, mail ${EMAIL}, card ${CARD}` }, apiKey: SECRET, detail: `secret=${SECRET}`, body: { card: CARD } } as any;
    sink.offerLog(rec, undefined);
    sink.offerSpan({ traceId: TRACE, spanId: S_ROOT, name: `lookup ${EMAIL}`, kind: 'client', startMs: Date.parse(at(1_000)), endMs: Date.parse(at(990)),
      attributes: { 'db.statement': `where phone='${PHONE}' and email='${EMAIL}'`, token: SECRET, note: `card ${CARD}` }, status: { code: 'error', message: `for ${EMAIL}` } });
    await sink.flush();
    const logs = (await pg.query(`SELECT row_to_json(t)::text AS j FROM telemetry_log_events t`)).rows.map((r: any) => r.j).join('\n');
    const spans = (await pg.query(`SELECT row_to_json(t)::text AS j FROM telemetry_spans t`)).rows.map((r: any) => r.j).join('\n');
    expect(logs).toContain('req_LEAK');
    expect(spans).toContain(TRACE);
    for (const leak of [EMAIL, PHONE, '555-0142', '8565550142', CARD, '4111111111111111', SECRET]) {
      expect(logs, `log row leaked ${leak}`).not.toContain(leak);
      expect(spans, `span row leaked ${leak}`).not.toContain(leak);
    }
  });
});

describe('§291 request search', () => {
  beforeEach(seed);
  const full = { sensitive: true, now: NOW };
  it('by request id: one summary with the worst level, the final status and duration, and every line', async () => {
    const r = await svc.requests({ requestId: 'req_A' }, full);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ requestId: 'req_A', kind: 'request', correlationId: CORR, traceId: TRACE, tenantId: T_A, route: '/checkout/:id/pay', status: 500, durationMs: 230, lines: 3, maxLevel: 'error' });
    const d = await svc.request('req_A', full);
    expect(d.logs.map((l) => l.msg)).toEqual(['checkout.pay_requested', 'request.failed', 'request.completed']);
    expect(d.traceIds).toEqual([TRACE]);
  });
  it('by correlation id, by trace id, by tenant, by route, by status class, by time range', async () => {
    const ids = async (f: any) => (await svc.requests(f, full)).items.map((x) => x.requestId).sort();
    expect(await ids({ correlationId: CORR })).toEqual(['evt_9', 'job_77', 'req_A']);
    expect(await ids({ traceId: TRACE2 })).toEqual(['req_B']);
    expect(await ids({ tenantId: T_B })).toEqual(['req_B']);
    expect(await ids({ route: '/checkout' })).toEqual(['req_A']);
    expect(await ids({ status: '5xx' })).toEqual(['req_A']);
    expect(await ids({ status: '200' })).toEqual(['req_B']);
    expect(await ids({ level: 'error' })).toEqual(['req_A']);
    // default window: the last 24 h — the 20-day-old request is not in it; an explicit range finds it
    expect(await ids({})).not.toContain('req_OLD');
    expect(await ids({ from: at(21 * 86_400_000), to: at(19 * 86_400_000) })).toEqual(['req_OLD']);
  });
  it('an unknown request id answers an empty detail, not an error', async () => {
    const d = await svc.request('req_NOPE', full);
    expect(d.summary).toBeNull();
    expect(d.logs).toEqual([]);
  });
});

describe('trace ↔ log linking', () => {
  beforeEach(seed);
  it('the span tree: root first, children by start time with depth and offsets; each span carries its own log lines', async () => {
    const t = await svc.trace(TRACE, { sensitive: true });
    expect(t.spans.map((s) => [s.name, s.depth])).toEqual([
      ['POST /checkout/:id/pay', 0], ['stripe payment_intents.create', 1], ['db insert payments', 1], ['job receipt.send', 1],
    ]);
    expect(t.spans.map((s) => s.offsetMs).slice(0, 3)).toEqual([0, 1, 5]);
    expect(t.spans[0].logs.map((l) => l.msg)).toEqual(['checkout.pay_requested', 'request.completed']);
    expect(t.spans[2].logs.map((l) => l.msg)).toEqual(['request.failed']);
    expect(t.spans[3].logs.map((l) => l.msg)).toEqual(['job.completed']);
    expect(t.unattachedLogs.map((l) => l.msg)).toEqual(['consumer.done']);
    expect(t.durationMs).toBeGreaterThanOrEqual(10_000);
  });
  it('a span whose parent is not in the store is shown as a root, never dropped', async () => {
    await writeTelemetryBatch(db, { logs: [], spans: [{ trace_id: TRACE2, span_id: 'aaaaaaaaaaaaaaaa', parent_span_id: 'bbbbbbbbbbbbbbbb', name: 'orphan', kind: 'internal', service: 's', start_ts: at(1000), duration_ms: 1, status: 'unset', status_message: null, attributes: {}, tenant_id: null }] });
    const t = await svc.trace(TRACE2, { sensitive: true });
    expect(t.spans.map((s) => [s.name, s.depth])).toEqual([['orphan', 0]]);
  });
});

describe('§292 correlation diagnostics', () => {
  beforeEach(seed);
  it('requests, jobs and events of one chain, its traces and its provider calls (never the DB spans)', async () => {
    const c = await svc.correlation(CORR, { sensitive: true });
    expect(c.requests.map((x) => x.requestId)).toEqual(['req_A']);
    expect(c.jobs.map((x) => x.requestId)).toEqual(['job_77']);
    expect(c.events.map((x) => x.requestId)).toEqual(['evt_9']);
    expect(c.traceIds).toEqual([TRACE]);
    expect(c.providerCalls.map((p) => p.name)).toEqual(['stripe payment_intents.create']);
    expect(c.logs).toHaveLength(5);
  });
});

describe('§181 field-level telemetry permissions', () => {
  beforeEach(seed);
  it('without the sensitive key: tenant ids null, routes with ids collapsed, error messages and non-whitelisted fields removed', async () => {
    const r = await svc.requests({}, { sensitive: false, now: NOW });
    expect(r.redacted).toBe(true);
    expect(r.items.every((x) => x.tenantId === null)).toBe(true);
    expect(r.items.find((x) => x.requestId === 'req_B')!.route).toBe('/appointments/:id');
    const d = await svc.request('req_A', { sensitive: false });
    const failed = d.logs.find((l) => l.msg === 'request.failed')!;
    expect(JSON.stringify(failed)).not.toContain('duplicate key');
    expect(failed.fields).toEqual({ fingerprint: 'abc123', method: 'POST' });
    const started = d.logs.find((l) => l.msg === 'checkout.pay_requested')!;
    expect(started.fields).toEqual({ method: 'POST' });   // ticketId is not on the safe list
    const t = await svc.trace(TRACE, { sensitive: false });
    expect(JSON.stringify(t)).not.toContain(T_A);
    expect(t.spans.find((s) => s.name === 'db insert payments')!.statusMessage).toBeNull();
  });
  it('with the sensitive key: the stored rows as they are', async () => {
    const d = await svc.request('req_A', { sensitive: true });
    expect(d.redacted).toBe(false);
    expect(JSON.stringify(d)).toContain('duplicate key');
    expect(d.logs[0].tenantId).toBe(T_A);
  });
  it('a message that is not an event name is hidden from the non-sensitive view', async () => {
    await writeTelemetryBatch(db, { logs: [{ ts: at(1000), level: 'warn', service: 's', process_role: 'api', request_id: 'req_C', correlation_id: null, trace_id: null, span_id: null, tenant_id: null, route: null, status: null, duration_ms: null, msg: 'could not reach tenant 0a0a0a0a printer at 10.0.0.4', fields: {} }], spans: [] });
    const r = await svc.logs({ requestId: 'req_C' }, { sensitive: false, now: NOW });
    expect(r.items[0].msg).toBe('[message hidden]');
  });
});

describe('logs search', () => {
  beforeEach(seed);
  it('filters by level, trace and text, newest first', async () => {
    const r = await svc.logs({ traceId: TRACE, level: 'error' }, { sensitive: true, now: NOW });
    expect(r.items.map((l) => l.msg)).toEqual(['request.failed']);
    const q = await svc.logs({ q: 'checkout.' }, { sensitive: true, now: NOW });
    expect(q.items.map((l) => l.msg)).toEqual(['checkout.pay_requested']);
  });
});

describe('retention — the store does not grow without bound', () => {
  it('rows older than the window go (logs and spans), younger stay, across batches', async () => {
    const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString(), young = new Date(NOW.getTime() - 13 * 86_400_000).toISOString();
    await pg.exec(`INSERT INTO telemetry_log_events (ts, level, service, msg) SELECT timestamptz '${old}' + (g || ' seconds')::interval, 'info', 's', 'old' FROM generate_series(1, 2505) g`);
    await pg.exec(`INSERT INTO telemetry_log_events (ts, level, service, msg) VALUES ('${young}', 'info', 's', 'young')`);
    await pg.exec(`INSERT INTO telemetry_spans (trace_id, span_id, name, kind, service, start_ts, duration_ms, status) VALUES
      ('${TRACE}', '${S_ROOT}', 'old', 'server', 's', '${old}', 1, 'unset'), ('${TRACE}', '${S_DB}', 'young', 'server', 's', '${young}', 1, 'unset')`);
    const r = await new TelemetryStoreRetention(db).configure({ batch: 1000, retentionDays: 14 }).run(NOW);
    expect(r).toEqual({ telemetry_log_events: 2505, telemetry_spans: 1 });
    expect((await pg.query(`SELECT msg FROM telemetry_log_events`)).rows.map((x: any) => x.msg)).toEqual(['young']);
    expect((await pg.query(`SELECT name FROM telemetry_spans`)).rows.map((x: any) => x.name)).toEqual(['young']);
  });
});
