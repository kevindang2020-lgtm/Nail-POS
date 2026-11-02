#!/usr/bin/env node
// live-injection-pass.mjs — Security Deep Scan §163 (injection tests), run LOCALLY against the BUILT API and a real
// PostgreSQL. Never point it at production: it creates a proof salon (tenant_slug live-inj-*) and removes it afterwards.
//
// The route list is the manifest's (apps/api/scripts/audit-routes.js — the same collector the OpenAPI gate uses). For every
// POST / PUT / PATCH route that reads a body, every GET route that reads query parameters, and every route with a path
// parameter, in the realms a test salon can reach (salon staff as the salon OWNER, the customer-free public routes with no
// session, and the platform realm as a Super Admin of the local database), each payload FAMILY is sent:
//   sqli      ' OR '1'='1 · 1;DROP TABLE users-- · ' UNION SELECT NULL-- · a trailing backslash \ · %' --
//   xss       <script>alert(1)</script> · "><img src=x onerror=alert(1)>
//   traversal ../../../../etc/passwd · ..%2f..%2f..%2fetc%2fpasswd
//   header    a CR/LF pair followed by an X-Injected header (in a body value, a query value and a path segment)
//   template  {{7*7}}zq · ${7*7}zq · #{7*7}zq · <%= 7*7 %>zq
// into EVERY declared body field (twice: every field as the payload; then only the plain string fields, the rest given a
// type-correct value so the payload can travel further), every query parameter, and every path parameter.
// A response FAILS the pass when it is:
//   5xx              the input reached something that crashed (an injection symptom until proved otherwise);
//   SQL_ERROR        the body carries database error text (syntax error at or near / relation / column … / pg codes);
//   REFLECTED_HTML   a text/html response carrying the raw markup payload;
//   HEADER_INJECTED  a response header the payload tried to add (X-Injected);
//   TRAVERSAL        a body carrying /etc/passwd content;
//   TEMPLATE_EVAL    a body carrying 49zq (a template engine evaluated 7*7).
// A JSON 4xx that names the field (validation) is the expected outcome; a JSON 2xx stores the string as data (also fine —
// parameterized SQL + output escaping are the defence; the escaping side is check:html / React).
// Output: a summary + every failure, and (INJ_JSON=<file>) the full per-family counts. Recorded in
// docs/security/SECURITY_TEST_REPORT.md "§163 local dynamic injection pass".
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.INJ_PORT || 3071), API = `http://127.0.0.1:${PORT}`;
const API_DIR = new URL('../', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;

// ── the declared body fields (from the framework metadata, via the strict-bodies spec) ─────────────────────────────
const schemasFile = process.env.INJ_SCHEMAS || join(mkdtempSync(join(tmpdir(), 'inj-')), 'schemas.json');
if (!existsSync(schemasFile) || !process.env.INJ_SCHEMAS) {
  const r = spawnSync('npx', ['vitest', 'run', 'src/common/strict-bodies.vitest.spec.ts'], { cwd: API_DIR, env: { ...process.env, BODY_SCHEMAS_OUT: schemasFile, TZ: 'UTC' }, encoding: 'utf8' });
  if (!existsSync(schemasFile)) { console.error('could not read the body schemas', r.stdout?.slice(-500), r.stderr?.slice(-500)); process.exit(2); }
}
const SCHEMAS = JSON.parse(readFileSync(schemasFile, 'utf8'));
const { routes } = require('./audit-routes.js');

export const FAMILIES = {
  sqli: [`' OR '1'='1`, `1;DROP TABLE users--`, `' UNION SELECT NULL--`, `abc\\`, `%' --`],
  xss: [`<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`],
  traversal: [`../../../../etc/passwd`, `..%2f..%2f..%2fetc%2fpasswd`],
  header: [`ok\r\nX-Injected: 1`, `ok%0d%0aX-Injected:%201`],
  template: [`{{7*7}}zq`, '${7*7}zq', `#{7*7}zq`, `<%= 7*7 %>zq`],
};
const SQL_ERROR = /syntax error at or near|unterminated quoted string|invalid input syntax for|relation "[a-z_]+" does not exist|column "[a-z_]+" does not exist|\bSQLSTATE\b|error: .*\bpg_|42601|22P02|42P01/i;

// routes that would end or lock the run's own session / the platform for everyone (exercised by their own suites)
const SKIP = /^\/(auth\/(logout|lock|set-pin|devices\/|change-password|change-temporary-password|mfa\/)|super-admin\/(security\/lockdowns|maintenance|security\/sessions|platform-staff\/[^/]+\/revoke-sessions)|account\/me\/delete|customer\/me\/delete)|kill-switch|break-glass|\/end-employment$/;

// ── proof salon + owner; a platform account ───────────────────────────────────────────────────────────────────────
const tag = String(Date.now()).slice(-6);
const S = { id: randomUUID(), branch: randomUUID(), owner: randomUUID(), sa: randomUUID(), code: `INJ${tag}` };
const PW = 'Inj!' + randomUUID().slice(0, 12);
const hash = await hashPassword(PW);
const ownerEmail = `inj-owner-${tag}@aipowersalon.test`, saEmail = `inj-sa-${tag}@aipowersalon.test`;
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,$3,$4,'active')`, [S.id, `Injection Proof ${tag}`, `live-inj-${tag}`, S.code]);
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,'Main','active','America/New_York','1 Proof Way')`, [S.branch, S.id]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Inj','Owner','Inj Owner',$4,$5,'active','OWNER')`, [S.owner, S.id, S.branch, ownerEmail, hash]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'manager')`, [S.id, S.branch, S.owner]);
await q(`update tenants set owner_user_id = $2 where id = $1`, [S.id, S.owner]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,null,null,'Inj','Admin','Inj Admin',$2,$3,'active','SUPER_ADMIN')`, [S.sa, saEmail, hash]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-injection-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1',
  TENANT_RATE_LIMIT: 'off', ANON_RATE_LIMIT: 'off', SUPER_ADMIN_DEVICE_POLICY: 'off', AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' };
for (const k of ['PROCESS_ROLE', 'JOBS_WORKER', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'MAINTENANCE_BREAK_GLASS', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SENDGRID_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[k];
let proc = null; let errs = '';
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const jar = (...l) => { const m = new Map(); for (const c of l.flat()) m.set(c.split('=')[0], c); return [...m.values()].join('; '); };
let ipN = 0;
async function signIn(kind) {
  const ip = `10.163.${kind === 'sa' ? 2 : 1}.${(++ipN % 250) + 1}`;
  const body = kind === 'sa' ? { portal: 'super-admin', identifier: saEmail, password: PW, mfaCode: '123456' } : { portal: 'tenant', salonCode: S.code, identifier: ownerEmail, password: PW };
  let l = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });
  let c = setCookies(l); const lb = await l.json().catch(() => ({}));
  if (kind === 'owner' && lb.outcome === 'BRANCH_SELECTION_REQUIRED') {
    const sel = await fetch(API + '/api/v1/auth/select-branch', { method: 'POST', headers: { cookie: jar(c), 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ branchId: S.branch }) });
    c = [...c, ...setCookies(sel)];
  }
  return { cookie: jar(c), ip, ok: l.status === 200, detail: `${kind} login ${l.status} ${lb.outcome ?? lb.code ?? ''}` };
}

const realmOf = (path) => (path.startsWith('/super-admin') ? 'sa' : /^\/(pos|owner|tenant|tech|auth|account|audit|ai|community|reports|realtime|me)(\/|$)/.test(path) ? 'owner' : 'public');
const valueFor = (s) => {
  const t = Array.isArray(s?.type) ? s.type.find((x) => x !== 'null') : s?.type;
  if (s?.enum) return s.enum[0];
  if (t === 'integer' || t === 'number') return 1;
  if (t === 'boolean') return true;
  if (t === 'array') return [];
  if (t === 'object') return {};
  if (s?.format === 'uuid') return randomUUID();
  if (s?.format === 'date') return '2026-01-01';
  if (s?.format === 'date-time') return '2026-01-01T10:00:00Z';
  if (s?.format === 'email') return 'inj@aipowersalon.test';
  return 'x';
};
function bodies(schema, payload) {
  const props = schema?.properties ?? schema?.anyOf?.find((a) => a?.properties)?.properties;
  if (!props || !Object.keys(props).length) return [{ q: payload, search: payload, name: payload }];
  const all = Object.fromEntries(Object.keys(props).map((k) => [k, payload]));
  const typed = Object.fromEntries(Object.entries(props).map(([k, s]) => { const t = Array.isArray(s?.type) ? s.type : [s?.type]; return [k, t.includes('string') && !s?.format && !s?.enum ? payload : valueFor(s)]; }));
  return [all, typed];
}
const HTML_PAYLOAD = /<script>alert\(1\)<\/script>|<img src=x onerror=alert\(1\)>/;
function judge(res, text) {
  const out = [];
  if (res.status >= 500 || res.status === 0) out.push('5xx');
  if (SQL_ERROR.test(text)) out.push('SQL_ERROR');
  const ct = res.headers?.get?.('content-type') ?? '';
  if (/text\/html/i.test(ct) && HTML_PAYLOAD.test(text)) out.push('REFLECTED_HTML');
  if (res.headers?.get?.('x-injected')) out.push('HEADER_INJECTED');
  if (/root:x:0:0:/.test(text)) out.push('TRAVERSAL');
  if (/\b49zq\b/.test(text)) out.push('TEMPLATE_EVAL');
  return out;
}

const counts = {}; const failures = []; let total = 0;
const bump = (fam, k) => { counts[fam] ??= {}; counts[fam][k] = (counts[fam][k] ?? 0) + 1; };
let who = {};
async function send(realm, method, url, body, fam, routeKey, where) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = realm === 'public' ? null : who[realm];
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20_000);
    let res; let text = '';
    try {
      res = await fetch(API + '/api/v1' + url, { method, signal: ac.signal, headers: { accept: 'application/json', 'x-forwarded-for': s?.ip ?? `10.163.9.${(total % 250) + 1}`, ...(s ? { cookie: s.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      text = await res.text().catch(() => '');
    } catch (e) { res = { status: 0, headers: new Headers() }; text = String(e?.message || e); } finally { clearTimeout(t); }
    // our own session ended (a route revoked / locked it): sign in again and repeat once
    if (s && (res.status === 401 || res.status === 423) && /SESSION|AUTH_REQUIRED|No session|LOCKED|revoked/i.test(text) && attempt === 0) { who[realm] = await signIn(realm); continue; }
    total++;
    const bad = judge(res, text);
    bump(fam, bad.length ? 'FAIL' : res.status >= 200 && res.status < 300 ? '2xx' : res.status >= 400 && res.status < 500 ? '4xx' : String(res.status));
    if (bad.length) failures.push({ route: routeKey, where, family: fam, status: res.status, bad, body: text.slice(0, 240) });
    return;
  }
}

const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(800);
  const users = [S.owner, S.sa];
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'login_attempts']) await q(`delete from ${t} where user_id = any($1::uuid[])`, [users]).catch(() => undefined);
  const cols = await q(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name like '%tenant_id' and c.table_name <> 'tenants' and c.data_type = 'uuid'`);
  let pending = cols;
  for (let pass = 0; pass < 12 && pending.length; pass++) { const next = []; for (const r of pending) { try { await client.query(`delete from "${r.table_name}" where "${r.column_name}" = $1`, [S.id]); } catch { next.push(r); } } if (next.length === pending.length) break; pending = next; }
  await q(`delete from users where id = any($1::uuid[])`, [users]).catch(() => undefined);
  await q(`delete from tenants where id = $1`, [S.id]).catch(() => undefined);
  await client.end();
};

let exitCode = 0;
try {
  proc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; if (errs.length > 2_000_000) errs = errs.slice(-1_000_000); });
  let up = false; for (let i = 0; i < 480 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!up) throw new Error('the API did not boot: ' + errs.split('\n').slice(-3).join(' | '));
  who = { owner: await signIn('owner'), sa: await signIn('sa') };
  console.log(`signed in: ${who.owner.detail} · ${who.sa.detail}`);
  if (!who.owner.ok) throw new Error('the proof salon owner could not sign in');

  const cases = [];
  for (const r of routes) {
    const path = r.path; const key = `${r.method} ${path}`;
    if (SKIP.test(path) || /^\/(webhooks|jobs|internal|health|metrics|oauth|v1|api\/v1)\b/.test(path) || r.method === 'DELETE') continue;
    const realm = realmOf(path); if (realm === 'sa' && !who.sa.ok) continue;
    const hasBody = r.params.some((p) => p.in === 'Body');
    const queryNames = [...new Set(r.params.filter((p) => p.in === 'Query').map((p) => p.name || 'q'))];
    const pathParams = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    if (!hasBody && !queryNames.length && !pathParams.length) continue;
    if (r.method === 'GET' && !queryNames.length && !pathParams.length) continue;
    cases.push({ r, key, realm, hasBody, queryNames, pathParams });
  }
  console.log(`cases: ${cases.length} routes (${cases.filter((c) => c.hasBody).length} with a body, ${cases.filter((c) => c.queryNames.length).length} with query parameters, ${cases.filter((c) => c.pathParams.length).length} with path parameters)`);
  for (const c of cases) {
    const { r, key, realm } = c;
    const schema = SCHEMAS[`${r.method} ${r.path}`];
    for (const [fam, payloads] of Object.entries(FAMILIES)) {
      const p = payloads[total % payloads.length];
      const fill = (v) => r.path.replace(/:([A-Za-z0-9_]+)/g, () => encodeURIComponent(v));
      const validPath = r.path.replace(/:([A-Za-z0-9_]+)/g, () => randomUUID());
      // path parameters carry the payload
      if (c.pathParams.length) await send(realm, r.method, fill(p), c.hasBody ? {} : undefined, fam, key, 'path');
      // query parameters carry the payload
      if (c.queryNames.length) { const qs = c.queryNames.map((n) => `${encodeURIComponent(n)}=${encodeURIComponent(p)}`).join('&'); await send(realm, r.method, `${validPath}?${qs}`, c.hasBody ? {} : undefined, fam, key, 'query'); }
      // body fields carry the payload (two shapes)
      if (c.hasBody && r.method !== 'GET') for (const b of bodies(schema, p)) await send(realm, r.method, validPath, b, fam, key, 'body');
    }
  }
} catch (e) {
  console.error('the pass did not run to the end:', String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); exitCode = 2;
} finally {
  await cleanup().catch((e) => console.error('cleanup:', e?.message));
  const byKind = {}; for (const f of failures) for (const b of f.bad) byKind[b] = (byKind[b] ?? 0) + 1;
  console.log(`\n§163 local dynamic injection pass: ${total} requests · ${failures.length} failing responses ${JSON.stringify(byKind)}`);
  for (const [fam, c] of Object.entries(counts)) console.log(`  ${fam.padEnd(10)} ${JSON.stringify(c)}`);
  const uniq = new Map(); for (const f of failures) { const k = `${f.route} [${f.where}] ${f.bad.join(',')}`; if (!uniq.has(k)) uniq.set(k, f); }
  for (const f of uniq.values()) console.log(`  FAIL ${f.route} [${f.where}/${f.family}] ${f.status} ${f.bad.join(',')} — ${f.body.replace(/\s+/g, ' ').slice(0, 160)}`);
  if (process.env.INJ_JSON) writeFileSync(process.env.INJ_JSON, JSON.stringify({ total, counts, failures: [...uniq.values()] }, null, 1));
  if (process.env.INJ_STDERR) writeFileSync(process.env.INJ_STDERR, errs);
  process.exit(exitCode || (failures.length ? 1 : 0));
}
