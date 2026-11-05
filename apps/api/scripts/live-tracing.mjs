#!/usr/bin/env node
// live-tracing.mjs — BUILD_PLAN Phase 11 (Constitution 4 §101, Constitution 11 §16–19 / §188), proved on the real API
// process and PostgreSQL:
//
//   1. the API exports spans over OTLP/HTTP JSON to OTEL_EXPORTER_OTLP_ENDPOINT — this script starts a tiny local
//      collector, points the API at it, and reads what arrives (with the OTEL_EXPORTER_OTLP_HEADERS header);
//   2. a request carrying a known W3C `traceparent` produces a SERVER span that is a child of the caller's span, and the
//      database query it runs is a DB span of the SAME trace under it — statement shape only, no values;
//   3. the response answers `traceparent` with that trace id;
//   4. GET /metrics is Prometheus text with the bearer token, 401 without it (and with a wrong one).
//
// Run:  DATABASE_URL=postgres://… node scripts/live-tracing.mjs   (apps/api built; any migrated database — it reads
// /health/ready, writes nothing). Never point it at production. It stops the API it started (by PID) and its collector.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.LIVE_TRACING_PORT || 3061), API = `http://127.0.0.1:${PORT}`;
const TOKEN = randomBytes(24).toString('hex');
const COLLECTOR_KEY = randomBytes(8).toString('hex');
const TRACE_ID = randomBytes(16).toString('hex'), CALLER_SPAN = randomBytes(8).toString('hex');
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the collector ─────────────────────────────────────────────────────────────────────────────────────────────────
const received = []; const posts = [];
const collector = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    posts.push({ url: req.url, method: req.method, key: req.headers['x-collector-key'], type: req.headers['content-type'] });
    try {
      const j = JSON.parse(body);
      for (const rs of j.resourceSpans ?? []) {
        const service = (rs.resource?.attributes ?? []).find((a) => a.key === 'service.name')?.value?.stringValue;
        for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans ?? []) received.push({ ...s, service, attrs: Object.fromEntries((s.attributes ?? []).map((a) => [a.key, Object.values(a.value ?? {})[0]])) });
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } catch { res.writeHead(400).end(); }
  });
});
await new Promise((r) => collector.listen(0, '127.0.0.1', r));
const COLLECTOR = `http://127.0.0.1:${collector.address().port}`;

const env = {
  ...process.env, PORT: String(PORT), NODE_ENV: 'development', REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-tracing-session-secret-0123456789abcdef',
  OTEL_EXPORTER_OTLP_ENDPOINT: COLLECTOR, OTEL_EXPORTER_OTLP_HEADERS: `x-collector-key=${COLLECTOR_KEY}`, OTEL_TRACES_SAMPLER_ARG: '1',
  METRICS_TOKEN: TOKEN, JOBS_WORKER: 'off',
};
for (const k of ['OTEL_SERVICE_NAME', 'PROCESS_ROLE', 'WORKER_JOB_CLASSES', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) delete env[k];

let api = null; let apiErr = '';
const stop = async () => {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');   // by the PID this script started — never a pattern
    for (let i = 0; i < 40 && api.exitCode === null; i++) await sleep(250);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  await new Promise((r) => collector.close(r));
};
const timer = setTimeout(async () => { console.error('timed out'); await stop().catch(() => undefined); process.exit(1); }, 3 * 60_000);

try {
  api = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  api.stderr.on('data', (c) => { apiErr += c; });
  let booted = false;
  for (let i = 0; i < 200 && !booted; i++) { try { booted = (await fetch(API + '/health/ready')).ok; } catch { /* booting */ } if (!booted) await sleep(250); }
  if (!check('the API booted with OTEL_EXPORTER_OTLP_ENDPOINT pointing at a local collector', booted, booted ? COLLECTOR : apiErr.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');

  // ── 2/3: a request with a known traceparent ──────────────────────────────────────────────────────────────────────
  const incoming = `00-${TRACE_ID}-${CALLER_SPAN}-01`;
  const r = await fetch(API + '/health/ready', { headers: { traceparent: incoming } });
  const answered = r.headers.get('traceparent') ?? '';
  check('GET /health/ready with traceparent answers 200', r.status === 200, `status ${r.status}`);
  check('the response carries traceparent with the SAME trace id (and its own span id)', new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`).test(answered) && !answered.includes(CALLER_SPAN), answered);

  let server, dbSpan;
  for (let i = 0; i < 60 && !(server && dbSpan); i++) {
    await sleep(250);
    server = received.find((s) => s.traceId === TRACE_ID && s.kind === 2);
    dbSpan = server && received.find((s) => s.traceId === TRACE_ID && s.name.startsWith('db ') && s.parentSpanId === server.spanId);
  }
  check('the collector received OTLP/HTTP JSON at /v1/traces with the configured header', posts.length > 0 && posts.every((p) => p.url === '/v1/traces' && p.method === 'POST' && p.type === 'application/json' && p.key === COLLECTOR_KEY), `${posts.length} post(s)`);
  check('a SERVER span of the trace, child of the caller span, named by the route template', !!server && server.parentSpanId === CALLER_SPAN && server.name === 'GET /health/ready' && server.attrs['http.route'] === '/health/ready' && Number(server.attrs['http.response.status_code']) === 200,
    server ? `${server.name} span=${server.spanId} parent=${server.parentSpanId}` : 'none');
  check('the span id the client got back IS the server span', !!server && answered.split('-')[2] === server.spanId);
  check('a DB span of the SAME trace under the server span (statement shape, postgresql)', !!dbSpan && dbSpan.attrs['db.system'] === 'postgresql' && typeof dbSpan.attrs['db.statement'] === 'string' && dbSpan.kind === 3,
    dbSpan ? `${dbSpan.name}: ${dbSpan.attrs['db.statement']}` : `${received.filter((s) => s.traceId === TRACE_ID).map((s) => s.name).join(', ') || 'no spans of the trace'}`);
  check('service.name defaults to aipowersalon-<PROCESS_ROLE> (all)', server?.service === 'aipowersalon-all', server?.service);
  check('span timestamps are nanosecond strings, end ≥ start', !!server && /^\d{19}$/.test(server.startTimeUnixNano) && BigInt(server.endTimeUnixNano) >= BigInt(server.startTimeUnixNano));

  // ── 4: /metrics ───────────────────────────────────────────────────────────────────────────────────────────────────
  const none = await fetch(API + '/metrics');
  check('GET /metrics without the token → 401 with WWW-Authenticate', none.status === 401 && /Bearer/.test(none.headers.get('www-authenticate') ?? ''), `status ${none.status}`);
  const wrong = await fetch(API + '/metrics', { headers: { authorization: 'Bearer not-the-token' } });
  check('GET /metrics with a wrong token → 401', wrong.status === 401, `status ${wrong.status}`);
  const ok = await fetch(API + '/metrics', { headers: { authorization: `Bearer ${TOKEN}` } });
  const text = await ok.text();
  check('GET /metrics with the token → 200 Prometheus text', ok.status === 200 && ok.headers.get('content-type') === 'text/plain; version=0.0.4; charset=utf-8' && text.includes('# TYPE aipowersalon_db_queries_total counter'), `status ${ok.status}, ${text.split('\n').length} lines`);
  check('the exporter reports itself: aipowersalon_trace_spans_exported_total > 0', /^aipowersalon_trace_spans_exported_total \d+/m.test(text) && Number(/^aipowersalon_trace_spans_exported_total (\d+)/m.exec(text)?.[1]) > 0, /^aipowersalon_trace_spans_exported_total.*$/m.exec(text)?.[0]);
  check('/metrics is served without a session (no 401 "No session" from the middleware)', ok.status !== 401);
  const leaked = received.some((s) => JSON.stringify(s.attrs).includes(TOKEN));
  check('no span attribute carries the metrics token or a header value', !leaked);
} catch (e) {
  check('run completed', false, String(e?.message ?? e));
} finally {
  await stop();
  check('the API it started (by PID) and the collector are stopped', !!api && (api.exitCode !== null || api.signalCode !== null), `exit ${api?.exitCode ?? api?.signalCode}`);
  clearTimeout(timer);
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed — ${received.length} spans received in ${posts.length} OTLP post(s)`);
  process.exit(failed ? 1 : 0);
}
