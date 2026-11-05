#!/usr/bin/env node
// live-phase14-telemetry.mjs — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292, trace ↔ log linking, D7), proved on the
// real API, a SEPARATE worker process and PostgreSQL. Nothing is stubbed:
//   1. the API (PROCESS_ROLE=api) and the worker (dist/worker.js, PROCESS_ROLE=worker) boot with the telemetry store on
//      (TELEMETRY_TRACE_SAMPLE=1 so the proof's traces are kept; INFO lines at the default 0.1 — the proof's lines are kept
//      because their trace is, the error line because WARN+ always is);
//   2. a Super Admin makes requests sharing one x-correlation-id: an async export (202 → a job the WORKER runs), an error
//      (400), and a failed sign-in carrying an email address and a secret-looking password;
//   3. Request search finds the export by its request id AND by the correlation id (the request + the worker's job); the
//      request detail lists its lines; its trace shows the server span, DB spans and the worker's job span (another
//      process), with the log lines linked to their spans;
//   4. the error request is found by request id with status 400 / level warn;
//   5. a PLATFORM_SUPPORT user (super_admin.telemetry.view, NOT .sensitive.view) gets the same rows REDACTED (no error
//      messages, no non-whitelisted fields) and is refused (403) a tenant filter;
//   6. nothing unredacted landed: no stored row contains the email or the password the proof sent;
//   7. cleanup: both processes stopped by PID; the proof's users, sessions, operation, job and telemetry rows removed.
// Run:  DATABASE_URL=postgres://… node scripts/live-phase14-telemetry.mjs   (apps/api built, migrations applied incl. 561).
// Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const R = {
  login: '/auth/login', export: '/super-admin/settlements/export',
  requests: '/super-admin/observability/requests', request: (id) => `/super-admin/observability/requests/${encodeURIComponent(id)}`,
  trace: (id) => `/super-admin/observability/traces/${id}`, correlation: (id) => `/super-admin/observability/correlations/${encodeURIComponent(id)}`,
  logs: '/super-admin/observability/logs',
};
const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.LIVE_P14_PORT || 3064), API = `http://127.0.0.1:${PORT}`;
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new pg.Client({ connectionString: DB, application_name: 'live-phase14-telemetry' }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const tag = randomBytes(4).toString('hex');
const PW = 'Phase14!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const SA = randomUUID(), SUP = randomUUID();
const email = (k) => `phase14-${k}-${tag}@aipowersalon.test`;
const CORR = `corr_live_p14_${tag}`;
const LEAK_EMAIL = `leak.customer.${tag}@example.com`, LEAK_SECRET = `sk_live_${randomBytes(12).toString('hex')}`;
const PRIVATE_ROOT = mkdtempSync(join(tmpdir(), 'p14-private-'));
const STARTED = new Date();
const madeRequestIds = new Set();

for (const [id, role, k] of [[SA, 'PLATFORM_SUPER_ADMIN', 'sa'], [SUP, 'PLATFORM_SUPPORT', 'sup']]) {
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'P14', 'Fourteen', 'P14 Fourteen', $2, $3, 'active', 'SUPER_ADMIN', false, $4)`, [id, email(k), hash, role]);
}

const baseEnv = {
  ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', TRUST_PROXY_HOPS: '1',
  EVENT_PUBLISHER_ENABLED: 'true', PRIVATE_FILES_ROOT: PRIVATE_ROOT, TELEMETRY_STORE: 'on', TELEMETRY_TRACE_SAMPLE: '1', AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off',
};
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'WORKER_JOB_CLASSES', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME', 'TELEMETRY_LOG_SAMPLE', 'PROCESS_ROLE']) delete baseEnv[k];
let api = null, worker = null; let errs = '', werrs = '';
const killed = (p) => !p || p.exitCode !== null || p.signalCode !== null;

const cleanup = async () => {
  for (const p of [api, worker]) { try { if (p && !killed(p)) p.kill('SIGTERM'); } catch { /* */ } }   // by the PIDs this script started
  for (let i = 0; i < 40 && !(killed(api) && killed(worker)); i++) await sleep(250);
  for (const p of [api, worker]) { try { if (p && !killed(p)) p.kill('SIGKILL'); } catch { /* */ } }
  const users = [SA, SUP];
  const ops = await q(`select id, job_id from api_operations where actor_user_id = any($1::text[])`, [users]).catch(() => []);
  await q(`delete from jobs where id = any($1::uuid[]) or (job_type = 'api.export' and payload->>'operationId' = any($2::text[]))`, [ops.map((o) => o.job_id).filter(Boolean), ops.map((o) => o.id)]).catch(() => undefined);
  await q(`delete from api_operations where actor_user_id = any($1::text[])`, [users]).catch(() => undefined);
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'authorization_denials']) await q(`delete from ${t} where user_id = any($1::uuid[])`, [users]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('sa'), email('sup'), LEAK_EMAIL]]).catch(() => undefined);
  await q(`delete from users where id = any($1::uuid[])`, [users]).catch(() => undefined);
  const tl = await q(`delete from telemetry_log_events where ts >= $1 and (correlation_id = any($2::text[]) or request_id = any($3::text[])) returning 1`, [STARTED, [CORR, `corr_poll_${tag}`], [...madeRequestIds]]).catch(() => []);
  const traceIds = (await q(`select distinct trace_id from telemetry_spans where start_ts >= $1 and attributes->>'aipowersalon.request_id' = any($2::text[])`, [STARTED, [...madeRequestIds]]).catch(() => [])).map((r) => r.trace_id);
  const ts = await q(`delete from telemetry_spans where start_ts >= $1 and trace_id = any($2::text[]) returning 1`, [STARTED, traceIds]).catch(() => []);
  rmSync(PRIVATE_ROOT, { recursive: true, force: true });
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from api_operations where actor_user_id = any($2::text[])) as n`, [users, users]))[0].n;
  check('cleanup: both processes stopped by PID; the proof users, sessions, operation, job, private files and its telemetry rows are gone',
    killed(api) && killed(worker) && left === 0 && !existsSync(PRIVATE_ROOT), `left=${left}, telemetry rows removed: ${tl.length} log line(s), ${ts.length} span(s)`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 6 * 60_000);

const cookieJar = (...lists) => { const jar = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) jar.set(k, c); } return [...jar.values()].join('; '); };
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const call = (cookie) => async (path, hdr = {}, query) => {
  const u = new URL(API + path); for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { cookie, 'x-correlation-id': CORR, ...hdr } });
  const text = await r.text(); let body = text; try { body = JSON.parse(text); } catch { /* text */ }
  const rid = r.headers.get('x-request-id'); if (rid) madeRequestIds.add(rid);
  return { status: r.status, body, headers: r.headers, requestId: rid };
};
const login = async (body) => {
  const l = await fetch(API + R.login, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': CORR }, body: JSON.stringify(body) });
  const rid = l.headers.get('x-request-id'); if (rid) madeRequestIds.add(rid);
  return { ok: l.status === 200, status: l.status, get: call(cookieJar(setCookies(l))), requestId: rid };
};
const waitFor = async (fn, ok, ms) => { const end = Date.now() + ms; let v = await fn(); while (!ok(v) && Date.now() < end) { await sleep(500); v = await fn(); } return v; };
const boot = async (proc, url) => { for (let i = 0; i < 240; i++) { if (killed(proc)) return false; try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };

try {
  api = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...baseEnv, PORT: String(PORT), PROCESS_ROLE: 'api' }, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stderr.on('data', (c) => { errs += c; }); api.stdout.on('data', (c) => { errs += c; });
  const up = await boot(api, API + '/health/ready');
  if (!check('the API booted against PostgreSQL (PROCESS_ROLE=api) with the telemetry store on', up && /\[telemetry-store\] on/.test(errs), up ? (errs.match(/\[telemetry-store\][^\n]*/)?.[0] ?? 'no telemetry-store boot line') : errs.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');
  worker = spawn('node', ['dist/worker.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...baseEnv, PROCESS_ROLE: 'worker', WORKER_JOB_CLASSES: 'report' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stderr.on('data', (c) => { werrs += c; }); worker.stdout.on('data', (c) => { werrs += c; });

  const sa = await login({ portal: 'super-admin', identifier: email('sa'), password: PW, mfaCode: '123456' });
  const sup = await login({ portal: 'super-admin', identifier: email('sup'), password: PW, mfaCode: '123456' });
  check('a PLATFORM_SUPER_ADMIN and a PLATFORM_SUPPORT user sign in', sa.ok && sup.ok, `sa ${sa.status} support ${sup.status}`);

  // ── 2. the proof's requests, one correlation chain ──────────────────────────────────────────────────────────────────
  const exp = await sa.get(R.export, { prefer: 'respond-async' });
  check('an async export answers 202 (a job for the worker), with x-request-id and traceparent', exp.status === 202 && !!exp.requestId && /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(exp.headers.get('traceparent') ?? ''), `status ${exp.status} ${exp.requestId} ${exp.headers.get('traceparent')}`);
  const EXP_TRACE = (exp.headers.get('traceparent') ?? '').split('-')[1];
  const bad = await sa.get(R.trace('not-a-trace-id'));
  check('an error request answers 400 with its request id', bad.status === 400 && !!bad.requestId, `status ${bad.status} ${bad.requestId}`);
  const leak = await fetch(API + R.login, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': CORR }, body: JSON.stringify({ portal: 'super-admin', identifier: LEAK_EMAIL, password: LEAK_SECRET, mfaCode: '123456' }) });
  if (leak.headers.get('x-request-id')) madeRequestIds.add(leak.headers.get('x-request-id'));
  check('a failed sign-in carrying an email and a secret-looking password is refused', leak.status >= 400 && leak.status < 500, `status ${leak.status}`);
  const op = await waitFor(() => sa.get(exp.body?.statusUrl ?? '/nope', { 'x-correlation-id': `corr_poll_${tag}` }), (s) => ['succeeded', 'failed'].includes(s.body?.status), 120_000);
  check('the worker process ran the export job', op.body?.status === 'succeeded', `operation ${op.body?.status ?? op.status} ${String(werrs.split('\n').filter((l) => /error/i.test(l)).slice(-1)[0] ?? '').slice(0, 160)}`);

  // ── 3. request search ───────────────────────────────────────────────────────────────────────────────────────────────
  const byId = await waitFor(() => sa.get(R.requests, {}, { requestId: exp.requestId }), (r) => r.body?.items?.length > 0, 20_000);
  const it = byId.body?.items?.[0];
  check('§291 found by request id: the export request, its route template, status 202, its correlation and trace', byId.status === 200 && it?.requestId === exp.requestId && it?.status === 202 && it?.correlationId === CORR && it?.traceId === EXP_TRACE && /settlements\/export/.test(it?.route ?? ''),
    JSON.stringify(it ?? byId.body).slice(0, 240));
  const byCorr = await waitFor(() => sa.get(R.requests, {}, { correlationId: CORR, limit: '200' }), (r) => (r.body?.items ?? []).some((x) => x.kind === 'job'), 30_000);
  const kinds = (byCorr.body?.items ?? []).map((x) => `${x.kind}:${x.requestId}`);
  check('§292 found by correlation id: the requests of the chain AND the worker\'s job', (byCorr.body?.items ?? []).some((x) => x.requestId === exp.requestId) && (byCorr.body?.items ?? []).some((x) => x.kind === 'job'), kinds.join(', '));
  const corrView = await sa.get(R.correlation(CORR));
  check('the correlation view groups requests and jobs and lists the chain\'s traces', corrView.status === 200 && corrView.body?.requests?.length >= 2 && corrView.body?.jobs?.length >= 1 && corrView.body?.traceIds?.includes(EXP_TRACE),
    `requests ${corrView.body?.requests?.length} jobs ${corrView.body?.jobs?.length} traces ${corrView.body?.traceIds?.length}`);
  const det = await sa.get(R.request(exp.requestId));
  check('the request detail lists its log lines and its trace id', det.status === 200 && det.body?.logs?.some((l) => l.msg === 'request.completed') && det.body?.traceIds?.includes(EXP_TRACE), `${det.body?.logs?.length} line(s): ${(det.body?.logs ?? []).map((l) => l.msg).join(', ')}`);

  const tr = await waitFor(() => sa.get(R.trace(EXP_TRACE)), (t) => (t.body?.spans ?? []).some((s) => /^job /.test(s.name)) && (t.body?.spans ?? []).some((s) => s.kind === 'server'), 30_000);
  const spans = tr.body?.spans ?? [];
  const server = spans.find((s) => s.kind === 'server');
  const dbs = spans.filter((s) => s.name.startsWith('db '));
  const job = spans.find((s) => /^job /.test(s.name));
  check('the trace: a server span (API) at the root with DB spans under it', !!server && server.depth === 0 && dbs.some((d) => d.parentSpanId === server.spanId), `${spans.length} spans; server ${server?.name}; ${dbs.length} db`);
  check('the trace continues in the WORKER: a job span of the same trace (another process\'s service)', !!job && job.service !== server?.service && /worker/.test(job.service), job ? `${job.name} @ ${job.service} parent ${job.parentSpanId}` : spans.map((s) => s.name).join(' | '));
  const serverLogs = server?.logs?.map((l) => l.msg) ?? [];
  const jobLogs = job?.logs?.map((l) => l.msg) ?? [];
  check('trace ↔ log linking: the request\'s lines hang on the server span, the job\'s lines on the job span', serverLogs.includes('request.completed') && jobLogs.some((m) => /^job\./.test(m)), `server: [${serverLogs.join(', ')}] job: [${jobLogs.join(', ')}]`);

  // ── 4. the error request ────────────────────────────────────────────────────────────────────────────────────────────
  const errFound = await waitFor(() => sa.get(R.requests, {}, { requestId: bad.requestId, level: 'warn' }), (r) => r.body?.items?.length > 0, 20_000);
  const e = errFound.body?.items?.[0];
  check('the error request is found by id at level warn+, status 400 (WARN lines are always kept)', e?.status === 400 && ['warn', 'error'].includes(e?.maxLevel), JSON.stringify(e ?? errFound.body).slice(0, 200));
  const errDetail = await sa.get(R.request(bad.requestId));
  const rejected = errDetail.body?.logs?.find((l) => l.level === 'warn');
  check('with the sensitive key the rejection carries its (redacted) exception message', !!rejected?.fields?.exception?.message, JSON.stringify(rejected?.fields ?? {}).slice(0, 160));

  // ── 5. §181 the support user ────────────────────────────────────────────────────────────────────────────────────────
  const sRows = await sup.get(R.requests, {}, { correlationId: CORR });
  check('§181 a support user (telemetry.view only) can search — and the response is marked redacted', sRows.status === 200 && sRows.body?.redacted === true && (sRows.body?.items ?? []).every((x) => x.tenantId === null), `status ${sRows.status} redacted ${sRows.body?.redacted} items ${sRows.body?.items?.length}`);
  const sDet = await sup.get(R.request(bad.requestId));
  const sRej = sDet.body?.logs?.find((l) => l.level === 'warn');
  check('§181 the support user does NOT see the error message or non-whitelisted fields', sDet.status === 200 && sDet.body?.redacted === true && !!sRej && !('exception' in (sRej.fields ?? {})) && !JSON.stringify(sDet.body).includes('32 lowercase hex'), JSON.stringify(sRej?.fields ?? {}).slice(0, 160));
  const sTenant = await sup.get(R.requests, {}, { tenantId: randomUUID() });
  check('§181 the support user is refused a tenant filter (403)', sTenant.status === 403, `status ${sTenant.status}`);
  const sTrace = await sup.get(R.trace(EXP_TRACE));
  check('§181 the support user\'s trace view: no tenant ids, no status messages', sTrace.status === 200 && (sTrace.body?.spans ?? []).every((s) => s.tenantId === null && s.statusMessage === null), `${sTrace.body?.spans?.length} spans`);

  // ── 6. nothing unredacted landed ────────────────────────────────────────────────────────────────────────────────────
  await sleep(2_500);   // one more flush interval
  const leakedLogs = (await q(`select count(*)::int as n from telemetry_log_events t where ts >= $1 and (row_to_json(t)::text like $2 or row_to_json(t)::text like $3)`, [STARTED, `%${LEAK_EMAIL}%`, `%${LEAK_SECRET}%`]))[0].n;
  const leakedSpans = (await q(`select count(*)::int as n from telemetry_spans t where start_ts >= $1 and (row_to_json(t)::text like $2 or row_to_json(t)::text like $3)`, [STARTED, `%${LEAK_EMAIL}%`, `%${LEAK_SECRET}%`]))[0].n;
  const signInRows = (await q(`select count(*)::int as n from telemetry_log_events where ts >= $1 and request_id = $2`, [STARTED, leak.headers.get('x-request-id')]))[0].n;
  check('nothing unredacted landed: no stored line or span contains the email or the password the proof sent', leakedLogs === 0 && leakedSpans === 0, `log rows with a leak: ${leakedLogs}, span rows: ${leakedSpans} (the failed sign-in stored ${signInRows} line(s))`);
  const stored = (await q(`select (select count(*)::int from telemetry_log_events where ts >= $1) as logs, (select count(*)::int from telemetry_spans where start_ts >= $1) as spans, (select count(distinct process_role)::int from telemetry_log_events where ts >= $1) as roles`, [STARTED]))[0];
  check('both processes wrote to the store through their worker pools', stored.roles >= 2, `${stored.logs} log line(s), ${stored.spans} span(s) since the start, from ${stored.roles} process role(s)`);
} catch (err) {
  check('run completed', false, String(err?.message ?? err));
} finally {
  await cleanup().catch((e) => check('cleanup ran', false, String(e?.message ?? e)));
  clearTimeout(timer);
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
