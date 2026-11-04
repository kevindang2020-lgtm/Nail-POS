#!/usr/bin/env node
// live-phase14-idor.mjs — BUILD_PLAN Phase 14 (Constitution 12 §286 automated penetration testing, §299 the IDOR suite),
// proved on the real API and PostgreSQL. Nothing is stubbed.
//
// Two proof salons are created (A and B), each with an owner and a technician. Salon A gets one REAL row in every table
// an IDOR case needs (a generic seeder fills required columns from the schema; every text it writes carries the marker
// IDORA<tag>). The route list is GENERATED from the OpenAPI manifest (scripts/idor-routes.mjs): every GET route of the
// tenant realms with a path parameter. For each route:
//   • salon B (its owner — its technician for /tech/*) asks for salon A's record by A's real id. It must answer 401 /
//     403 / 404 / 400 / 409 / 422, or a 2xx that carries NONE of salon A's data (no marker, no A tenant id, no other A
//     fixture id). A 2xx carrying A's data is a LEAK (fails the run). A 5xx is an ERROR (fails the run — a foreign id
//     must be refused, not crash the handler).
//   • the same call as salon A is the positive control: it proves the fixture is real (A gets its own record). A route
//     whose control does not find A's record is reported as "control weak" — its denial proves less, and it is listed.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase14-idor.mjs   (apps/api built). Never point it at production: it
// creates two proof tenants (tenant_slug live-p14-idor-*) and removes everything it made (append-only rows stay).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { idorRoutes, classifyIdorRoute, actorFor, queryFor, branchScopeOf } from './idor-routes.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.IDOR_PORT || 3064), API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;

// ── proof-tenant removal (same approach as live-phase8/9: every *tenant_id column, FK-ordered retries) ─────────────
/** Tables a trigger keeps forever in the product (immutability), cleared here ONLY for the proof salon on a scratch DB. */
// Nov 4 2026: commission reviews and the configuration-history tables below refuse DELETE by trigger too (the cleanup left them and
// then could not remove the proof tenant)
const PROOF_ONLY_DELETABLE = new Set(['payroll_statements', 'commission_discrepancy_reviews', 'ai_customer_profile_settings_events', 'ai_reputation_config_versions', 'team_data_alerts', 'sms_test_events']);
async function removeProofTenant(tenantId) {
  const cols = await q(`select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name like '%tenant_id' and c.table_name <> 'tenants' and c.data_type = 'uuid'`);
  const kept = new Set();
  await client.query('begin');
  try {
    let pending = cols;
    for (let pass = 0; pass < 12 && pending.length; pass++) {
      const next = [];
      for (const r of pending) {
        await client.query('savepoint p');
        try { await client.query(`delete from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]); await client.query('release savepoint p'); }
        catch {
          await client.query('rollback to savepoint p');
          // Oct 22 2026: tables whose rows the product NEVER deletes (a trigger refuses it — e.g. payroll statements are
          // voided, not deleted). This scratch database holds only the proof salon's seeded copy: remove exactly those
          // rows with triggers held off for this one statement (needs the database owner, as the proof already does).
          if (PROOF_ONLY_DELETABLE.has(r.table_name)) {
            await client.query('savepoint p');
            try { await client.query(`set local session_replication_role = replica`); await client.query(`delete from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]);
              await client.query(`set local session_replication_role = default`); await client.query('release savepoint p'); continue; }
            catch { await client.query('rollback to savepoint p'); }
          }
          next.push(r);
        }
      }
      if (next.length === pending.length) { pending = next; break; }
      pending = next;
    }
    for (const r of pending) {
      const n = (await q(`select count(*)::int as n from "${r.table_name}" where "${r.column_name}" = $1`, [tenantId]))[0].n;
      if (n) kept.add(`${r.table_name}(${n})`);
    }
    await client.query('savepoint p');
    let removed = false;
    try { await client.query(`delete from tenants where id = $1`, [tenantId]); await client.query('release savepoint p'); removed = true; }
    catch (e) { await client.query('rollback to savepoint p'); kept.add(`tenants: ${String(e?.message || e).slice(0, 100)}`); }
    await client.query('commit');
    return { removed, kept: [...kept] };
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e; }
}
for (const r of await q(`select id from tenants where tenant_slug like 'live-p14-idor-%'`)) await removeProofTenant(r.id);

// ── the two salons ──────────────────────────────────────────────────────────────────────────────────────────────
const tag = String(Date.now()).slice(-6);
const MARK = `IDORA${tag}`;
const PW = 'Idor14!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const mk = (k) => ({ key: k, id: randomUUID(), branch: randomUUID(), owner: randomUUID(), techUser: randomUUID(), tech: randomUUID(), code: `P14${k}${tag}` });
const SA = mk('A'), SB = mk('B');
SA.branch2 = randomUUID();
SA.mgr2 = randomUUID();   // Security Deep Scan §75 / §187: salon A's MANAGER of location 2 only — attacks location 1's records
const email = (s, who) => `p14-idor-${s.key.toLowerCase()}-${who}-${tag}@aipowersalon.test`;
for (const s of [SA, SB]) {
  const name = s === SA ? `${MARK} Salon` : `Proof Salon B ${tag}`;
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,$3,$4,'active')`, [s.id, name, `live-p14-idor-${s.key.toLowerCase()}-${tag}`, s.code]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York',$4)`, [s.branch, s.id, `${s === SA ? MARK : 'B'} Branch`, `${s === SA ? MARK : '1'} Proof Way`]);
  for (const [uid, role, who] of [[s.owner, 'OWNER', 'owner'], [s.techUser, 'TECHNICIAN', 'tech']]) {
    await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,$5,$4 || ' ' || $5,$6,$7,'active',$8)`,
      [uid, s.id, s.branch, s === SA ? MARK : 'Bee', who, email(s, who), hash, role]);
    await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [s.id, s.branch, uid, role === 'OWNER' ? 'manager' : 'staff']);
  }
  await q(`update tenants set owner_user_id = $2 where id = $1`, [s.id, s.owner]);
  if (s.branch2) await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York',$4)`, [s.branch2, s.id, `${MARK} Second Branch`, `${MARK} 2 Proof Way`]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,$5,'Tech',$5 || ' Tech','active')`,
    [s.tech, s.id, s.branch, s.techUser, s === SA ? MARK : 'Bee']);
}
// the location-2 manager (no access to location 1, where every fixture row lives)
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Mia','Mgr2','Mia Mgr2',$4,$5,'active','MANAGER')`,
  [SA.mgr2, SA.id, SA.branch2, email(SA, 'mgr2'), hash]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'manager')`, [SA.id, SA.branch2, SA.mgr2]);

// ── the generic seeder: one row of salon A in any table, required columns filled from the schema ─────────────────
const colCache = new Map(), fkCache = new Map();
const columns = async (t) => colCache.get(t) ?? colCache.set(t, await q(`select column_name as n, data_type as dt, udt_name as udt, is_nullable = 'YES' as nullable,
    column_default is not null as hasdef, is_generated <> 'NEVER' or is_identity = 'YES' as gen from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).get(t);
const fks = async (t) => fkCache.get(t) ?? fkCache.set(t, Object.fromEntries((await q(`select a.attname as col, cf.relname as ref from pg_constraint c join pg_class cl on cl.oid = c.conrelid
    join pg_class cf on cf.oid = c.confrelid join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and cl.relname = $1 and array_length(c.conkey, 1) = 1`, [t])).map((r) => [r.col, r.ref]))).get(t);
const FIXED = (s) => ({ tenants: s.id, branches: s.branch, users: s.owner, technicians: s.tech });
const seeded = new Map();   // table → id (salon A)
// columns the schema's CHECKs need in a shape the generic filler cannot guess (a format, a pair, a distinct branch)
const SEED_OVERRIDES = (s) => ({
  pos_tech_appointments: { start_time: '10:00', end_time: '11:00', technician_id: s.tech },
  api_operations: { kind: 'idor.proof' },
  inventory_transfers: { from_branch_id: s.branch, to_branch_id: s.branch2 },
  tickets: { primary_technician_id: s.tech },
  ticket_service_lines: { technician_id: s.tech },
  tenant_community_settings: { enabled: true },
  // Nov 4 2026: the generic filler read a CHECK's text as a value for these booleans / enums (22P02); explicit values
  ai_business_alerts: { metric_id: 'net_sales', operator: 'gt', frequency: 'daily', channel: 'in_app', active: true },
  ai_business_alert_events: { source: 'manual', operator: 'gt', threshold: 1, preset: 'today', sample_ok: true, triggered: false, state_change: 'unchanged' },
});
const token = (s, v) => (v === '$owner' ? s.owner : v === '$techUser' ? s.techUser : v === '$tech' ? s.tech : v);
const seedLog = [];
async function valueFor(s, table, c, fk, depth) {
  if (fk) return FIXED(s)[fk] ?? (fk === table ? null : await rowOf(s, fk, depth + 1));
  if (/tenant_id$/.test(c.n)) return s.id;
  if (/branch_id$/.test(c.n)) return s.branch;
  if (/(user_id|_by)$/.test(c.n) && c.udt === 'uuid') return s.owner;
  if (c.dt === 'ARRAY') return '{}';
  switch (c.udt) {
    case 'uuid': return randomUUID();
    case 'text': case 'varchar': case 'citext': case 'bpchar': return `${MARK}-${randomUUID().slice(0, 8)}`;
    case 'int2': case 'int4': case 'int8': case 'numeric': case 'float4': case 'float8': return 1;
    case 'bool': return false;
    case 'date': return '2026-01-15';
    case 'timestamptz': case 'timestamp': return '2026-01-15T15:00:00Z';
    case 'time': case 'timetz': return '10:00';
    case 'interval': return '1 hour';
    case 'json': case 'jsonb': return '{}';
    case 'inet': case 'cidr': return '10.0.0.1';
    case 'bytea': return Buffer.from('00', 'hex');
    case 'tsvector': return '';
    default: {
      const lab = (await q(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder limit 1`, [c.udt]))[0]?.enumlabel;
      return lab ?? `${MARK}`;
    }
  }
}
/** salon A's row in `table`: an existing one (the fixed ones, or one seeded earlier), else seed one. */
async function rowOf(s, table, depth = 0, pin = null) {
  const cacheKey = `${s.key}:${table}${pin ? ':' + JSON.stringify(pin) : ''}`;
  if (!pin && FIXED(s)[table]) return FIXED(s)[table];
  if (seeded.has(cacheKey)) return seeded.get(cacheKey);
  if (depth > 6) throw new Error(`seed depth exceeded at ${table}`);
  const cols = await columns(table); const fk = await fks(table);
  const row = {};
  const over = { ...(SEED_OVERRIDES(s)[table] ?? {}), ...Object.fromEntries(Object.entries(pin ?? {}).map(([k, v]) => [k, token(s, v)])) };
  const fill = async (c) => { row[c.n] = await valueFor(s, table, c, fk[c.n], depth); };
  for (const c of cols) {
    if (c.gen) continue;
    if (c.n in over) { row[c.n] = over[c.n]; continue; }
    if (/tenant_id$/.test(c.n) || /^branch_id$/.test(c.n)) { await fill(c); continue; }
    if (!c.nullable && !c.hasdef) await fill(c);
    else if (c.udt === 'text' && /(^|_)(name|title|full_name|first_name|last_name|label|description|notes?|subject|body|message)$/.test(c.n)) row[c.n] = `${MARK} ${c.n}`;   // A's visible text carries the marker
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined);
    const sql = `insert into "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
    await client.query('savepoint seed');
    try {
      const r = (await client.query(sql, keys.map((k) => row[k]))).rows[0];
      await client.query('release savepoint seed');
      const id = r.id ?? Object.values(r)[0];
      seeded.set(cacheKey, id); seedLog.push(cacheKey);
      return id;
    } catch (e) {
      await client.query('rollback to savepoint seed');
      const cdef = e.constraint ? (await q(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1 limit 1`, [e.constraint]))[0]?.d ?? '' : '';
      if (e.code === '23502' && e.column) { const c = cols.find((x) => x.n === e.column); if (c) { await fill(c); continue; } }
      if (e.code === '23514' && cdef) {
        let changed = false;
        for (const c of cols) {
          if (!new RegExp(`\\b${c.n}\\b`).test(cdef)) continue;
          const lit = new RegExp(`\\b${c.n}\\b[^']*?'([^']*)'`).exec(cdef)?.[1];
          if (lit !== undefined && row[c.n] !== lit && !/^\d/.test(lit) && !/::(date|timestamp)/.test(cdef)) { row[c.n] = lit; changed = true; }
          else if (row[c.n] === undefined || row[c.n] === null) { await fill(c); changed = true; }
          else if (typeof row[c.n] === 'number' && /(>|<|between)/i.test(cdef)) { const n = /(?:>=?|between)\s*\(?(\d+)/i.exec(cdef)?.[1]; if (n) { row[c.n] = Number(n) + 1; changed = true; } }
        }
        if (changed) continue;
      }
      if (e.code === '23505') { for (const c of cols) if (typeof row[c.n] === 'string' && row[c.n].startsWith(MARK)) row[c.n] = `${MARK}-${randomUUID().slice(0, 8)}`; continue; }
      throw new Error(`${table}: ${e.code} ${String(e.message).slice(0, 160)}${cdef ? ' [' + cdef.slice(0, 160) + ']' : ''}`);
    }
  }
  throw new Error(`${table}: could not satisfy the constraints`);
}

// ── the cases ────────────────────────────────────────────────────────────────────────────────────────────────────
const routes = idorRoutes();
const cases = []; const exempt = []; const noFixture = [];
await client.query('begin');
for (const r of routes) {
  const c = classifyIdorRoute(r);
  if (c.exempt) { exempt.push(`${r.path} — ${c.exempt}`); continue; }
  if (c.unclassified) { noFixture.push(`${r.path} — unclassified ${c.unclassified.join(',')}`); continue; }
  const values = {}; let err = null;
  for (const [name, fx] of Object.entries(c.params)) {
    if (fx.value) { values[name] = fx.value; continue; }
    try {
      const id = await rowOf(SA, fx.table, 0, fx.over ?? null);
      values[name] = fx.col === 'id' ? id : (await q(`select "${fx.col}" as v from "${fx.table}" where id = $1`, [id]))[0]?.v ?? null;
      if (values[name] === null && fx.col !== 'id') { await q(`update "${fx.table}" set "${fx.col}" = $2 where id = $1`, [id, `${MARK}-${fx.col}`]); values[name] = `${MARK}-${fx.col}`; }
    } catch (e) { err = String(e.message || e); }
  }
  if (err) { noFixture.push(`${r.path} — ${err}`); continue; }
  const qs = queryFor(r.path);
  cases.push({ ...r, values, url: r.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(String(values[n]))) + (qs ? `?${qs}` : '') });
}
// salon A's sub-resources, so a by-id sub-route that leaked would have something of A's to leak
for (const t of ['tenant_community_settings', 'ticket_service_lines', 'payments', 'payment_signatures', 'customer_tags', 'customer_payment_methods', 'customer_notes', 'loyalty_ledger',
  'technician_services', 'technician_shifts', 'technician_skills', 'service_add_ons', 'tenant_messaging_credentials', 'tenant_webhook_deliveries',
  'deal_versions', 'deal_coupon_codes', 'tech_cash_handoffs', 'ticket_revisions', 'pos_queue_status_history', 'support_ticket_attachments'])
  await rowOf(SA, t).catch((e) => seedLog.push(`(could not seed ${t}: ${String(e.message).slice(0, 80)})`));
await client.query('commit');
// features both salons switch on, so a feature gate does not answer for the tenant check (community, AI packages)
for (const s of [SA, SB]) {
  for (const pkg of ['ai_voice_transcription', 'ai_queue_technician_assignment']) await q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status) values ($1,$2,'active')`, [s.id, pkg]);
  if (s === SB) await q(`insert into tenant_community_settings (tenant_id, enabled) values ($1, true) on conflict do nothing`, [s.id]).catch(() => undefined);
}
const aValues = new Set([SA.id, SA.owner, SA.techUser, SA.tech, SA.branch2, ...seeded.values()].map(String));

// ── boot + sign in ────────────────────────────────────────────────────────────────────────────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1' };
for (const k of ['PROCESS_ROLE', 'JOBS_WORKER', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'MAINTENANCE_BREAK_GLASS']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' });
let proc = null; let errs = '';
const cookieJar = (...lists) => { const jar = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) jar.set(k, c); } return [...jar.values()].join('; '); };
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
let ipN = 0;
const signIn = async (s, who, branchId = s.branch) => {
  const ip = `10.214.${s === SA ? 1 : 2}.${++ipN}`;
  const l = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ portal: 'tenant', salonCode: s.code, identifier: email(s, who), password: PW }) });
  const c1 = setCookies(l);
  const sel = await fetch(API + '/api/v1/auth/select-branch', { method: 'POST', headers: { cookie: cookieJar(c1), 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ branchId }) });
  return { ok: l.status === 200 && sel.status === 200, detail: `${s.key}/${who}: login ${l.status} select ${sel.status}`, cookie: cookieJar(c1, setCookies(sel)), ip };
};
const get = async (who, path) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15_000);
    try {
      const r = await fetch(API + '/api/v1' + path, { headers: { cookie: who.cookie, 'x-forwarded-for': who.ip, accept: 'application/json' }, signal: ac.signal });
      const text = await r.text().catch(() => '');
      if (r.status === 429) { await sleep(Math.min(5000, 1000 * Number(r.headers.get('retry-after') || 1))); continue; }
      return { status: r.status, text };
    } catch (e) { return { status: 0, text: String(e?.message || e) }; } finally { clearTimeout(t); }
  }
  return { status: 429, text: 'rate limited' };
};
const REFUSED = new Set([400, 401, 403, 404, 409, 410, 422]);
const leakIn = (text, own) => {
  if (text.includes(MARK)) return 'marker';
  if (text.includes(SA.id)) return 'A tenant id';
  for (const v of aValues) if (!own.has(v) && text.includes(v)) return `A id ${v.slice(0, 8)}`;
  return null;
};

const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1000);
  const users = [SA.owner, SA.techUser, SA.mgr2, SB.owner, SB.techUser];
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = any($1::uuid[])`, [users]).catch(() => undefined);
  await q(`delete from login_attempts where identifier like $1`, [`p14-idor-%-${tag}@aipowersalon.test`]).catch(() => undefined);
  const a = await removeProofTenant(SA.id).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const b = await removeProofTenant(SB.id).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select (select count(*)::int from tenants where id = any($1::uuid[])) + (select count(*)::int from users where id = any($2::uuid[])) as n`, [[SA.id, SB.id], users]))[0].n;
  check('cleanup: both proof salons, their users, sessions and every seeded row are gone', a.removed && b.removed && left === 0, `A ${a.removed} [${a.kept.join(', ')}] B ${b.removed} [${b.kept.join(', ')}] left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 15 * 60_000);

const rows = [];
try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const who = { A: { owner: await signIn(SA, 'owner'), tech: await signIn(SA, 'tech') }, B: { owner: await signIn(SB, 'owner'), tech: await signIn(SB, 'tech') } };
  const mgr2 = await signIn(SA, 'mgr2', SA.branch2);
  check('salon A\'s location-2 manager signs in at location 2', mgr2.ok, mgr2.detail);
  check('both salons\' owners and technicians sign in at their own branch', Object.values(who).every((x) => x.owner.ok && x.tech.ok), Object.values(who).flatMap((x) => [x.owner.detail, x.tech.detail]).join(' / '));
  check(`the route table covers the manifest: ${routes.length} tenant-realm GET-by-id routes = ${cases.length} cases + ${exempt.length} exempt (reasoned) + ${noFixture.length} without a fixture`, noFixture.length === 0, noFixture.join(' | '));

  for (const c of cases) {
    const actor = actorFor(c.path);
    const own = new Set(Object.values(c.values).map(String));
    const b = await get(who.B[actor], c.url);
    const a = await get(who.A[actor], c.url);
    const leak = b.status >= 200 && b.status < 300 ? leakIn(b.text, own) : null;
    const verdict = leak ? 'LEAK' : b.status >= 500 || b.status === 0 ? 'ERROR' : REFUSED.has(b.status) ? 'DENIED' : b.status >= 200 && b.status < 300 ? 'NO-A-DATA' : `OTHER`;
    // proven: A's own call returns A's record; differential: A is served (2xx) where B is refused — the id IS A's, and
    // only the tenant decides; weak: A is not served either (feature off, empty sub-resource) — the denial proves less
    const aOk = a.status >= 200 && a.status < 300;
    const control = aOk && (a.text.includes(MARK) || [...own].some((v) => a.text.includes(v))) ? 'proven' : aOk && REFUSED.has(b.status) ? 'differential' : `weak(${a.status})`;
    // §75 / §187: the same record asked for by salon A's location-2 manager (owner routes only; the tech realm is per technician)
    let branch = null;
    if (actor === 'owner') {
      const scope = branchScopeOf(c);
      const m = await get(mgr2, c.url);
      // served = location 1's DATA came back (the marker, the salon id, another fixture id) — echoing the id that was asked for is not data
      const served = m.status >= 200 && m.status < 300 && leakIn(m.text, own) !== null;
      branch = { scope: scope.scope, why: scope.why, status: m.status, served, crash: m.status >= 500 || m.status === 0, text: m.text.slice(0, 160) };
    }
    rows.push({ path: c.path, actor, b: b.status, a: a.status, verdict, control, leak, branch, bText: b.text.slice(0, 200), aText: a.text.slice(0, 200) });
  }
  const by = (v) => rows.filter((r) => r.verdict === v);
  const leaks = by('LEAK'), errors = by('ERROR'), other = by('OTHER');
  check(`no route hands salon B salon A's record (${rows.length} cases)`, leaks.length === 0, leaks.map((r) => `${r.path} ${r.b} [${r.leak}] ${r.bText}`).join(' | '));
  check('no route crashes on another salon\'s id (5xx)', errors.length === 0, errors.map((r) => `${r.path} ${r.b} ${r.bText}`).join(' | '));
  check('no unexpected status', other.length === 0, other.map((r) => `${r.path} ${r.b}`).join(' | '));
  // §75 / §187 branch rows: a route on a location-scoped table never serves location 1's record to the location-2 manager
  const br = rows.filter((r) => r.branch);
  const branchLeaks = br.filter((r) => r.branch.scope === 'branch' && r.branch.served && r.control !== 'weak' && !r.control.startsWith('weak'));
  check(`no location-scoped route hands a location-2 manager location 1's record (${br.filter((r) => r.branch.scope === 'branch').length} branch rows)`, branchLeaks.length === 0, branchLeaks.map((r) => `${r.path} ${r.branch.status} ${r.branch.text}`).join(' | '));
  check('no route crashes on another location\'s id (5xx)', br.every((r) => !r.branch.crash), br.filter((r) => r.branch.crash).map((r) => `${r.path} ${r.branch.status}`).join(' | '));
  if (process.env.IDOR_BRANCH_JSON) (await import('node:fs')).writeFileSync(process.env.IDOR_BRANCH_JSON, JSON.stringify(br.map((r) => ({ path: r.path, scope: r.branch.scope, why: r.branch.why, mgr2: r.branch.status, served: r.branch.served, control: r.control })), null, 1));
  const proven = rows.filter((r) => r.control !== 'weak' && !r.control.startsWith('weak'));
  check('the positive control: salon A is served its own record where salon B is refused, on most routes (the fixtures are real)', proven.length >= Math.floor(rows.length * 0.75), `${proven.length}/${rows.length} proven or differential`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  const count = (k, v) => rows.filter((r) => r[k] === v).length;
  console.log('verdict    B    A    control     route');
  for (const r of rows) console.log(`${r.verdict.padEnd(10)} ${String(r.b).padEnd(4)} ${String(r.a).padEnd(4)} ${r.control.padEnd(11)} ${r.branch ? (r.branch.scope === 'branch' ? 'L' : 's') + String(r.branch.status).padEnd(4) + (r.branch.served ? '*' : ' ') : '      '} ${r.actor === 'tech' ? '[tech] ' : ''}${r.path}`);
  if (process.env.IDOR_VERBOSE) for (const r of rows.filter((x) => x.control.startsWith('weak') || x.verdict !== 'DENIED')) console.log(`  · ${r.path}\n      B ${r.b} ${r.bText}\n      A ${r.a} ${r.aText}`);
  if (process.env.IDOR_STDERR) (await import('node:fs')).writeFileSync(process.env.IDOR_STDERR, errs);
  console.log(`\nexempt (${exempt.length}):\n  ` + exempt.join('\n  '));
  console.log(`\nseeded ${seedLog.length} salon-A tables`);
  console.log(`\nIDOR: ${rows.length} cases — ${count('verdict', 'DENIED')} DENIED · ${count('verdict', 'NO-A-DATA')} 2xx without A's data · ${count('verdict', 'LEAK')} LEAK · ${count('verdict', 'ERROR')} ERROR; positive control proven on ${count('control', 'proven')}, differential on ${count('control', 'differential')}; ${exempt.length} exempt`);
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
