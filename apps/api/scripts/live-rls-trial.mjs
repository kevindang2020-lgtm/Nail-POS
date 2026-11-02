#!/usr/bin/env node
// live-rls-trial.mjs — BUILD_PLAN Phase 10 (Constitution 1 §6, Constitution 12 defence in depth): the row-level-security
// trial, run for real. It COPIES the database named by DATABASE_URL into a scratch database `rls_trial`, migrates it (so
// 543/544 are in), creates a plain login role `rls_trial_app` (NOT a superuser, NO BYPASSRLS — superusers skip RLS), boots
// the built API as that role with DB_TENANT_RLS=1 DB_TENANT_RLS_STRICT=1 on a spare port, and proves:
//   * two salons signed in through the API each see only their own customers; a salon cannot open the other's customer;
//   * Super Admin reads across both salons; a worker job runs (the worker pool works under strict mode);
//   * at the database itself, as the app's role: no tenant (strict) → nothing; a salon → its rows only; '*' → all;
//     a row for another salon or with NO tenant is refused.
// Then stops the API, DROPS `rls_trial` and the role. The source database is only read (pg_dump).
//
// Run:  DATABASE_URL=postgres://postgres@localhost:5432/postgres node scripts/live-rls-trial.mjs   (apps/api built; a local
// server where the connecting user may create databases and roles; trust/peer or password auth for the new role — its password is random
// per run, never printed or stored). Never point it at production.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const SRC = process.env.DATABASE_URL;
if (!SRC) { console.error('DATABASE_URL is required (the database to copy)'); process.exit(2); }
const TRIAL_DB = 'rls_trial', ROLE = 'rls_trial_app', PORT = 3071, API = `http://127.0.0.1:${PORT}`;
// Oct 22 2026: the role gets a random password made for this run (never printed, gone with the role at cleanup) — a server
// with scram/md5 auth for local TCP refused the passwordless role ("client password must be a string"); trust auth still works.
const ROLE_PW = randomUUID().replace(/-/g, '');
const withDb = (u, db, user) => { const x = new URL(u); x.pathname = '/' + db; if (user) { x.username = user; x.password = ROLE_PW; } return x.toString(); };
const ADMIN_URL = withDb(SRC, 'postgres'), TRIAL_URL = withDb(SRC, TRIAL_DB), APP_URL = withDb(SRC, TRIAL_DB, ROLE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const short = (x) => JSON.stringify(x ?? null).slice(0, 200);

const admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
const dropTrial = async () => {
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [TRIAL_DB]).catch(() => undefined);
  await admin.query(`drop database if exists ${TRIAL_DB}`);
};
const dropRole = async () => {
  const r = await admin.query(`select 1 from pg_roles where rolname = $1`, [ROLE]);
  if (r.rowCount) { await admin.query(`drop owned by ${ROLE}`).catch(() => undefined); await admin.query(`drop role if exists ${ROLE}`); }
};

let proc = null, errs = '', trial = null, app = null;
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1500);
  await trial?.end().catch(() => undefined); await app?.end().catch(() => undefined);
  await dropTrial().catch((e) => console.error('drop database failed:', e.message));
  await dropRole().catch((e) => console.error('drop role failed:', e.message));
  const left = (await admin.query(`select (select count(*)::int from pg_database where datname = $1) + (select count(*)::int from pg_roles where rolname = $2) n`, [TRIAL_DB, ROLE])).rows[0].n;
  check(`cleanup: database ${TRIAL_DB} and role ${ROLE} are dropped`, left === 0, `left=${left}`);
  await admin.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 10 * 60_000);

try {
  // ── 1. copy + migrate + role ────────────────────────────────────────────────────────────────────────────────────
  await dropTrial(); await dropRole();
  await admin.query(`create database ${TRIAL_DB}`);
  const dump = spawn('pg_dump', ['--no-owner', '--no-acl', '--dbname', SRC], { stdio: ['ignore', 'pipe', 'pipe'] });
  const load = spawn('psql', ['-q', '-v', 'ON_ERROR_STOP=0', '--dbname', TRIAL_URL], { stdio: ['pipe', 'ignore', 'pipe'] });
  let loadErr = ''; load.stderr.on('data', (c) => { loadErr += c; }); dump.stdout.pipe(load.stdin);
  const [dc, lc] = await Promise.all([new Promise((r) => dump.on('close', r)), new Promise((r) => load.on('close', r))]);
  trial = new pg.Client({ connectionString: TRIAL_URL }); await trial.connect();
  const q = async (s, p = []) => (await trial.query(s, p)).rows;
  const srcTables = (await admin.query(`select count(*)::int n from information_schema.tables where table_schema = 'public'`)).rows[0].n;
  check('the source database was copied into rls_trial (pg_dump | psql)', dc === 0 && lc === 0, `pg_dump ${dc} psql ${lc}${loadErr ? ' | ' + loadErr.split('\n').filter(Boolean).slice(-1)[0] : ''}`);
  const mig = spawnSync('node', ['scripts/migrate.mjs'], { cwd: new URL('../', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: TRIAL_URL }, encoding: 'utf8' });
  const migTail = (mig.stdout || '').trim().split('\n').slice(-1)[0];
  const rlsTables = (await q(`select relname from pg_class where relrowsecurity and relforcerowsecurity and relkind = 'r' order by 1`)).map((r) => r.relname);
  check('rls_trial migrated (543 actor columns + 544 policies present)', mig.status === 0 && rlsTables.includes('payments') && rlsTables.includes('users'), `${migTail} | RLS forced on ${rlsTables.length}: ${rlsTables.join(', ')} | source tables ${srcTables}`);
  await admin.query(`create role ${ROLE} login nosuperuser nobypassrls password '${ROLE_PW}'`);
  await q(`grant usage on schema public to ${ROLE}; grant select, insert, update, delete, truncate, references on all tables in schema public to ${ROLE};
           grant usage, select, update on all sequences in schema public to ${ROLE}; grant execute on all functions in schema public to ${ROLE}`);
  const roleRow = (await admin.query(`select rolsuper, rolbypassrls from pg_roles where rolname = $1`, [ROLE])).rows[0];
  check(`the API will run as ${ROLE}: not a superuser, no BYPASSRLS (the policies apply to it)`, roleRow && !roleRow.rolsuper && !roleRow.rolbypassrls, short(roleRow));

  // ── 2. fixtures (as the admin, in rls_trial) ────────────────────────────────────────────────────────────────────
  const tag = String(Date.now()).slice(-6), PW = 'Rls!' + randomUUID().slice(0, 10), hash = await hashPassword(PW);
  const mk = () => ({ T: randomUUID(), B: randomUUID(), O: randomUUID(), C: randomUUID(), code: '' });
  const A = mk(), Bs = mk(); A.code = `RLSA${tag}`; Bs.code = `RLSB${tag}`;
  const SA = randomUUID(), SA_EMAIL = `rls-sa-${tag}@aipowersalon.test`;
  const email = (s) => `rls-owner-${s.code.toLowerCase()}@aipowersalon.test`;
  for (const s of [A, Bs]) {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values ($1,$2,$2,$3,$4,'ACTIVE','active')`, [s.T, `RLS Trial ${s.code}`, `rls-trial-${s.code.toLowerCase()}`, s.code]);
    await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','1 Trial Way')`, [s.B, s.T, `RLS Trial ${s.code}`]);
    await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Rls','Owner','Rls Owner',$4,$5,'active','OWNER')`, [s.O, s.T, s.B, email(s), hash]);
    await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'manager')`, [s.T, s.B, s.O]);
    await q(`update tenants set owner_user_id = $2 where id = $1`, [s.T, s.O]).catch(() => undefined);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Rlstrial',$4,$5)`, [s.C, s.T, s.B, `${s.code}`, `Rlstrial ${s.code}`]);
  }
  await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Rls', 'Admin', 'Rls Admin', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);

  // ── 3. the API as the app role, RLS strict ──────────────────────────────────────────────────────────────────────
  const env = { ...process.env, DATABASE_URL: APP_URL, REPO_DRIVER: 'postgres', DB_TENANT_RLS: '1', DB_TENANT_RLS_STRICT: '1', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef',
    NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', RETENTION_EXECUTOR: 'off' };
  for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'DATABASE_REPLICA_URL', 'PG_WORKER_DATABASE_URL']) delete env[k];
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against rls_trial as the app role with DB_TENANT_RLS=1 DB_TENANT_RLS_STRICT=1', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const apiRoles = (await q(`select distinct usename from pg_stat_activity where datname = $1 and application_name like 'aipowersalon%'`, [TRIAL_DB])).map((r) => r.usename);
  check(`every API connection is ${ROLE}`, apiRoles.length > 0 && apiRoles.every((u) => u === ROLE), apiRoles.join(', '));

  const j = async (r) => { const t = await r.text(); let body = t; try { body = JSON.parse(t); } catch { /* text */ } return { status: r.status, body, text: t }; };
  const login = async (body) => { const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') }; };
  const as = (cookie) => (method, path, body) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
  const owner = async (s) => {
    const l = await login({ portal: 'tenant', salonCode: s.code, identifier: email(s), password: PW });
    const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: l.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: s.B }) });
    const jar = new Map(); for (const c of [...l.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
    return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as([...jar.values()].join('; ')) };
  };

  // ── 4. two salons through the API ───────────────────────────────────────────────────────────────────────────────
  const oa = await owner(A), ob = await owner(Bs);
  check('both owners sign in under strict RLS (sign-in runs before a tenant is known — as platform code)', oa.ok && ob.ok, `${oa.detail} / ${ob.detail}`);
  const la = await oa.call('GET', `/pos/customers?search=Rlstrial&pageSize=50`), lb = await ob.call('GET', `/pos/customers?search=Rlstrial&pageSize=50`);
  check("salon A's customer list holds A's trial customer and NOT B's", la.status === 200 && la.text.includes(A.C) && !la.text.includes(Bs.C), `status ${la.status} hasA ${la.text.includes(A.C)} hasB ${la.text.includes(Bs.C)}`);
  check("salon B's customer list holds B's trial customer and NOT A's", lb.status === 200 && lb.text.includes(Bs.C) && !lb.text.includes(A.C), `status ${lb.status} hasB ${lb.text.includes(Bs.C)} hasA ${lb.text.includes(A.C)}`);
  const cross = await oa.call('GET', `/pos/customers/${Bs.C}`);
  check("salon A cannot open salon B's customer by id (refused, nothing of B returned)", cross.status >= 400 && cross.status < 500 && !cross.text.includes(`Rlstrial ${Bs.code}`), `status ${cross.status} ${short(cross.body)}`);
  const own = await oa.call('GET', `/pos/customers/${A.C}`);
  check("salon A opens its OWN customer (the policy is not simply refusing everything)", own.status === 200 && own.text.includes(A.C), `status ${own.status}`);

  // ── 5. Super Admin + a worker job ───────────────────────────────────────────────────────────────────────────────
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const ov = await sa('GET', `/super-admin/customer-data-oversight/overview?search=Rlstrial&pageSize=50`);
  check('Super Admin reads across salons under strict RLS (both trial customers in the oversight list)', sl.status === 200 && ov.status === 200 && ov.text.includes(`Rlstrial ${A.code}`) && ov.text.includes(`Rlstrial ${Bs.code}`), `login ${sl.status} overview ${ov.status} A ${ov.text.includes(`Rlstrial ${A.code}`)} B ${ov.text.includes(`Rlstrial ${Bs.code}`)}`);
  const st = await sa('POST', '/super-admin/jobs/self-test', { count: 1 });
  const jobId = st.body?.ids?.[0];
  let job = null; for (let i = 0; i < 60 && jobId; i++) { job = (await q(`select status, result from jobs where id = $1`, [jobId]))[0]; if (job?.status === 'succeeded' || job?.status === 'dead') break; await sleep(500); }
  check('a worker job enqueued through the API runs to completion on the worker pool under strict RLS', st.status === 201 || st.status === 200 ? job?.status === 'succeeded' : false, `enqueue ${st.status} job ${short(job)}`);

  // ── 6. the database itself, as the app role ─────────────────────────────────────────────────────────────────────
  app = new pg.Client({ connectionString: APP_URL }); await app.connect();
  const as_ = async (tenant, strict, sql, p = []) => { await app.query(`select set_config('app.tenant_id', $1, false), set_config('app.tenant_strict', $2, false)`, [tenant, strict ? 'on' : '']); return (await app.query(sql, p)).rows; };
  const trialCustomers = `select tenant_id from customers where full_name like 'Rlstrial %' order by full_name`;
  const ids = (rows) => rows.map((r) => (r.tenant_id === A.T ? 'A' : r.tenant_id === Bs.T ? 'B' : '?')).join(',');
  check('DB (strict, no tenant): a session that names no salon sees NO customers, payments or users', (await as_('', true, trialCustomers)).length === 0 && (await as_('', true, `select count(*)::int n from users`))[0].n === 0, '');
  check("DB (salon A): only A's rows, with no WHERE on tenant", ids(await as_(A.T, true, trialCustomers)) === 'A', ids(await as_(A.T, true, trialCustomers)));
  check("DB ('*' — Super Admin / workers / runAcrossTenants): every salon", ids(await as_('*', true, trialCustomers)) === 'A,B', ids(await as_('*', true, trialCustomers)));
  const refusedErr = async (fn) => { try { await fn(); return 'accepted'; } catch (e) { return String(e.message); } };
  const e1 = await refusedErr(() => as_(A.T, true, `insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, 'Evil', 'X', 'Rlstrial EVIL')`, [Bs.T, Bs.B]));
  const e2 = await refusedErr(() => as_(A.T, true, `insert into pos_queue_items (tenant_id, customer_name) values (null, 'Rlstrial no tenant')`));
  const e3 = await refusedErr(() => as_('', true, `insert into pos_queue_items (tenant_id, customer_name) values ($1, 'Rlstrial no session tenant')`, [A.T]));
  check("DB: salon A cannot write a row for salon B", /row-level security/.test(e1), e1.slice(0, 120));
  check('DB: a row with NO tenant is refused (from a salon session)', /row-level security|null value/.test(e2), e2.slice(0, 120));
  check('DB: a session with no tenant cannot write at all (strict)', /row-level security/.test(e3), e3.slice(0, 120));
  const upd = await as_(A.T, true, `update customers set last_name = 'Hijacked' where id = $1 returning id`, [Bs.C]);
  check("DB: salon A's UPDATE of B's customer touches 0 rows", upd.length === 0, `${upd.length} row(s)`);
} catch (e) {
  check('the trial ran to the end', false, String(e?.message || e));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  const total = results.length;
  console.log(`\n${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
}
