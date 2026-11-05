#!/usr/bin/env node
// live-phase10-database.mjs — BUILD_PLAN Phase 10 (Constitution 1, Database), proved on the real API and PostgreSQL.
// Nothing is stubbed: a Super Admin and a salon owner sign in and call the endpoints the admin app and the POS call.
//   1. the Super Admin Database page answers with REAL figures: migration version = the ledger's max, 0 pending, ledger
//      integrity ok; table count = the catalogue's; tables / indexes / slow queries / activity / schema health / growth /
//      retention runs answer; a salon owner is refused;
//   2. activity sees a proof transaction open > 30 s and a lock wait; "cancel" needs step-up and a reason, cancels the
//      proof's running query (SQLSTATE 57014) and is audited;
//   3. a deferred constraint inserted by the proof is listed; "retry" while the data still blocks it leaves it open; after
//      the data is fixed "retry" resolves it (the index exists, resolved_at set) — through agent B's service;
//   4. VACUUM ANALYZE needs step-up; refuses a name that is not a plain identifier / not a table; runs on the proof table
//      (pg_stat last_vacuum moves) and is audited;
//   5. the database.size_snapshot job writes today's row per table; the manual snapshot is audited;
//   6. B: the tenant-consistency trigger refuses a ticket line naming another salon's ticket;
//   7. C: a loyalty balance change through the API writes a loyalty_ledger row and the balance = sum(delta);
//      the summaries.daily job writes today's row for the salon;
//   8. D: an update through the API stamps updated_by = the signed-in owner; the retention dry run returns counts and
//      deletes nothing.
// Every route / table name the proof relies on is in the two tables right below — adjust there, not inline.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase10-database.mjs   (apps/api built, migrations applied). Never point
// it at production: it creates a proof branch in SALON_CODE (default PILOT01), a proof salon (B), a Super Admin, a proof
// owner and a scratch table; it removes everything it made. Append-only rows (audit_logs, loyalty_ledger) stay and are counted.
// It resets the scheduler lease of database.size_snapshot and summaries.daily so their boot ticks run in this process.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { removeProofBranchTx } from './proof-cleanup.mjs';

// ── the contract, in one place ─────────────────────────────────────────────────────────────────────────────────────
const R = {
  login: '/auth/login', selectBranch: '/auth/select-branch', stepUp: '/auth/step-up',
  db: (p) => `/super-admin/database/${p}`,
  cancel: (pid) => `/super-admin/database/backends/${pid}/cancel`,
  vacuum: (t) => `/super-admin/database/tables/${encodeURIComponent(t)}/vacuum-analyze`,
  retry: (id) => `/super-admin/database/deferred-constraints/${id}/retry`,
  snapshot: '/super-admin/database/snapshots',
  customer: (id) => `/pos/customers/${id}`, loyalty: (id) => `/pos/customers/${id}/loyalty`,
  retentionRules: '/super-admin/security/retention-rules', retentionPreview: (dc) => `/super-admin/security/retention-rules/${encodeURIComponent(dc)}/preview-purge`,
};
const ASSUME = {
  SIZE_JOB: 'database.size_snapshot', SUMMARIES_JOB: 'summaries.daily', JOB_BOOT_WAIT_MS: 90_000,   // both boot ticks fire 30 s after start
  AUDIT_ACTIONS: { cancel: 'database.backend_cancelled', vacuum: 'database.vacuum_analyze', retry: 'database.deferred_constraint_retried', snapshot: 'database.size_snapshot' },
  LONG_TX_SECONDS: 31,
  CONSISTENCY_ERROR: /cross-tenant reference refused/,
  // C's ledger: entry_type / delta (540); D's stamp: customers.updated_by (543)
  LEDGER_COLS: { type: 'entry_type', delta: 'delta', actor: 'actor_user_id' },
  // VACUUM takes a table from A's ownership registry when it is present (the proof's scratch table is then refused)
  REGISTRY: new URL('../db/ownership/registry.generated.json', import.meta.url).pathname, VACUUM_PREFERRED: ['db_table_size_snapshots', 'branches'],
  // the retention dry run (preview-purge) only counts these data classes; a rule is created for the first when none is active
  RETENTION_CLASSES: ['login_attempts', 'audit_events', 'report_exports'], RETENTION_COUNT_TABLE: { login_attempts: 'login_attempts', audit_events: 'audit_events', report_exports: 'report_exports' },
};
const registry = existsSync(ASSUME.REGISTRY) ? Object.keys(JSON.parse(readFileSync(ASSUME.REGISTRY, 'utf8')).tables ?? {}) : null;

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3062, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ok, ms) => { const end = Date.now() + ms; let v = await fn(); while (!ok(v) && Date.now() < end) { await sleep(500); v = await fn(); } return v; };
const j = async (r) => { const t = await r.text(); let body = t; try { body = JSON.parse(t); } catch { /* text */ } return { status: r.status, body }; };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);
const code = (b) => b?.code ?? b?.error?.code ?? b?.message?.code ?? null;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB, application_name: 'live-phase10-proof' }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }
const tag = String(Date.now()).slice(-6);
const PW = 'Phase10!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const SA = randomUUID(), OWN = randomUUID(), BA = randomUUID(), CA = randomUUID(), TB = randomUUID(), BB = randomUUID(), CB = randomUUID(), TKB = randomUUID();
const SA_EMAIL = `phase10-sa-${tag}@aipowersalon.test`, OWN_EMAIL = `phase10-own-${tag}@aipowersalon.test`;
const SCRATCH = `live_p10_proof_${tag}`, UQ = `uq_live_p10_${tag}`;
const STARTED = new Date();

// leftovers of an interrupted earlier run
for (const r of await q(`select tablename from pg_tables where schemaname = 'public' and tablename like 'live_p10_proof_%'`)) await q(`drop table if exists "${r.tablename}"`);
await q(`delete from schema_deferred_constraints where name like 'uq_live_p10_%'`);
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase10 Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id).catch(() => undefined);

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, $3, 'active', 'America/New_York', '10 Proof Way')`, [BA, TA, `Live Phase10 Proof ${tag}`]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'Lia', 'Ten', 'Lia Ten')`, [CA, TA, BA]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1, $2, $3, 'Olu', 'Ten', 'Olu Ten', $4, $5, 'active', 'OWNER')`, [OWN, TA, BA, OWN_EMAIL, hash]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1, $2, $3, 'manager')`, [TA, BA, OWN]);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Ten', 'Pat Ten', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);
// salon B: a ticket another salon's line must never name
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, lifecycle_state) values ($1, $2, $2, $3, $4, 'active', 'ACTIVE')`, [TB, `Live Phase10 Proof Salon B ${tag}`, `live-phase10-proof-${tag}`, `P10B${tag}`]);
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, 'Live Phase10 Proof B', 'active', 'America/New_York', '11 Proof Way')`, [BB, TB]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'Bo', 'Ten', 'Bo Ten')`, [CB, TB, BB]);
await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values ($1, $2, $3, $4, 'ready_for_payment', 1000, 1000)`, [TKB, TB, BB, CB]);
// the scratch table the deferred constraint and VACUUM act on
await q(`create table "${SCRATCH}" (id serial primary key, k text)`);
await q(`insert into "${SCRATCH}" (k) select 'k' || g from generate_series(1, 200) g`);
await q(`insert into "${SCRATCH}" (k) values ('k1')`);   // one duplicate: the unique index cannot be built yet
// both job leases reset so the boot ticks run here (30 s after start)
await q(`update scheduler_runs set lease_until = null, lease_owner = null, last_started_at = null where name = any($1::text[])`, [[ASSUME.SIZE_JOB, ASSUME.SUMMARIES_JOB]]).catch(() => undefined);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'DATABASE_SIZE_SNAPSHOT_JOB', 'SUMMARIES_DAILY_CRON_ENABLED']) delete env[k];
env.AI_QUEUE_OPS_JOBS = 'off'; env.AI_SCHEDULING_JOBS = 'off'; env.COMMUNITY_JOBS = 'off';
let proc = null; let errs = '';
const extra = [];   // pg clients the proof holds open (long transaction, lock holder, lock waiter)

const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  for (const c of extra) await c.end().catch(() => undefined);
  await sleep(1200);
  await q(`delete from schema_deferred_constraints where name = $1`, [UQ]).catch(() => undefined);
  await q(`delete from data_retention_purge_runs where actor_user_id = $1`, [SA]).catch(() => undefined);
  await q(`delete from data_retention_rules where created_by = $1`, [SA]).catch(() => undefined);
  await q(`drop table if exists "${SCRATCH}"`).catch(() => undefined);
  for (const u of [SA, OWN]) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[SA_EMAIL, OWN_EMAIL]]).catch(() => undefined);
  await q(`delete from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [TA, CA]).catch(() => undefined);
  await q(`delete from outbox_events where created_at >= $1 and tenant_id = any($2::uuid[]) and (aggregate_id = any($3::text[]) or payload_json->>'customerId' = any($3::text[]))`, [STARTED, [TA, TB], [CA, CB]]).catch(() => undefined);
  await q(`delete from tickets where id = $1`, [TKB]).catch(() => undefined);
  await q(`delete from customers where id = $1`, [CB]).catch(() => undefined);
  await q(`delete from branches where id = $1`, [BB]).catch(() => undefined);
  await q(`delete from tenant_daily_sales_summary where tenant_id = $1`, [TB]).catch(() => undefined);
  await q(`delete from tenant_daily_booking_summary where tenant_id = $1`, [TB]).catch(() => undefined);
  await q(`delete from tenant_daily_customer_summary where tenant_id = $1`, [TB]).catch(() => undefined);
  const tB = await q(`delete from tenants where id = $1 returning id`, [TB]).catch((e) => [{ err: e.message }]);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [[SA, OWN]]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from branches where id = any($2::uuid[]))
      + (select count(*)::int from tenants where id = $3) + (select count(*)::int from customers where id = any($4::uuid[]))
      + (select count(*)::int from pg_tables where tablename = $5) + (select count(*)::int from schema_deferred_constraints where name = $6) as n`,
    [[SA, OWN], [BA, BB], TB, [CA, CB], SCRATCH, UQ]))[0].n;
  const kept = (await q(`select (select count(*)::int from audit_logs where user_id = $1) as audits, (select count(*)::int from loyalty_ledger where tenant_id = $2 and customer_id = $3) as ledger`, [SA, TA, CA]).catch(() => [{ audits: '?', ledger: '?' }]))[0];
  check('cleanup: the proof branch, salon B, the proof users, customers, ticket, scratch table and deferred row are gone',
    a.removed && left === 0 && !tB[0]?.err, `branch ${a.removed} [${(a.kept ?? []).join(', ')}] tenantB ${tB[0]?.err ?? 'removed'} left=${left} (append-only kept: audit_logs ${kept.audits}, loyalty_ledger ${kept.ledger})`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 10 * 60_000);

// ── HTTP helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const cookieJar = (...lists) => { const jar = new Map(); for (const c of lists.flat()) { const k = c.split('=')[0]; if (k) jar.set(k, c); } return [...jar.values()].join('; '); };
const setCookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const as = (cookie) => (method, path, body) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
const loginAs = async (body, branchId) => {
  const l = await fetch(API + R.login, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const c1 = setCookies(l);
  if (!branchId) return { ok: l.status === 200, detail: `login ${l.status}`, call: as(cookieJar(c1)) };
  const sel = await fetch(API + R.selectBranch, { method: 'POST', headers: { cookie: cookieJar(c1), 'content-type': 'application/json' }, body: JSON.stringify({ branchId }) });
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as(cookieJar(c1, setCookies(sel))) };
};
const stepUp = (set) => q(`update sessions set last_step_up_at = ${set ? 'now()' : 'null'} where user_id = $1 and revoked_at is null`, [SA]);
const audited = async (action) => (await q(`select count(*)::int as n from audit_logs where user_id = $1 and action_type = $2 and created_at >= $3`, [SA, action, STARTED]))[0].n;
const reason = (s) => `Live P10 proof: ${s}`;

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const bootedAt = Date.now();

  const sa = await loginAs({ portal: 'super-admin', identifier: SA_EMAIL, password: PW, mfaCode: '123456' });
  const own = await loginAs({ portal: 'tenant', salonCode: SALON, identifier: OWN_EMAIL, password: PW }, BA);
  check('a Super Admin and the salon owner sign in', sa.ok && own.ok, `${sa.detail} / ${own.detail}`);

  // ── 1. the page reads real figures ──────────────────────────────────────────────────────────────────────────────
  const ov = await sa.call('GET', R.db('overview'));
  const ledgerMax = (await q(`select max(filename) as f, count(*)::int as n from schema_migrations`))[0];
  check('overview: migration version = the ledger\'s max, every file applied (0 pending), ledger integrity ok',
    ov.status === 200 && ov.body?.migrations?.latest === ledgerMax.f && ov.body?.migrations?.pending?.length === 0 && ov.body?.migrations?.ledgerIntegrity === 'ok' && ov.body?.migrations?.applied === ledgerMax.n,
    `${ov.status} ${short(ov.body?.migrations)} ledger max ${ledgerMax.f} (${ledgerMax.n})`);
  const cat = (await q(`select current_setting('server_version_num')::int as v, (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p')) as t, pg_database_size(current_database())::float8 as b`))[0];
  check('overview: server version, table count and database size are the catalogue\'s',
    ov.body?.server?.versionNum === cat.v && ov.body?.size?.tableCount === cat.t && Math.abs(ov.body?.size?.databaseBytes - cat.b) / cat.b < 0.05,
    `v ${ov.body?.server?.versionNum}/${cat.v} tables ${ov.body?.size?.tableCount}/${cat.t} bytes ${ov.body?.size?.databaseBytes}/${cat.b}`);
  check('overview: connections are counted against max_connections and the cache hit ratio is a real ratio',
    ov.body?.connections?.total >= 1 && ov.body?.connections?.total <= ov.body?.connections?.max && (ov.body?.cacheHitRatio === null || (ov.body.cacheHitRatio > 0 && ov.body.cacheHitRatio <= 1)),
    short(ov.body?.connections) + ` hit ${ov.body?.cacheHitRatio}`);
  const tb = await sa.call('GET', R.db('tables?limit=50'));
  const sizes = (tb.body?.rows ?? []).map((r) => r.totalBytes);
  check('tables: the 50 largest, largest first, with row estimates and vacuum / scan figures',
    tb.status === 200 && sizes.length === 50 && sizes.every((s, i) => i === 0 || sizes[i - 1] >= s) && tb.body.rows.every((r) => typeof r.rowEstimate === 'number' && typeof r.seqScans === 'number'), `${tb.status} n=${sizes.length}`);
  const ix = await sa.call('GET', R.db('indexes'));
  const invalidDb = (await q(`select count(*)::int as n from pg_index i join pg_class c on c.oid = i.indrelid where not i.indisvalid and c.relnamespace = 'public'::regnamespace`))[0].n;
  check('indexes: INVALID indexes match pg_index; unused and duplicate lists answer', ix.status === 200 && ix.body?.invalid?.length === invalidDb && Array.isArray(ix.body?.unused) && Array.isArray(ix.body?.duplicates), `${ix.status} invalid ${ix.body?.invalid?.length}/${invalidDb} unused ${ix.body?.unused?.length} dup ${ix.body?.duplicates?.length}`);
  const sq = await sa.call('GET', R.db('slow-queries'));
  let pgss = false; try { await q('select 1 from pg_stat_statements limit 1'); pgss = true; } catch { pgss = false; }
  check('slow queries: the source is pg_stat_statements exactly when it answers, else the app\'s own shapes (labelled)',
    sq.status === 200 && sq.body?.source === (pgss ? 'pg_stat_statements' : 'app_telemetry') && Array.isArray(sq.body?.rows) && typeof sq.body?.note === 'string', `${sq.status} ${sq.body?.source} pgss=${pgss} rows=${sq.body?.rows?.length}`);
  const deny = await own.call('GET', R.db('overview'));
  check('a salon owner is refused the Database page', deny.status === 401 || deny.status === 403, `${deny.status}`);

  // ── 2. activity: a long transaction, a lock wait, and an audited cancel ─────────────────────────────────────────
  const longTx = new pg.Client({ connectionString: DB, application_name: 'live-phase10-longtx' }); await longTx.connect(); extra.push(longTx);
  const holder = new pg.Client({ connectionString: DB, application_name: 'live-phase10-holder' }); await holder.connect(); extra.push(holder);
  const waiter = new pg.Client({ connectionString: DB, application_name: 'live-phase10-waiter' }); await waiter.connect(); extra.push(waiter);
  const longPid = (await longTx.query('select pg_backend_pid() as p')).rows[0].p;
  await longTx.query('begin'); await longTx.query('select 1');
  await holder.query('begin'); await holder.query(`select * from "${SCRATCH}" where id = 1 for update`);
  const waiterPid = (await waiter.query('select pg_backend_pid() as p')).rows[0].p;
  const waiting = waiter.query(`update "${SCRATCH}" set k = k where id = 1`).catch((e) => e);
  await sleep(ASSUME.LONG_TX_SECONDS * 1000);
  const sleeping = longTx.query('select pg_sleep(120)').then(() => null, (e) => e);
  await sleep(1500);
  const act = await sa.call('GET', R.db('activity'));
  const lt = act.body?.longTransactions?.find((r) => r.pid === longPid);
  check('activity: the proof transaction open > 30 s is listed, its query shown as a shape', act.status === 200 && !!lt && lt.xactSeconds >= 30 && /pg_sleep\(N\)/.test(lt.queryShape), `${act.status} ${short(lt)}`);
  const lw = act.body?.lockWaits?.find((w) => w.waitingPid === waiterPid);
  check('activity: the lock wait is listed with its blocker', !!lw && lw.blockingPids.length >= 1, short(lw ?? act.body?.lockWaits));
  check('activity: connections are grouped by application', (act.body?.byApplication ?? []).some((r) => r.applicationName === 'live-phase10-longtx'), short(act.body?.byApplication?.slice(0, 4)));
  await stepUp(false);
  const noStep = await sa.call('POST', R.cancel(longPid), { reason: reason('cancel the long transaction') });
  await stepUp(true);
  const noReason = await sa.call('POST', R.cancel(longPid), { reason: 'short' });
  const cancel = await sa.call('POST', R.cancel(longPid), { reason: reason('cancel the long transaction') });
  const sleptErr = await Promise.race([sleeping, sleep(10_000).then(() => 'still running')]);
  check('cancel needs step-up (STEP_UP_REQUIRED) and a reason (400), then cancels the running query (SQLSTATE 57014)',
    noStep.status === 403 && code(noStep.body) === 'STEP_UP_REQUIRED' && noReason.status === 400 && ok2(cancel.status) && cancel.body?.cancelled === true && sleptErr?.code === '57014',
    `${noStep.status} ${code(noStep.body)} / ${noReason.status} / ${cancel.status} ${short(cancel.body)} / ${sleptErr?.code ?? sleptErr}`);
  check('the cancel is audited (platform audit_logs)', (await audited(ASSUME.AUDIT_ACTIONS.cancel)) === 1, `${await audited(ASSUME.AUDIT_ACTIONS.cancel)}`);
  await longTx.query('rollback').catch(() => undefined);
  await holder.query('rollback'); await waiting;

  // ── 3. a deferred constraint: listed, still blocked, then resolved ──────────────────────────────────────────────
  await q(`select schema_defer_constraint($1, $2, 'unique', 'live-phase10-proof', '1 duplicate groups', 1, $3)`, [UQ, SCRATCH, `CREATE UNIQUE INDEX IF NOT EXISTS ${UQ} ON ${SCRATCH} (k)`]);
  const dId = (await q(`select id from schema_deferred_constraints where name = $1`, [UQ]))[0].id;
  const sh = await sa.call('GET', R.db('schema-health'));
  check('schema health lists the proof\'s deferred constraint (retryable) and the NOT VALID constraints the catalogue has',
    sh.status === 200 && sh.body?.deferred?.some((d) => d.id === dId && d.retryable) && sh.body?.notValidConstraints?.length === (await q(`select count(*)::int as n from pg_constraint where not convalidated and contype in ('f','c') and connamespace = 'public'::regnamespace`))[0].n,
    `${sh.status} deferred ${sh.body?.deferred?.length} notValid ${sh.body?.notValidConstraints?.length}`);
  const blocked = await sa.call('POST', R.retry(dId), { reason: reason('retry while duplicated') });
  const stillOpen = (await q(`select resolved_at from schema_deferred_constraints where id = $1`, [dId]))[0].resolved_at === null;
  check('retry while the data still blocks it: not resolved, the row stays open, no index', ok2(blocked.status) && blocked.body?.resolved === false && stillOpen && (await q(`select 1 from pg_indexes where indexname = $1`, [UQ])).length === 0, `${blocked.status} ${short(blocked.body)}`);
  await q(`delete from "${SCRATCH}" where id = (select max(id) from "${SCRATCH}")`);
  const fixed = await sa.call('POST', R.retry(dId), { reason: reason('duplicate removed') });
  const row = (await q(`select resolved_at, resolved_by from schema_deferred_constraints where id = $1`, [dId]))[0];
  check('after the data is fixed, retry resolves it: the unique index exists and resolved_at / resolved_by are set',
    ok2(fixed.status) && fixed.body?.resolved === true && !!row.resolved_at && (await q(`select 1 from pg_indexes where indexname = $1`, [UQ])).length === 1, `${fixed.status} ${short(fixed.body)} by ${row.resolved_by}`);
  check('both retries are audited', (await audited(ASSUME.AUDIT_ACTIONS.retry)) === 2, `${await audited(ASSUME.AUDIT_ACTIONS.retry)}`);

  // ── 4. VACUUM ANALYZE ───────────────────────────────────────────────────────────────────────────────────────────
  await stepUp(false);
  const vNo = await sa.call('POST', R.vacuum(SCRATCH), { reason: reason('vacuum the scratch table') });
  await stepUp(true);
  const vBad = await sa.call('POST', R.vacuum('payments; drop table users'), { reason: reason('injection attempt') });
  const vMissing = await sa.call('POST', R.vacuum('no_such_table_p10'), { reason: reason('missing table') });
  check('VACUUM ANALYZE: refused without step-up; a non-identifier is 400 and an unknown table 404', vNo.status === 403 && vBad.status === 400 && vMissing.status === 404, `${vNo.status} ${vBad.status} ${vMissing.status}`);
  const VT = registry ? (ASSUME.VACUUM_PREFERRED.find((t) => registry.includes(t)) ?? registry[0]) : SCRATCH;
  if (registry) {
    const unreg = await sa.call('POST', R.vacuum(SCRATCH), { reason: reason('vacuum an unregistered table') });
    check('VACUUM ANALYZE refuses a real table that is not in the ownership registry (404)', unreg.status === 404, `${unreg.status} ${code(unreg.body)}`);
  }
  const vBefore = (await q(`select coalesce(vacuum_count, 0)::int as v, coalesce(analyze_count, 0)::int as a from pg_stat_user_tables where relname = $1`, [VT]))[0];
  const vac = await sa.call('POST', R.vacuum(VT), { reason: reason('vacuum a registered table') });
  const vacStat = await waitFor(async () => (await q(`select coalesce(vacuum_count, 0)::int as v, coalesce(analyze_count, 0)::int as a from pg_stat_user_tables where relname = $1`, [VT]))[0], (r) => r?.v > vBefore.v && r?.a > vBefore.a, 8000);
  check(`VACUUM ANALYZE runs on ${VT} (pg_stat vacuum_count / analyze_count move) and is audited with the reason`,
    ok2(vac.status) && vacStat?.v > vBefore.v && vacStat?.a > vBefore.a && (await q(`select count(*)::int as n from audit_logs where user_id = $1 and action_type = $2 and entity_id = $3 and metadata_json->>'reason' like 'Live P10 proof:%'`, [SA, ASSUME.AUDIT_ACTIONS.vacuum, VT]))[0].n === 1,
    `${vac.status} ${short(vac.body)} ${short(vBefore)}→${short(vacStat)}`);

  // ── 5. snapshots: the job and the manual action ────────────────────────────────────────────────────────────────
  const today = (await q(`select (now() at time zone 'utc')::date::text as d`))[0].d;
  const jobRun = await waitFor(async () => (await q(`select last_finished_at, last_outcome from scheduler_runs where name = $1`, [ASSUME.SIZE_JOB]))[0], (r) => r?.last_finished_at && new Date(r.last_finished_at) >= STARTED, Math.max(0, ASSUME.JOB_BOOT_WAIT_MS - (Date.now() - bootedAt)));
  const snapRows = (await q(`select count(*)::int as n from db_table_size_snapshots where snapshot_date = $1::date`, [today]))[0].n;
  const pubTables = (await q(`select count(*)::int as n from pg_stat_user_tables where schemaname = 'public'`))[0].n;
  check('the database.size_snapshot job ran in this process and wrote today\'s row per table', jobRun?.last_outcome === 'ok' && snapRows >= pubTables - 2, `${short(jobRun)} rows ${snapRows}/${pubTables}`);
  const manual = await sa.call('POST', R.snapshot, {});
  check('a manual snapshot is written and audited', ok2(manual.status) && manual.body?.written >= pubTables - 2 && (await audited(ASSUME.AUDIT_ACTIONS.snapshot)) === 1, `${manual.status} ${short(manual.body)}`);
  const gr = await sa.call('GET', R.db('growth?days=90'));
  check('growth answers from the snapshots (today is in the series)', gr.status === 200 && gr.body?.totals?.some((t) => t.day === today) && gr.body?.tables?.length > 0, `${gr.status} days ${gr.body?.totals?.length}`);
  const rr = await sa.call('GET', R.db('retention-runs'));
  check('retention runs answer (the executor\'s recorded runs)', rr.status === 200 && Array.isArray(rr.body?.rows), `${rr.status} ${rr.body?.rows?.length}`);

  // ── 6. B: the tenant-consistency trigger ───────────────────────────────────────────────────────────────────────
  let trigErr = null;
  try { await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, service_id)
      values ($1, $2, $3, 'Cross', 100, 10, 100, (select id from services where tenant_id = $1 limit 1))`, [TA, BA, TKB]); } catch (e) { trigErr = e; }
  check('B: a ticket line naming another salon\'s ticket is refused by the consistency trigger (23000)', !!trigErr && ASSUME.CONSISTENCY_ERROR.test(trigErr.message) && trigErr.code === '23000', `${trigErr?.code} ${String(trigErr?.message ?? 'inserted!').slice(0, 120)}`);

  // ── 7. C: loyalty through the ledger; the summaries job ─────────────────────────────────────────────────────────
  const loy = await own.call('PATCH', R.loyalty(CA), { points: 150, tier: 'Regular', reason: reason('opening balance for the proof') });
  const L = ASSUME.LEDGER_COLS;
  const led = (await q(`select count(*)::int as n, coalesce(sum(${L.delta}), 0)::int as s, max(${L.type}) as t, max(${L.actor}::text) as a from loyalty_ledger where tenant_id = $1 and customer_id = $2`, [TA, CA]).catch((e) => [{ err: e.message }]))[0];
  const bal = (await q(`select points_balance from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [TA, CA]))[0]?.points_balance;
  check('C: a loyalty balance change through the API writes an adjust ledger row by the owner, and the balance = sum(delta)',
    ok2(loy.status) && led.n === 1 && led.t === 'adjust' && led.a === OWN && Number(bal) === 150 && led.s === 150, `${loy.status} ${short(loy.body)} ledger ${short(led)} balance ${bal}`);
  const sumRun = await waitFor(async () => (await q(`select last_finished_at, last_outcome from scheduler_runs where name = $1`, [ASSUME.SUMMARIES_JOB]))[0], (r) => r?.last_finished_at && new Date(r.last_finished_at) >= STARTED, Math.max(0, ASSUME.JOB_BOOT_WAIT_MS - (Date.now() - bootedAt)));
  const sumRow = (await q(`select count(*)::int as n from tenant_daily_sales_summary where tenant_id = $1 and summary_date >= current_date - 1`, [TA]))[0].n;
  check('C: the summaries.daily job ran and wrote the salon\'s recent daily sales rows', sumRun?.last_outcome === 'ok' && sumRow >= 1, `${short(sumRun)} rows ${sumRow}`);

  // ── 8. D: actor stamp; retention dry run ────────────────────────────────────────────────────────────────────────
  const upd = await own.call('PATCH', R.customer(CA), { preferredName: 'Proof Ten' });
  const stamp = (await q(`select updated_by::text as u from customers where id = $1`, [CA]).catch((e) => [{ u: `ERR ${e.message}` }]))[0]?.u;
  check('D: an update through the API stamps customers.updated_by = the signed-in owner', ok2(upd.status) && stamp === OWN, `${upd.status} updated_by=${stamp}`);
  const rules = await sa.call('GET', R.retentionRules);
  const list = Array.isArray(rules.body) ? rules.body : [];
  let dc = ASSUME.RETENTION_CLASSES.find((c) => list.some((r) => r.dataClass === c && r.status === 'active'));
  if (!dc) {   // no active rule for a countable class: the proof creates one (removed in cleanup) — storing a rule deletes nothing
    dc = ASSUME.RETENTION_CLASSES[0];
    const made = await sa.call('PATCH', `${R.retentionRules}/${dc}`, { retentionDays: 400, action: 'delete' });
    if (!ok2(made.status)) check('D: a retention rule could be stored for the dry run', false, `${made.status} ${short(made.body)}`);
  }
  const countTable = ASSUME.RETENTION_COUNT_TABLE[dc];
  const rowsBefore = (await q(`select count(*)::int as n from ${countTable}`))[0].n;
  const execBefore = (await q(`select count(*)::int as n from data_retention_purge_runs where mode = 'executed'`))[0].n;
  const dry = await sa.call('POST', R.retentionPreview(dc), {});
  const rowsAfter = (await q(`select count(*)::int as n from ${countTable}`))[0].n;
  const execAfter = (await q(`select count(*)::int as n from data_retention_purge_runs where mode = 'executed'`))[0].n;
  check('D: the retention dry run returns counts and deletes / executes nothing',
    ok2(dry.status) && typeof dry.body?.eligibleCount === 'number' && rowsAfter >= rowsBefore && execAfter === execBefore,
    `${rules.status} class=${dc} ${dry.status} ${short(dry.body)} rows ${rowsBefore}→${rowsAfter} executed ${execBefore}→${execAfter}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
